/**
 * DWP 全局背景层（R4 真实渲染）：一个 fixed 全屏 canvas，用 mountDwp() 把已装 DWP 画成
 * DSH 背景。与 WE 的 scene/video/iframe 层互斥（由 index.ts 的 applyBackground 保证只有一类在跑）。
 * 本模块只管"这一层"的画布生命周期 + 视觉（模糊/缩放），不碰 store，避免与 index.ts 循环引用。
 */
import { mountDwp } from './dwp-stage.ts'
import type { Handle } from 'dwp-web'
import type { VarValue } from 'dwp-core'

export class DwpBackgroundLayer {
  private canvas: HTMLCanvasElement | null = null
  private handle: Handle | null = null
  private mountingId = ''
  private mountedId = ''
  /**
   * 最新实时变量（按键累积）。不同来源互不覆盖（时钟 vs 工作区脉搏），
   * 每次挂载成功后整表重放一次 —— 于是"切到另一张壁纸""切档位重新挂载"都能立刻拿到当前
   * 时间/档位，而不是干等下一次变量变化（夜间切入日夜壁纸却一直显示白天就是这么来的）。
   */
  private liveVars: Record<string, VarValue> = {}
  /**
   * 挂载序号：每次 mount/unmount 自增，异步结果只有在序号仍是最新时才允许接管状态。
   * 只比 id 是不够的 —— 同一张壁纸切画质时新旧请求的 id 相同，旧（低清）结果可能后到达并覆盖新的。
   */
  private seq = 0
  /** 纹理档位：'hd' = 允许拉场景声明的高档纹理，'sd' = 高档资源用占位图顶替（见 dwp-stage.ts） */
  private quality: 'sd' | 'hd' = 'sd'

  /** 当前正在挂载或已挂载的 DWP id（'' = 无）。 */
  currentId(): string { return this.mountedId !== '' ? this.mountedId : this.mountingId }

  /**
   * 切换纹理档位（渲染模式「增强/完整」→ hd，「预览/捕获」→ sd）。
   * 档位变了必须**重新挂载**：资源集合在 mount 时就定好了（低档位根本没拉 8K 纹理），
   * 光改变量换不出另一档的图。已挂载时这里先卸载再按新档位挂回去。
   */
  setQuality(q: 'sd' | 'hd'): void {
    if (q === this.quality) return
    this.quality = q
    const id = this.currentId()
    if (id === '') return
    this.unmount()
    void this.mount(id)
  }

  /** 当前 DOM 中的舞台 canvas（mount 内部 GL→Canvas2D 降级会换新元素，按 data-dwp-stage 定位）。 */
  private liveCanvas(): HTMLCanvasElement | null {
    return document.querySelector('canvas[data-dwp-stage="1"]') as HTMLCanvasElement | null
  }

  private ensureCanvas(): HTMLCanvasElement {
    const live = this.liveCanvas()
    if (live !== null) { this.canvas = live; return live }
    if (this.canvas === null) {
      const c = document.createElement('canvas')
      c.style.position = 'fixed'
      c.style.top = '0'
      c.style.left = '0'
      c.style.width = '100%'
      c.style.height = '100%'
      c.style.zIndex = '-2'
      c.style.pointerEvents = 'none'
      c.dataset.dwpStage = '1'
      this.canvas = c
    }
    if (this.canvas.parentNode === null) document.body.appendChild(this.canvas)
    return this.canvas
  }

  /** 挂载指定 DWP 为背景。同 id 幂等（除非 force）；换 id / 换档位先销毁旧的。异步（拉 scene+资源）。 */
  async mount(id: string, opts?: { force?: boolean }): Promise<void> {
    if (opts?.force !== true && (this.mountingId === id || this.mountedId === id)) return
    this.disposeHandle()
    const mySeq = ++this.seq
    this.mountingId = id
    const canvas = this.ensureCanvas()
    try {
      const handle = await mountDwp(canvas, id, {
        quality: this.quality,
        onDegrade: (d) => { if (d.length) console.warn('[dwp] 降级/告警：', d.join(', ')) },
      })
      // 过期判定：期间发生过 unmount / 换壁纸 / 换档位 → 丢弃这次结果（按序号，不按 id）
      if (mySeq !== this.seq) { handle.dispose(); return }
      this.handle = handle
      this.mountedId = id
      this.mountingId = ''
      // 挂载完成 → 重放最新变量（首发不闪空场景，切换壁纸也立刻拿到时间/档位）
      if (Object.keys(this.liveVars).length > 0) handle.setParams(this.liveVars)
    } catch (e) {
      if (mySeq === this.seq) this.mountingId = ''
      throw e
    }
  }

  /** 套用与 WE 层一致的视觉（模糊 + 轻微放大，避免模糊边缘露底）。 */
  applyVisuals(blurPx: number, scale: number): void {
    const c = this.liveCanvas() ?? this.canvas
    if (c === null) return
    c.style.filter = blurPx > 0 ? 'blur(' + blurPx + 'px)' : 'none'
    c.style.transform = 'scale(' + scale.toFixed(3) + ')'
  }

  /**
   * 实时变量喂食（时钟、工作区脉搏等）。
   * 挂载中/未挂载时先累加到 liveVars（**按键合并**，不同来源互不覆盖），
   * 已挂载则把本次的键立即推给运行时（Handle.setParams 本身也是逐键覆写）。
   */
  setLiveVars(map: Record<string, VarValue>): void {
    this.liveVars = { ...this.liveVars, ...map }
    if (this.handle === null) return
    this.handle.setParams(map)
  }

  /** 当前累积的实时变量（测试/诊断用）。 */
  currentVars(): Record<string, VarValue> { return { ...this.liveVars } }

  private disposeHandle(): void {
    if (this.handle !== null) { this.handle.dispose(); this.handle = null }
    this.mountedId = ''
    this.mountingId = ''
  }

  /** 卸载：停渲染 + 移除画布。序号自增 → 任何在途挂载的结果都会被丢弃。 */
  unmount(): void {
    this.seq++
    this.disposeHandle()
    const c = this.liveCanvas() ?? this.canvas
    if (c !== null) c.remove()
    this.canvas = null
  }
}
