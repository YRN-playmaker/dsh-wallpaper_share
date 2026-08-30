/**
 * DWP 全局背景层（R4 真实渲染）：一个 fixed 全屏 canvas，用 mountDwp() 把已装 DWP 画成
 * DSH 背景。与 WE 的 scene/video/iframe 层互斥（由 index.ts 的 applyBackground 保证只有一类在跑）。
 * 本模块只管"这一层"的画布生命周期 + 视觉（模糊/缩放），不碰 store，避免与 index.ts 循环引用。
 */
import { mountDwp } from './dwp-stage.ts'
import type { Handle } from 'dwp-web'

export class DwpBackgroundLayer {
  private canvas: HTMLCanvasElement | null = null
  private handle: Handle | null = null
  private mountingId = ''
  private mountedId = ''

  /** 当前正在挂载或已挂载的 DWP id（'' = 无）。 */
  currentId(): string { return this.mountedId !== '' ? this.mountedId : this.mountingId }

  private ensureCanvas(): HTMLCanvasElement {
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

  /** 挂载指定 DWP 为背景。同 id 幂等；换 id 先销毁旧的。异步（拉 scene+资源）。 */
  async mount(id: string): Promise<void> {
    if (this.mountingId === id || this.mountedId === id) return
    this.disposeHandle()
    this.mountingId = id
    const canvas = this.ensureCanvas()
    try {
      const handle = await mountDwp(canvas, id)
      // 挂载期间可能被 unmount / 换 id 取代：此时丢弃这次结果
      if (this.mountingId !== id) { handle.dispose(); return }
      this.handle = handle
      this.mountedId = id
      this.mountingId = ''
    } catch (e) {
      if (this.mountingId === id) this.mountingId = ''
      throw e
    }
  }

  /** 套用与 WE 层一致的视觉（模糊 + 轻微放大，避免模糊边缘露底）。 */
  applyVisuals(blurPx: number, scale: number): void {
    if (this.canvas === null) return
    this.canvas.style.filter = blurPx > 0 ? 'blur(' + blurPx + 'px)' : 'none'
    this.canvas.style.transform = 'scale(' + scale.toFixed(3) + ')'
  }

  private disposeHandle(): void {
    if (this.handle !== null) { this.handle.dispose(); this.handle = null }
    this.mountedId = ''
    this.mountingId = ''
  }

  /** 卸载：停渲染 + 移除画布。 */
  unmount(): void {
    this.disposeHandle()
    if (this.canvas !== null) { this.canvas.remove(); this.canvas = null }
  }
}
