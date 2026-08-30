//! we-capture —— Wallpaper Engine 实时画面捕获器（真·原生渲染器）
//!
//! 定位：作为 dsh-wallpaper_share 的 SceneAdapter「外部 renderer」。
//! 渲染由 Wallpaper Engine 本体完成（GLSL / SceneScript / 关键帧 / 全部效果），
//! 本程序只做一件事：用 **Windows Graphics Capture (WGC)** 抓取 WE 壁纸窗口的
//! 实时画面，逐帧回读 → 编码 JPEG → 按 SceneAdapter 协议写到 stdout。
//!
//! 协议（与 src/scene/SceneProtocol.ts / tools/scene-renderer 一致）：
//!   控制（stdin，换行分隔 JSON）：{"cmd":"load","width":..,"height":..,"fps":..,"quality":..} / pause / resume / resize / ping / stop
//!   帧（stdout，二进制）：[4B LE payloadLen][1B format=0(JPEG)][4B LE w][4B LE h][jpeg bytes]
//!   状态（stderr）：[VERSION]... / [STATUS]{"fps":..,"frame":..}
//!
//! 许可：MIT。仅调用系统 WGC/D3D11 API，不含任何 WE/LWE 源码。

use std::io::{self, BufRead, Write};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::thread;
use std::time::{Duration, Instant};

use jpeg_encoder::{ColorType, Encoder as JpegEncoder};
use serde::Deserialize;

use windows::core::{factory, w, Interface, PCWSTR};
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{BOOL, HMODULE, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
    D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::Com::CoIncrementMTAUsage;
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::Graphics::Gdi::{
    ClientToScreen, EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, FindWindowExW, GetAncestor, GetClassNameW, GetClientRect, GetWindowRect,
    IsWindowVisible, GA_ROOT,
};

/// 版本自报行（SceneAdapter 读取 [VERSION]）
const VERSION: &str = "we-capture-0.3.0";
/// 帧格式：0 = JPEG
const FMT_JPEG: u8 = 0;

/// 来自 stdin 的控制命令
#[derive(Debug, Clone)]
enum Cmd {
    Load { fps: u32, quality: u32, width: u32, height: u32, monitor: u32 },
    Pause,
    Resume,
    Resize { width: u32, height: u32 },
    Ping,
    Stop,
}

/// load 命令的 JSON 形状（其余字段忽略）
#[derive(Debug, Deserialize)]
struct LoadCmd {
    cmd: String,
    #[serde(default)]
    fps: u32,
    #[serde(default)]
    quality: u32,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    /// 目标显示器序号（WE 的 MonitorN，1 起；0 = 未指定，自动挑最大窗口）
    #[serde(default)]
    monitor: u32,
}

fn main() {
    // 诊断模式：--selftest <秒> <输出文件> [hwnd] —— 抓 N 秒帧写到文件后退出（绕开 stdin/stdout 管道）
    {
        let args: Vec<String> = std::env::args().collect();
        if args.len() >= 2 && (args[1] == "--version" || args[1] == "-v") {
            println!("{VERSION}");
            return;
        }
        if args.len() >= 2 && args[1] == "--selftest" {
            let secs: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(3);
            let out = args
                .get(3)
                .cloned()
                .unwrap_or_else(|| "selftest-frames.bin".to_string());
            let hwnd: Option<isize> = args.get(4).and_then(|s| s.parse().ok()).filter(|h| *h != 0);
            let sw: u32 = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(0);
            let sh: u32 = args.get(6).and_then(|s| s.parse().ok()).unwrap_or(0);
            selftest(secs, &out, hwnd, sw, sh);
            return;
        }
    }
    eprintln!("[VERSION]{VERSION}");

    // WinRT 需要 MTA 上下文
    unsafe {
        let _ = CoIncrementMTAUsage();
    }

    // stdin 读取线程 → 控制命令通道
    let (ctrl_tx, ctrl_rx) = mpsc::channel::<Cmd>();
    thread::spawn(move || stdin_reader(ctrl_tx));

    // 等待第一条 load
    loop {
        match ctrl_rx.recv() {
            Ok(Cmd::Load { fps, quality, width, height, monitor }) => {
                let stdout = io::stdout();
                let mut sink = stdout.lock();
                run_capture(fps, quality, width, height, &ctrl_rx, &mut sink, None, None, monitor);
                // run_capture 返回即该 scene 结束；回到等待下一条 load
            }
            Ok(Cmd::Stop) => break,
            Ok(Cmd::Ping) => eprintln!("[STATUS]{{\"pong\":true}}"),
            Ok(_) => {} // load 之前的 pause/resize 忽略
            Err(_) => break, // stdin 关闭 → 退出
        }
    }
}

/// 诊断模式：抓 secs 秒帧写入 out 文件（协议帧格式），然后退出。hwnd 给定则强制捕获该窗口。
fn selftest(secs: u64, out: &str, hwnd: Option<isize>, out_w: u32, out_h: u32) {
    unsafe {
        let _ = CoIncrementMTAUsage();
    }
    let (ctrl_tx, ctrl_rx) = mpsc::channel::<Cmd>();
    let _keep = ctrl_tx; // 保持存活：try_recv 返回 Empty 而非 Disconnected
    let file = match std::fs::File::create(out) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[we-capture] 无法创建输出文件 {out}: {e}");
            return;
        }
    };
    let mut sink = io::BufWriter::new(file);
    let deadline = Instant::now() + Duration::from_secs(secs);
    eprintln!("[we-capture] selftest {secs}s → {out}");
    run_capture(
        30,
        85,
        out_w,
        out_h,
        &ctrl_rx,
        &mut sink,
        Some(deadline),
        hwnd.map(|h| HWND(h as *mut core::ffi::c_void)),
        0,
    );
    let _ = sink.flush();
    eprintln!("[we-capture] selftest 完成");
}

/// 读 stdin 行，解析为控制命令
fn stdin_reader(tx: mpsc::Sender<Cmd>) {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match parse_cmd(line) {
            Some(cmd) => {
                let stop = matches!(cmd, Cmd::Stop);
                if tx.send(cmd).is_err() {
                    break;
                }
                if stop {
                    break;
                }
            }
            None => eprintln!("[we-capture] 无法解析命令: {line}"),
        }
    }
}

fn parse_cmd(line: &str) -> Option<Cmd> {
    let v: LoadCmd = serde_json::from_str(line).ok()?;
    Some(match v.cmd.as_str() {
        "load" => Cmd::Load {
            fps: if v.fps == 0 { 30 } else { v.fps },
            quality: if v.quality == 0 { 80 } else { v.quality },
            width: v.width,
            height: v.height,
            monitor: v.monitor,
        },
        "pause" => Cmd::Pause,
        "resume" => Cmd::Resume,
        "resize" => Cmd::Resize {
            width: v.width,
            height: v.height,
        },
        "ping" => Cmd::Ping,
        "stop" => Cmd::Stop,
        _ => return None,
    })
}

/// 建立 WGC 捕获并出帧，直到收到 stop / 出错 / stdin 关闭
fn run_capture(
    fps: u32,
    quality: u32,
    out_w: u32,
    out_h: u32,
    ctrl_rx: &Receiver<Cmd>,
    sink: &mut dyn Write,
    deadline: Option<Instant>,
    force_hwnd: Option<HWND>,
    monitor_hint: u32,
) {
    // 1. 找 WE 壁纸窗口（或强制指定）：优先锁定 monitor_hint 对应显示器上的窗口。
    //    返回捕获目标（顶层根窗）与壁纸子窗的屏幕矩形（裁剪用）。
    let found = match force_hwnd {
        Some(h) => FoundWindow { root: h, rect: None },
        None => match find_we_window(monitor_hint) {
            Some(f) => f,
            None => {
                eprintln!("[we-capture] 未找到 Wallpaper Engine 壁纸窗口（WE 是否在运行？）→ 退出捕获，浏览器将回退");
                return;
            }
        },
    };
    let hwnd = found.root;

    // 2. D3D11 设备
    let (device, context) = match create_d3d11() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[we-capture] D3D11 设备创建失败: {e}");
            return;
        }
    };

    // 3. WinRT IDirect3DDevice
    let winrt_device: IDirect3DDevice = match create_winrt_device(&device) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[we-capture] WinRT 设备封装失败: {e}");
            return;
        }
    };

    // 4. GraphicsCaptureItem（从 HWND）
    let item: GraphicsCaptureItem = match capture_item_for_window(hwnd) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("[we-capture] 创建捕获项失败（WGC 拒绝该窗口？）: {e}");
            return;
        }
    };

    let item_size = match item.Size() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[we-capture] 读取捕获尺寸失败: {e}");
            return;
        }
    };
    eprintln!(
        "[we-capture] 捕获窗口 hwnd={:?} size={}x{}",
        hwnd.0, item_size.Width, item_size.Height
    );

    // 4b. 计算裁剪区域（帧坐标系，相对捕获窗口客户区原点）：
    //     多显示器时顶层根窗（Progman/WorkerW）横跨整个虚拟桌面，若整帧输出会把所有显示器
    //     的壁纸拼在一起；此处把目标壁纸子窗的屏幕矩形换算成帧内偏移，只输出目标显示器。
    let (crop_x, crop_y, crop_w, crop_h) = match found.rect {
        Some(rc) => {
            // 捕获窗口客户区原点（屏幕坐标）
            let mut origin = POINT { x: 0, y: 0 };
            let mut client = RECT::default();
            unsafe {
                let _ = ClientToScreen(hwnd, &mut origin);
                let _ = GetClientRect(hwnd, &mut client);
            }
            let cw = (client.right - client.left).max(0) as i32;
            let ch = (client.bottom - client.top).max(0) as i32;
            let sx = if cw > 0 { item_size.Width as f64 / cw as f64 } else { 1.0 };
            let sy = if ch > 0 { item_size.Height as f64 / ch as f64 } else { 1.0 };
            let x = (((rc.left - origin.x).max(0) as f64) * sx) as u32;
            let y = (((rc.top - origin.y).max(0) as f64) * sy) as u32;
            let w = (((rc.right - rc.left).max(0) as f64) * sx) as u32;
            let h = (((rc.bottom - rc.top).max(0) as f64) * sy) as u32;
            (x, y, w, h)
        }
        None => (0, 0, item_size.Width as u32, item_size.Height as u32),
    };
    eprintln!(
        "[we-capture] 裁剪区域 x={crop_x} y={crop_y} w={crop_w} h={crop_h}（多显示器仅输出目标屏）"
    );

    // 5. 帧池 + 会话
    let frame_pool = match Direct3D11CaptureFramePool::Create(
        &winrt_device,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        item_size,
    ) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[we-capture] 帧池创建失败: {e}");
            return;
        }
    };
    let session = match frame_pool.CreateCaptureSession(&item) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[we-capture] 会话创建失败: {e}");
            return;
        }
    };
    unsafe {
        let _ = session.SetIsBorderRequired(false);
        let _ = session.SetIsCursorCaptureEnabled(false);
    }

    // 6. 帧到达信号
    let (sig_tx, sig_rx) = mpsc::channel::<()>();
    let handler: windows::Foundation::TypedEventHandler<
        Direct3D11CaptureFramePool,
        windows::core::IInspectable,
    > = windows::Foundation::TypedEventHandler::new(
        move |_: &Option<Direct3D11CaptureFramePool>, _: &Option<windows::core::IInspectable>| {
            let _ = sig_tx.send(());
            Ok(())
        },
    );
    let _token = frame_pool.FrameArrived(&handler);

    if let Err(e) = session.StartCapture() {
        eprintln!("[we-capture] 会话启动失败: {e}");
        return;
    }
    eprintln!("[we-capture] 捕获已启动，进入主循环");

    // 7. 主循环：取帧 → 回读 → 编码 → 写 stdout；处理控制；心跳
    let frame_interval = Duration::from_nanos(1_000_000_000u64 / fps.max(1) as u64);
    let mut paused = false;
    let mut frame_no: u64 = 0;
    let mut fps_count: u64 = 0;
    let mut last_beat = Instant::now();
    let mut last_emit = Instant::now() - frame_interval;
    let mut running = true;
    let mut perf = Perf::default();

    while running {
        // 控制命令（非阻塞）
        loop {
            match ctrl_rx.try_recv() {
                Ok(Cmd::Pause) => paused = true,
                Ok(Cmd::Resume) => paused = false,
                Ok(Cmd::Stop) => running = false,
                Ok(Cmd::Ping) => eprintln!("[STATUS]{{\"pong\":true}}"),
                Ok(Cmd::Resize { .. }) => {} // v1：按窗口原生分辨率输出，忽略
                Ok(Cmd::Load { .. }) => {}   // 单会话内忽略重复 load
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    // stdin 关闭（父进程退出/发完 stop）→ 停止并跳出内层循环，
                    // 否则 try_recv 会永远返回 Disconnected 导致本循环 100% CPU 空转。
                    running = false;
                    break;
                }
            }
        }
        if !running {
            break;
        }
        if let Some(dl) = deadline {
            if Instant::now() >= dl {
                break;
            }
        }

        // 等帧信号（最多 100ms 唤醒一次做心跳）
        let _ = sig_rx.recv_timeout(Duration::from_millis(100));

        if paused {
            // 排空帧池避免堆积，但不输出
            while let Ok(f) = frame_pool.TryGetNextFrame() {
                drop(f);
            }
        } else {
            // 节流到目标 fps
            while let Ok(frame) = frame_pool.TryGetNextFrame() {
                if last_emit.elapsed() < frame_interval {
                    drop(frame);
                    continue;
                }
                match process_frame(&frame, &device, &context, quality, out_w, out_h, crop_x, crop_y, crop_w, crop_h, &mut perf) {
                    Ok((w, h, jpeg)) => {
                        write_frame(w, h, &jpeg, sink);
                        frame_no += 1;
                        fps_count += 1;
                        last_emit = Instant::now();
                    }
                    Err(e) => {
                        eprintln!("[we-capture] 处理帧失败: {e}");
                    }
                }
                drop(frame);
                break; // 每轮只出一帧，保持节流
            }
        }

        // 心跳
        if last_beat.elapsed() >= Duration::from_secs(1) {
            let secs = last_beat.elapsed().as_secs_f64().max(0.001);
            let (m, c, e) = if perf.n > 0 {
                let k = perf.n as f64;
                (perf.map / k, perf.conv / k, perf.enc / k)
            } else {
                (0.0, 0.0, 0.0)
            };
            eprintln!(
                "[STATUS]{{\"fps\":{:.1},\"frame\":{},\"map_ms\":{:.1},\"conv_ms\":{:.1},\"enc_ms\":{:.1}}}",
                fps_count as f64 / secs,
                frame_no,
                m,
                c,
                e
            );
            fps_count = 0;
            perf = Perf::default();
            last_beat = Instant::now();
        }
    }

    unsafe {
        let _ = session.Close();
    }
    eprintln!("[we-capture] 捕获结束，共 {frame_no} 帧");
}

/// 每帧各阶段耗时累计（毫秒），用于心跳里输出性能画像
#[derive(Default)]
struct Perf {
    map: f64,
    conv: f64,
    enc: f64,
    n: u32,
}

/// 取一帧 → 按裁剪区域回读 BGRA →（可选盒式降采样）转 RGB → JPEG 编码
fn process_frame(
    frame: &windows::Graphics::Capture::Direct3D11CaptureFrame,
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    quality: u32,
    out_w: u32,
    out_h: u32,
    crop_x: u32,
    crop_y: u32,
    crop_w: u32,
    crop_h: u32,
    perf: &mut Perf,
) -> Result<(u32, u32, Vec<u8>), String> {
    let t0 = Instant::now();
    let surface = frame.Surface().map_err(|e| e.to_string())?;
    let access: IDirect3DDxgiInterfaceAccess = surface.cast().map_err(|e| e.to_string())?;
    let texture: ID3D11Texture2D = unsafe { access.GetInterface().map_err(|e| e.to_string())? };

    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };
    let nw = desc.Width;
    let nh = desc.Height;

    // 裁剪区域（帧坐标系）clamp 到帧内
    let cx = crop_x.min(nw);
    let cy = crop_y.min(nh);
    let cw = crop_w.min(nw - cx).max(1);
    let ch = crop_h.min(nh - cy).max(1);

    // 目标尺寸：请求小于裁剪区则降采样，否则 1:1
    let (ow, oh) = if out_w > 0 && out_h > 0 && (out_w < cw || out_h < ch) {
        (out_w.min(cw), out_h.min(ch))
    } else {
        (cw, ch)
    };

    // staging（CPU 可读），尺寸 = 裁剪区（避免搬回整个多显示器桌面）
    let mut sdesc = desc;
    sdesc.Usage = D3D11_USAGE_STAGING;
    sdesc.BindFlags = 0;
    sdesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
    sdesc.MiscFlags = 0;
    sdesc.Width = cw;
    sdesc.Height = ch;
    let mut staging: Option<ID3D11Texture2D> = None;
    unsafe {
        device
            .CreateTexture2D(&sdesc, None, Some(&mut staging))
            .map_err(|e| e.to_string())?
    };
    let staging = staging.ok_or_else(|| "CreateTexture2D 未返回纹理".to_string())?;

    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe {
        // 只拷贝裁剪区域，避免把整个多显示器桌面搬回 CPU
        let src_box = D3D11_BOX {
            left: cx,
            top: cy,
            front: 0,
            right: cx + cw,
            bottom: cy + ch,
            back: 1,
        };
        context.CopySubresourceRegion(&staging, 0, 0, 0, 0, &texture, 0, Some(&src_box));
        context
            .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            .map_err(|e| e.to_string())?;
    }
    perf.map += t0.elapsed().as_secs_f64() * 1000.0;

    let t1 = Instant::now();
    let src = mapped.pData as *const u8;
    let pitch = mapped.RowPitch as usize;
    let (cwz, chz, owz, ohz) = (cw as usize, ch as usize, ow as usize, oh as usize);
    let mut rgb = vec![0u8; owz * ohz * 3];
    unsafe {
        if owz == cwz && ohz == chz {
            // 1:1 BGRA → RGB（裁剪区与输出同尺寸）
            for y in 0..chz {
                let row = src.add(y * pitch);
                let drow = y * cwz * 3;
                for x in 0..cwz {
                    let s = row.add(x * 4);
                    let d = drow + x * 3;
                    rgb[d] = *s.add(2); // R
                    rgb[d + 1] = *s.add(1); // G
                    rgb[d + 2] = *s; // B
                }
            }
        } else {
            // 盒式降采样：每个目标像素取对应源区域均值（画质优于最近邻，开销与 1:1 相当）
            for oy in 0..ohz {
                let y0 = oy * chz / ohz;
                let y1 = ((oy + 1) * chz / ohz).max(y0 + 1).min(chz);
                let drow = oy * owz * 3;
                for ox in 0..owz {
                    let x0 = ox * cwz / owz;
                    let x1 = ((ox + 1) * cwz / owz).max(x0 + 1).min(cwz);
                    let (mut sr, mut sg, mut sb, mut cnt) = (0u32, 0u32, 0u32, 0u32);
                    for sy in y0..y1 {
                        let row = src.add(sy * pitch);
                        for sx in x0..x1 {
                            let s = row.add(sx * 4);
                            sb += *s as u32;
                            sg += *s.add(1) as u32;
                            sr += *s.add(2) as u32;
                            cnt += 1;
                        }
                    }
                    let d = drow + ox * 3;
                    rgb[d] = (sr / cnt) as u8;
                    rgb[d + 1] = (sg / cnt) as u8;
                    rgb[d + 2] = (sb / cnt) as u8;
                }
            }
        }
        context.Unmap(&staging, 0);
    }
    perf.conv += t1.elapsed().as_secs_f64() * 1000.0;

    let t2 = Instant::now();
    let mut out = Vec::new();
    {
        let enc = JpegEncoder::new(&mut out, quality.clamp(1, 100) as u8);
        enc.encode(&rgb, ow as u16, oh as u16, ColorType::Rgb)
            .map_err(|e| e.to_string())?;
    }
    perf.enc += t2.elapsed().as_secs_f64() * 1000.0;
    perf.n += 1;
    Ok((ow, oh, out))
}

/// 写一帧到输出目标（协议帧格式）
fn write_frame(w: u32, h: u32, jpeg: &[u8], sink: &mut dyn Write) {
    let total = 1 + 4 + 4 + jpeg.len();
    let mut buf = Vec::with_capacity(4 + total);
    buf.extend_from_slice(&(total as u32).to_le_bytes());
    buf.push(FMT_JPEG);
    buf.extend_from_slice(&w.to_le_bytes());
    buf.extend_from_slice(&h.to_le_bytes());
    buf.extend_from_slice(jpeg);
    let _ = sink.write_all(&buf);
    let _ = sink.flush();
}

/// 创建 D3D11 设备（BGRA 支持）
fn create_d3d11() -> windows::core::Result<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    let mut feature_level = D3D_FEATURE_LEVEL::default();
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            Some(&mut feature_level),
            Some(&mut context),
        )?;
    }
    Ok((device.unwrap(), context.unwrap()))
}

/// 从 ID3D11Device 得到 WinRT IDirect3DDevice
fn create_winrt_device(device: &ID3D11Device) -> windows::core::Result<IDirect3DDevice> {
    let dxgi: IDXGIDevice = device.cast()?;
    unsafe {
        let inspectable = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?;
        let dev: IDirect3DDevice = inspectable.cast()?;
        Ok(dev)
    }
}

/// 用 IGraphicsCaptureItemInterop 从 HWND 创建 GraphicsCaptureItem
fn capture_item_for_window(hwnd: HWND) -> windows::core::Result<GraphicsCaptureItem> {
    unsafe {
        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        interop.CreateForWindow(hwnd)
    }
}

/// 查找结果：WGC 只能捕获顶层窗口（Progman/WorkerW），但多显示器时该顶层窗覆盖整个
/// 虚拟桌面；故同时返回目标壁纸子窗的屏幕矩形，供 run_capture 裁剪到目标显示器。
struct FoundWindow {
    /// WGC 捕获目标：目标壁纸子窗的顶层祖先（Progman/WorkerW）
    root: HWND,
    /// 目标壁纸子窗在屏幕坐标系中的矩形（裁剪区域）；None = 不裁剪（整帧输出）
    rect: Option<RECT>,
}

/// 查找 Wallpaper Engine 的壁纸窗口，并返回其**顶层祖先**（Progman/WorkerW）。
/// WE 的渲染窗（WPEDesktopDX11Window）是桌面的子窗口，WGC 只接受顶层窗口，故取其 GA_ROOT。
/// 一个候选壁纸窗：WPE* 渲染子窗 + 它的屏幕矩形（≈ 所在显示器的矩形）
struct WeWindow {
    hwnd: HWND,
    rect: RECT,
    area: i64,
    cx: i32,
    cy: i32,
}

fn find_we_window(monitor_hint: u32) -> Option<FoundWindow> {
    unsafe {
        // 只在桌面顶层（Progman / 各 WorkerW）下查找 WE 的渲染子窗。
        // 关键：绝不对任意第三方顶层窗做 EnumChildWindows——那会因目标线程不泵消息而永久挂起。
        // Progman/WorkerW 属 explorer，消息循环正常，枚举安全。
        let mut kids_all: Vec<HWND> = Vec::new();
        let mut visit = |parent: HWND| {
            let mut kids: Vec<HWND> = Vec::new();
            let ptr = &mut kids as *mut Vec<HWND> as isize;
            let _ = EnumChildWindows(parent, Some(enum_collect), LPARAM(ptr));
            kids_all.extend(kids);
        };
        if let Ok(pm) = FindWindowExW(HWND::default(), HWND::default(), w!("Progman"), PCWSTR::null()) {
            visit(pm);
        }
        let mut ww = FindWindowExW(HWND::default(), HWND::default(), w!("WorkerW"), PCWSTR::null());
        while let Ok(wv) = ww {
            visit(wv);
            ww = FindWindowExW(HWND::default(), wv, w!("WorkerW"), PCWSTR::null());
        }

        let mut candidates: Vec<WeWindow> = Vec::new();
        for h in kids_all {
            if h.0.is_null() || !IsWindowVisible(h).as_bool() {
                continue;
            }
            let mut cls = [0u16; 64];
            let n = GetClassNameW(h, &mut cls).max(0) as usize;
            let name = String::from_utf16_lossy(&cls[..n.min(64)]);
            if !name.starts_with("WPE") {
                continue; // 只认 WE 渲染窗（WPEDesktopDX11Window 等）
            }
            let mut rc = RECT::default();
            if GetWindowRect(h, &mut rc).is_err() {
                continue;
            }
            let area = (rc.right - rc.left).max(0) as i64 * (rc.bottom - rc.top).max(0) as i64;
            if area < 100_000 {
                continue;
            }
            candidates.push(WeWindow { hwnd: h, rect: rc, area, cx: (rc.left + rc.right) / 2, cy: (rc.top + rc.bottom) / 2 });
        }
        if candidates.is_empty() {
            return None;
        }

        // 指定了目标显示器（WE MonitorN ≈ Windows 显示器设置编号 N）：
        // 选中心落在该显示器矩形内的壁纸窗；找不到再回退「面积最大」。
        if monitor_hint >= 1 {
            let monitors = enum_monitor_rects();
            if let Some(mr) = monitors.get((monitor_hint - 1) as usize) {
                let on_target = candidates
                    .iter()
                    .filter(|w| w.cx >= mr.left && w.cx < mr.right && w.cy >= mr.top && w.cy < mr.bottom)
                    .max_by_key(|w| w.area);
                match on_target {
                    Some(w) => return Some(FoundWindow { root: root_or_self(w.hwnd), rect: Some(w.rect) }),
                    None => eprintln!(
                        "[we-capture] 显示器 {monitor_hint} 上没有 WE 壁纸窗口 → 回退到面积最大的窗口"
                    ),
                }
            } else {
                eprintln!(
                    "[we-capture] 显示器序号 {monitor_hint} 超出范围（共 {} 台）→ 回退到面积最大的窗口",
                    monitors.len()
                );
            }
        }

        // 兜底 / 未指定：面积最大
        candidates
            .iter()
            .max_by_key(|w| w.area)
            .map(|w| FoundWindow { root: root_or_self(w.hwnd), rect: Some(w.rect) })
    }
}

/// 枚举系统显示器的矩形（EnumDisplayMonitors 顺序，通常与 Windows 显示器设置的编号一致）
fn enum_monitor_rects() -> Vec<RECT> {
    let mut out: Vec<RECT> = Vec::new();
    unsafe {
        let ptr = &mut out as *mut Vec<RECT> as isize;
        let _ = EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(enum_monitor_collect),
            LPARAM(ptr),
        );
    }
    out
}

unsafe extern "system" fn enum_monitor_collect(
    hmonitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let out = &mut *(lparam.0 as *mut Vec<RECT>);
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if GetMonitorInfoW(hmonitor, &mut info).as_bool() {
        out.push(info.rcMonitor);
    }
    true.into()
}

fn root_or_self(hwnd: HWND) -> HWND {
    unsafe {
        let root = GetAncestor(hwnd, GA_ROOT);
        if root.0.is_null() { hwnd } else { root }
    }
}

unsafe extern "system" fn enum_collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let vec = &mut *(lparam.0 as *mut Vec<HWND>);
    vec.push(hwnd);
    true.into()
}
