//! we-floater —— 桌面悬浮球：DSH 页面（http://127.0.0.1:3080/）被切到后台或浏览器最小化时，
//! 在桌面显示一个与侧边栏球形按钮同款的「环形按钮」，单击把那个页签重新带回前台。
//!
//! 为什么需要原生窗口：页面隐藏后浏览器内的一切 DOM 都不可见，悬浮入口必须是浏览器进程
//! 之外的置顶窗口。we-capture 捕获的是壁纸，本程序是反向的「唤起」通道。
//!
//! 协议（与 node 半 src/floater 对齐，行协议，stdin 收 / stdout 发）：
//!   → `show [x y]` 显示（可带位置，物理像素）  → `hide` 隐藏
//!   → `color <rrggbb>` 环色（同侧边栏球：22c55e 空闲 / eab308 待授权 / 3b82f6 进行中）
//!   → `title <s>` 用于激活匹配的 document.title  → `quit`
//!   ← `ready` | `click ok|miss`（单击及激活结果） | `moved <x> <y>`（拖拽结束）
//!   ← `dismiss`（右键 / 双击主动收起；node 半 snooze 到下一次可见心跳）
//!   父进程消失 → stdin EOF → 自毁（不留孤儿悬浮窗）。
//!
//! 单击激活策略（依次）：
//!   1. UIA：遍历可见的浏览器类名顶级窗（Chrome_WidgetWin_1=Chromium 系 / MozillaWindowClass），
//!      页签容器（ControlType=Tab）子项按标题子串匹配 → SelectionItemPattern.Select() 切实页签，
//!      再 SW_RESTORE + SetForegroundWindow。解决「同窗口切到别的页签」这一 DOM 永远够不着的场景。
//!   2. 窗口标题子串匹配（我们恰好是激活页 → 标题里就含它）。
//!   3. 失败 → `click miss`，node 半稍后重挂悬浮球，不吞掉入口。
//!
//! 并发纪律：ShowWindow/SetWindowPos 等会同步向本窗口 wndproc 发消息（WM_SHOWWINDOW/WM_MOVE），
//! 因此任何共享状态都只在极短临界区里读写（gs()），消息发送型 API 必须在锁外调用——
//! 否则 std::sync::Mutex 重入即死锁（实测会挂死在第一条 show 上）。

use std::collections::VecDeque;
use std::io::{BufRead, Write};
use std::sync::{Mutex, MutexGuard};

use windows::core::{w, Interface, VARIANT};
use windows::Win32::Foundation::{
    BOOL, CloseHandle, COLORREF, GetLastError, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT,
    WPARAM, ERROR_ALREADY_EXISTS,
};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateEllipticRgn, CreatePen, CreateSolidBrush, DeleteObject, Ellipse, EndPaint,
    FillRect, GetDC, GetDeviceCaps, HGDIOBJ, InvalidateRect, LOGPIXELSX, PAINTSTRUCT, PS_SOLID,
    ReleaseDC, SelectObject, SetWindowRgn,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Threading::CreateMutexW;
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElementArray, IUIAutomationSelectionItemPattern,
    TreeScope_Children, TreeScope_Descendants, UIA_ControlTypePropertyId,
    UIA_SelectionItemPatternId, UIA_TabControlTypeId, UIA_TabItemControlTypeId,
};
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_SYSTEM_AWARE};
use windows::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, EnumWindows,
    GetClassNameW, GetCursorPos, GetMessageW, GetSystemMetrics, GetWindowRect, GetWindowTextLengthW,
    GetWindowTextW, IsIconic, IsWindowVisible, LoadCursorW, PostMessageW, PostQuitMessage,
    RegisterClassW, SetCursor,
    SetForegroundWindow, SetLayeredWindowAttributes, SetWindowPos, ShowWindow, TranslateMessage,
    CS_HREDRAW, CS_VREDRAW, HMENU, HTCLIENT, HWND_TOPMOST, IDC_HAND, LWA_ALPHA, MSG,
    SM_CXVIRTUALSCREEN,
    SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SW_HIDE, SW_RESTORE, SW_SHOWNOACTIVATE,
    SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, WS_EX_LAYERED,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WNDCLASSW, WM_APP, WM_CLOSE, WM_DESTROY,
    WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_PAINT, WM_RBUTTONUP,
    WM_SETCURSOR,
};

/// 环形按钮基准尺寸（物理 px @96dpi，随系统缩放放大）。侧边栏球 34px，桌面目标略大便于点按。
const BASE_SIZE: i32 = 40;
const WM_APP_CMD: u32 = WM_APP + 1;

struct Globals {
    hwnd: isize,         // HWND 原始值（HWND 非 Send，跨线程存取用 isize）
    scale: f32,
    color: u32,          // 0x00RRGGBB，与侧边栏球同色板
    title: String,       // 激活匹配用 document.title
    queue: VecDeque<String>,
    // 拖拽：按下时记录屏幕锚点与窗口原点，移动按差值走（SetCapture 下 lparam 是客户区坐标，不能用）
    dragging: bool,
    anchor: POINT,
    win0: (i32, i32),
    moved_px: i32,
    dbl_pending: bool,
    last_x: i32,
    last_y: i32,
}

static G: Mutex<Option<Globals>> = Mutex::new(None);

/// 短临界区访问共享状态：f 内禁止调用任何会向本窗口发消息的 user32 API。
fn gs<R>(f: impl FnOnce(&mut Globals) -> R) -> Option<R> {
    let mut guard: MutexGuard<Option<Globals>> = match G.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    guard.as_mut().map(f)
}

fn ball_px(scale: f32) -> i32 {
    (BASE_SIZE as f32 * scale) as i32
}

fn out(line: &str) {
    let so = std::io::stdout();
    let mut lock = so.lock();
    let _ = writeln!(lock, "{}", line);
    let _ = lock.flush();
}

fn main() {
    unsafe {
        let mtx = CreateMutexW(None, true, w!("Local\\DSH.WeFloater.SingleInstance"));
        if mtx.is_ok() && GetLastError() == ERROR_ALREADY_EXISTS {
            out("startup failed already-running");
            return;
        }
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_SYSTEM_AWARE);
        let hdc = GetDC(HWND::default());
        let dpi = GetDeviceCaps(hdc, LOGPIXELSX);
        ReleaseDC(HWND::default(), hdc);
        let scale = (dpi.max(96) as f32) / 96.0;

        let wc = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wndproc),
            hInstance: HINSTANCE::default(),
            // 手型指针：类不设 hCursor 时会沿用系统当前光标（点按时 UIA 扫描阻塞 UI 线程，
            // 用户看到的就是沙漏）。真正的兜底在 WM_SETCURSOR。
            hCursor: LoadCursorW(None, IDC_HAND).unwrap_or_default(),
            lpszClassName: w!("DSHWeFloater"),
            ..Default::default()
        };
        if RegisterClassW(&wc) == 0 {
            out("startup failed register-class");
            return;
        }

        let sz = ball_px(scale);
        // 多屏下虚拟桌面原点可能为负（主屏左侧/上方还有屏），必须加上原点偏移，否则会算到屏外
        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        let start_x = vx + vw - sz - (24.0 * scale) as i32;
        let start_y = vy + vh - sz - (120.0 * scale) as i32;

        let created = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_LAYERED,
            w!("DSHWeFloater"),
            w!("DSH"),
            // 不带 WS_VISIBLE：否则窗口创建即闪现未绘制的矩形（"虚影"），到 SW_HIDE 才消失。
            // 初始隐藏，由 node 半 show → SW_SHOWNOACTIVATE 点亮（不激活，避免抢走浏览器前台）。
            WS_POPUP,
            start_x,
            start_y,
            sz,
            sz,
            HWND::default(),
            HMENU::default(),
            None,
            None,
        );
        let hwnd = match created {
            Ok(h) => h,
            Err(_) => {
                out("startup failed create-window");
                return;
            }
        };
        {
            let mut slot = match G.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            *slot = Some(Globals {
                hwnd: hwnd.0 as isize,
                scale,
                color: 0x22c55e,
                title: String::new(),
                queue: VecDeque::new(),
                dragging: false,
                anchor: POINT::default(),
                win0: (start_x, start_y),
                moved_px: 0,
                dbl_pending: false,
                last_x: start_x,
                last_y: start_y,
            });
        }
        // 圆形 region：只有圆盘可点，周围透出下层窗口
        let rgn = CreateEllipticRgn(0, 0, sz, sz);
        let _ = SetWindowRgn(hwnd, rgn, true);
        let _ = DeleteObject(HGDIOBJ::from(rgn));
        // 轻微整体透明（毛玻璃观感，同面板球）
        let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 235, LWA_ALPHA);
        // 初始隐藏：悬浮球只在页面隐藏时出现，由 node 半 show 点亮
        let _ = ShowWindow(hwnd, SW_HIDE);
        out("ready");

        // stdin 线程：行协议命令入队；EOF（node 半退出 / DSH 关闭）→ 自毁，不留孤儿窗
        std::thread::spawn(move || {
            let stdin = std::io::stdin();
            for line in stdin.lock().lines() {
                let cmd = line.unwrap_or_else(|_| "quit".into());
                let target = gs(|g| {
                    g.queue.push_back(cmd.clone());
                    g.hwnd
                });
                let Some(t) = target else { break };
                let _ = PostMessageW(
                    HWND(t as *mut core::ffi::c_void),
                    WM_APP_CMD,
                    WPARAM(0),
                    LPARAM(0),
                );
                if cmd.trim() == "quit" {
                    break;
                }
            }
            if let Some(t) = gs(|g| g.hwnd) {
                let _ = PostMessageW(
                    HWND(t as *mut core::ffi::c_void),
                    WM_CLOSE,
                    WPARAM(0),
                    LPARAM(0),
                );
            }
        });

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        if let Ok(h) = mtx {
            let _ = CloseHandle(h);
        }
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_SETCURSOR => {
            // 指针落在圆盘上就用手型（单击=切回页面），不是系统的忙/沙漏光标
            if (lparam.0 as u32 & 0xFFFF) == HTCLIENT {
                let _ = SetCursor(LoadCursorW(None, IDC_HAND).unwrap_or_default());
                return LRESULT(1)
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        WM_PAINT => {
            let (sz, color, pen_w, pad) =
                gs(|g| (ball_px(g.scale), g.color, (3.0 * g.scale) as i32, (2.0 * g.scale) as i32))
                    .unwrap_or((BASE_SIZE, 0x22c55e, 3, 2));
            let mut ps = PAINTSTRUCT::default();
            let hdc = BeginPaint(hwnd, &mut ps);
            // COLORREF 是 0x00BBGGRR，而 client 传的是 RGB hex（如 3b82f6）：必须红蓝换位，
            // 否则色环全错（空闲绿→黄绿、进行中蓝→橙、待授权黄→青）。
            let cref = COLORREF(((color & 0xFF) << 16) | (color & 0x00FF_00) | ((color >> 16) & 0xFF));
            // 深底圆盘：侧边栏球背景 rgba(15,16,20,.4)；实色 + LWA 整体 235α 近似观感
            let bg = CreateSolidBrush(COLORREF(0x001410_0F)); // BGR = (15,16,20)
            let rc = RECT { left: 0, top: 0, right: sz, bottom: sz };
            let _ = FillRect(hdc, &rc, bg);
            // 3px 环（同侧边栏球 border），内缩 2px 不被圆形 region 裁掉。
            // 注意：Ellipse 用「当前画刷」填充内部 —— 只选画笔会让默认白刷把圆盘刷成白饼
            //（实测：球中心变成 (237,237,238)），所以必须把深底刷一起选进来。
            let pen = CreatePen(PS_SOLID, pen_w, cref);
            let old_pen = SelectObject(hdc, HGDIOBJ::from(pen));
            let old_brush = SelectObject(hdc, HGDIOBJ::from(bg));
            let _ = Ellipse(hdc, pad, pad, sz - pad, sz - pad);
            SelectObject(hdc, old_brush);
            SelectObject(hdc, old_pen);
            let _ = DeleteObject(HGDIOBJ::from(pen));
            let _ = DeleteObject(HGDIOBJ::from(bg));
            let _ = EndPaint(hwnd, &ps);
            LRESULT(0)
        }
        WM_LBUTTONDOWN => {
            gs(|g| {
                g.dragging = true;
                g.moved_px = 0;
                g.dbl_pending = false;
            });
            let mut p = POINT::default();
            let _ = GetCursorPos(&mut p);
            let mut rc = RECT::default();
            let _ = GetWindowRect(hwnd, &mut rc);
            gs(|g| {
                g.anchor = p;
                g.win0 = (rc.left, rc.top);
            });
            SetCapture(hwnd);
            LRESULT(0)
        }
        WM_LBUTTONDBLCLK => {
            gs(|g| g.dbl_pending = true);
            LRESULT(0)
        }
        WM_MOUSEMOVE => {
            let drag = gs(|g| (g.dragging, g.anchor, g.win0)).unwrap_or((false, POINT::default(), (0, 0)));
            if drag.0 {
                let mut p = POINT::default();
                let _ = GetCursorPos(&mut p);
                let dx = p.x - drag.1.x;
                let dy = p.y - drag.1.y;
                let d = dx.abs().max(dy.abs());
                gs(|g| {
                    if d > g.moved_px {
                        g.moved_px = d;
                    }
                });
                if d >= 3 {
                    let nx = drag.2 .0 + dx;
                    let ny = drag.2 .1 + dy;
                    gs(|g| {
                        g.last_x = nx;
                        g.last_y = ny;
                    });
                    let _ = SetWindowPos(hwnd, HWND_TOPMOST, nx, ny, 0, 0, SWP_NOACTIVATE | SWP_NOSIZE);
                }
            }
            LRESULT(0)
        }
        WM_LBUTTONUP => {
            // 先原子地取走并按下状态收尾，再在锁外做激活（activate 会发消息）
            let ev = gs(|g| {
                if !g.dragging {
                    return None;
                }
                g.dragging = false;
                let ev = if g.dbl_pending {
                    Some(Event::Dismiss)
                } else if g.moved_px < 6 {
                    Some(Event::Click(g.title.clone()))
                } else {
                    Some(Event::Moved(g.last_x, g.last_y))
                };
                g.dbl_pending = false;
                ev
            })
            .flatten();
            let _ = ReleaseCapture();
            match ev {
                Some(Event::Dismiss) => {
                    out("dismiss");
                    let _ = ShowWindow(hwnd, SW_HIDE);
                }
                Some(Event::Click(title)) => {
                    if activate(&title) {
                        out("click ok");
                    } else {
                        out("click miss");
                    }
                }
                Some(Event::Moved(x, y)) => out(&format!("moved {} {}", x, y)),
                None => {}
            }
            LRESULT(0)
        }
        WM_RBUTTONUP => {
            out("dismiss");
            let _ = ShowWindow(hwnd, SW_HIDE);
            LRESULT(0)
        }
        WM_APP_CMD => {
            loop {
                let Some(cmd) = gs(|g| g.queue.pop_front()) else { break };
                let Some(cmd) = cmd else { break };
                let trimmed = cmd.trim_end();
                let mut it = trimmed.split_ascii_whitespace();
                match it.next().unwrap_or("") {
                    "show" => {
                        let a = it.next().and_then(|v| v.parse::<i32>().ok());
                        let b = it.next().and_then(|v| v.parse::<i32>().ok());
                        if let (Some(x), Some(y)) = (a, b) {
                            gs(|g| {
                                g.last_x = x;
                                g.last_y = y;
                            });
                            let _ = SetWindowPos(hwnd, HWND_TOPMOST, x, y, 0, 0, SWP_NOACTIVATE | SWP_NOSIZE);
                        }
                        // SW_SHOWNOACTIVATE：SW_SHOW 会 deactivate 当前活动窗口（浏览器 focus
                        // 事件丢失 → 上报器永远等不到"回前台"，球此后再也不弹），绝不激活本窗。
                        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                        // 只抬 z 序：缺 SWP_NOMOVE|SWP_NOSIZE 会把窗口挪到 (0,0) 并压成 0×0
                        //（实测 = "球闪一下就没了"的元凶：CW 尺寸全被清零，窗口再也画不出来）
                        let _ = SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
                    }
                    "hide" => {
                        let _ = ShowWindow(hwnd, SW_HIDE);
                    }
                    "color" => {
                        if let Some(hex) = it.next() {
                            if let Ok(v) = u32::from_str_radix(hex.trim_start_matches('#'), 16) {
                                let changed = gs(|g| {
                                    if g.color == v {
                                        false
                                    } else {
                                        g.color = v;
                                        true
                                    }
                                })
                                .unwrap_or(false);
                                if changed {
                                    let _ = InvalidateRect(hwnd, None, BOOL(0));
                                }
                            }
                        }
                    }
                    "title" => {
                        // title 后可含空格：取整行
                        if let Some(pos) = trimmed.find("title ") {
                            let t = trimmed[pos + "title ".len()..].trim_end().to_string();
                            gs(|g| {
                                if g.title != t {
                                    g.title = t;
                                }
                            });
                        }
                    }
                    "quit" => {
                        let _ = PostMessageW(hwnd, WM_CLOSE, WPARAM(0), LPARAM(0));
                        break;
                    }
                    _ => {}
                }
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

enum Event {
    Click(String),
    Moved(i32, i32),
    Dismiss,
}

/// 把目标窗口带回前台。
/// 只有「最小化」时才 SW_RESTORE —— 对最大化的窗口调 SW_RESTORE 会把它还原成窗口态
/// （用户实测反馈："点一下球，浏览器被强行窗口化"）。
unsafe fn focus_window(hwnd: HWND) {
    if IsIconic(hwnd).as_bool() {
        let _ = ShowWindow(hwnd, SW_RESTORE);
    }
    let _ = SetForegroundWindow(hwnd);
}

/// 找到并激活 DSH 页签；返回是否成功。
unsafe fn activate(title: &str) -> bool {
    let mut cands: Vec<HWND> = Vec::new();
    let _ = EnumWindows(Some(enum_windows_collect), LPARAM(&mut cands as *mut _ as isize));

    // 1. UIA 切实页签（能处理「同窗口切到别的页签」）
    if !title.is_empty() {
        if let Ok(auto) =
            CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        {
            for hwnd in &cands {
                if select_tab(&auto, *hwnd, title) {
                    focus_window(*hwnd);
                    return true;
                }
            }
        }
        // 2. 窗口标题子串匹配（我们的页签恰好是激活页时）
        for hwnd in &cands {
            if window_title_contains(*hwnd, title) {
                focus_window(*hwnd);
                return true;
            }
        }
    }
    false
}

unsafe extern "system" fn enum_windows_collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }
    let mut buf = [0u16; 64];
    let n = GetClassNameW(hwnd, &mut buf);
    if n <= 0 {
        return BOOL(1);
    }
    let cls = String::from_utf16_lossy(&buf[..n as usize]);
    // Chromium 系（Chrome/Edge/Brave/Vivaldi/Opera）+ Firefox；悬浮球自己不是（DSHWeFloater）
    if cls != "Chrome_WidgetWin_1" && cls != "MozillaWindowClass" {
        return BOOL(1);
    }
    let list = &mut *(lparam.0 as *mut Vec<HWND>);
    list.push(hwnd);
    BOOL(1)
}

/// 在该窗口的页签集合里找标题匹配项并 Select()。
unsafe fn select_tab(auto: &IUIAutomation, hwnd: HWND, title: &str) -> bool {
    let root = match auto.ElementFromHandle(hwnd) {
        Ok(r) => r,
        Err(_) => return false,
    };
    let vt_tab: VARIANT = UIA_TabControlTypeId.0.into();
    let cond_tab = match auto.CreatePropertyCondition(UIA_ControlTypePropertyId, &vt_tab) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let vt_item: VARIANT = UIA_TabItemControlTypeId.0.into();
    let cond_item = match auto.CreatePropertyCondition(UIA_ControlTypePropertyId, &vt_item) {
        Ok(c) => c,
        Err(_) => return false,
    };
    // 路径 1：tab 容器 → 子元素（浅、快）
    if let Ok(container) = root.FindFirst(TreeScope_Descendants, &cond_tab) {
        if let Ok(items) = container.FindAll(TreeScope_Children, &cond_item) {
            if scan_items(&items, title) {
                return true;
            }
        }
    }
    // 路径 2：整棵子树（兜底，慢但全面）
    if let Ok(items) = root.FindAll(TreeScope_Descendants, &cond_item) {
        return scan_items(&items, title);
    }
    false
}

unsafe fn scan_items(items: &IUIAutomationElementArray, title: &str) -> bool {
    let count = items.Length().unwrap_or(0);
    // 浏览器可能截断页签名：拿双方前缀做互相包含判断
    let probe: String = title.chars().take(24).collect();
    for i in 0..count {
        let el = match items.GetElement(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = el.CurrentName().map(|b| b.to_string()).unwrap_or_default();
        let nlen = name.chars().count();
        if nlen < 4 {
            continue;
        }
        let head: String = name.chars().take(probe.chars().count().min(nlen)).collect();
        if probe.contains(&head) || head.contains(&probe) {
            if let Ok(unknown) = el.GetCurrentPattern(UIA_SelectionItemPatternId) {
                if let Ok(pat) = unknown.cast::<IUIAutomationSelectionItemPattern>() {
                    if pat.Select().is_ok() {
                        return true;
                    }
                }
            }
        }
    }
    false
}

unsafe fn window_title_contains(hwnd: HWND, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let len = GetWindowTextLengthW(hwnd);
    if len <= 0 {
        return false;
    }
    let mut buf = vec![0u16; (len + 1) as usize];
    let n = GetWindowTextW(hwnd, &mut buf);
    if n <= 0 {
        return false;
    }
    String::from_utf16_lossy(&buf[..n as usize]).contains(needle)
}
