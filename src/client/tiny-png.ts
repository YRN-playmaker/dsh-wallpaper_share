/**
 * 1×1 全透明 PNG（浏览器安全的常量，单测校验过结构与可解压性）。
 *
 * 用途：低档位时顶替 scene.dsh.hdAssets 声明的高档纹理（见 dwp-stage.ts）。
 * 为什么是"顶替"而不是"不传"：@dwp/web 的 loadAssets 对缺失资源直接抛错（整次挂载失败），
 * 所以必须给一个合法但极小的位图；这些图层在低档位 alpha 恒 0，画面上完全看不出来。
 *
 * 这份字节由本仓库自己的编码器产出（src/launcher/png.ts 的 encodePngRgba(1,1,[0,0,0,0])），
 * 并由 src/client/test/tiny-png.test.ts 逐块校验 CRC、IHDR 与 IDAT 可解压 —— 手抄 base64
 * 曾经抄坏过一次（zlib 校验和不过 → createImageBitmap 报 "source image could not be decoded"），
 * 所以这里配了回归测试，别再手改这个常量。
 */
const BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='

/** 1×1 RGBA、全透明、filter 0 的合法 PNG 字节。 */
export const TINY_PNG: Uint8Array = Uint8Array.from(atob(BASE64), (c) => c.charCodeAt(0))

/** 解码用的 base64（测试直接校验它，避免依赖 atob 环境）。 */
export const TINY_PNG_BASE64 = BASE64
