import type { CaptureScreenRect } from '../scene/SceneProtocol.ts'

export interface ScreenViewport { left: number; top: number; width: number; height: number }
export interface CaptureDrawRect { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }

/** 将页面桌面区域映射到捕获图像；越界部分留空，不能把边缘拉伸到窗口。 */
export function captureDrawRect(screen: CaptureScreenRect, viewport: ScreenViewport,
  imageW: number, imageH: number, canvasW: number, canvasH: number): CaptureDrawRect | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null
  const left = Math.max(screen.left, viewport.left), top = Math.max(screen.top, viewport.top)
  const right = Math.min(screen.left + screen.width, viewport.left + viewport.width)
  const bottom = Math.min(screen.top + screen.height, viewport.top + viewport.height)
  if (right <= left || bottom <= top) return null
  return {
    sx: (left - screen.left) * imageW / screen.width,
    sy: (top - screen.top) * imageH / screen.height,
    sw: (right - left) * imageW / screen.width,
    sh: (bottom - top) * imageH / screen.height,
    dx: (left - viewport.left) * canvasW / viewport.width,
    dy: (top - viewport.top) * canvasH / viewport.height,
    dw: (right - left) * canvasW / viewport.width,
    dh: (bottom - top) * canvasH / viewport.height,
  }
}

/** outer 尺寸是系统逻辑像素，inner 尺寸还受网页缩放影响。指针事件可校准标题栏偏移。 */
export function estimateViewportInsets(outerW: number, outerH: number, innerW: number, innerH: number,
  zoom: number, fullscreen: boolean): { x: number; y: number } {
  if (fullscreen) return { x: 0, y: 0 }
  const border = Math.min(16, Math.max(0, (outerW - innerW * zoom) / 2))
  return { x: border, y: Math.min(160, Math.max(0, outerH - innerH * zoom - border)) }
}
