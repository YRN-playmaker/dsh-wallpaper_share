// 检查 .tex 画布内「图像区域」的位置：右边距/下边距是否为空（决定 UV 映射方向）
import { readFileSync } from 'node:fs'
import { parseScenePkg } from '../src/scene/ScenePkg.ts'
import { decodeTex } from '../src/scene/SceneTex.ts'

const pkgBuf = new Uint8Array(readFileSync('D:/SteamLibrary/steamapps/workshop/content/431960/3766677415/scene.pkg'))
const pkg = parseScenePkg(pkgBuf)
for (const name of ['materials/角色.tex', 'materials/发束.tex', 'materials/头发.tex']) {
  const tex = decodeTex(pkg.read(name))
  const { textureWidth: tw, textureHeight: th, imageWidth: iw, imageHeight: ih } = tex
  const px = tex.mip0.rgba
  const alphaAt = (x, y) => px[(y * tw + x) * 4 + 3]
  const lumAt = (x, y) => (px[(y * tw + x) * 4] + px[(y * tw + x) * 4 + 1] + px[(y * tw + x) * 4 + 2]) / 3
  const stat = (x0, x1, y0, y1) => {
    let a0 = 0, n = 0, l = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const a = alphaAt(x, y); if (a === 0) a0++; l += lumAt(x, y); n++ }
    return `透明占比=${(a0 / n * 100).toFixed(1)}% 平均亮度=${(l / n).toFixed(1)}`
  }
  console.log(`${name} 画布=${tw}x${th} 图像=${iw}x${ih}（右多 ${tw - iw}px，下多 ${th - ih}px）`)
  console.log('  图像区左上   : ' + stat(0, Math.min(iw, tw), 0, Math.min(ih, th)))
  console.log('  右侧边距     : ' + stat(iw, tw, 0, th))
  console.log('  下侧边距     : ' + stat(0, tw, ih, th))
  console.log('  左侧 4 列    : ' + stat(0, Math.min(4, tw), 0, th))
  console.log('  上侧 4 行    : ' + stat(0, tw, 0, Math.min(4, th)))
}
