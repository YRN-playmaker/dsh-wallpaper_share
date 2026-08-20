// 验证 decodeTex + texMipToPng：7 个真实 .tex 全部应产出可用 mip0（图片或 raw→PNG）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { decodeTex, texMipToPng, texMimeOf } = await import(pathToFileURL(join(root, 'src/scene/SceneTex.ts')).href)

const WS = 'D:/SteamLibrary/steamapps/workshop/content/431960'
function parsePkg(path) {
  const buf = readFileSync(path)
  let pos = 16
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 1024 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { buf, dataStart, entries }
}

// [pkgId, texName, 期望 Header.Format, 期望 mip0 尺寸]
const CASES = [
  ['1516043085', 'materials/eva.tex', 0, '1920x1080'],     // RGBA8888, JPEG 容器
  ['2865923273', 'materials/Rebecca.tex', 0, '3840x2160'], // RGBA8888, PNG 容器
  ['2865923273', 'materials/rebecca_cyberpunk_logo.tex', 0, '3840x2160'],
  ['2804379697', 'materials/背景.tex', 0, '5349x3009'],
  ['2125735009', 'materials/401900.tex', 0, '3840x1080'],
  ['3463520581', 'materials/sky.tex', 4, '1920x1088'],    // DXT5 + LZ4
  ['3151551777', 'materials/RAIL2.tex', 4, '3840x1280'],   // DXT5 + LZ4
]

let pass = 0, fail = 0
for (const [pid, texName, expFormat, expDims] of CASES) {
  const p = parsePkg(join(WS, pid, 'scene.pkg'))
  const e = p.entries.find((x) => x.name === texName)
  if (!e) { fail++; console.log('  FAIL ' + texName + ' entry missing'); continue }
  const b = p.buf.subarray(p.dataStart + e.offset, p.dataStart + e.offset + e.size)
  const tex = decodeTex(new Uint8Array(b))
  const okFormat = tex !== null && tex.format === expFormat
  const okDims = tex !== null && (tex.mip0?.width + 'x' + tex.mip0?.height) === expDims
  const png = tex !== null ? texMipToPng(tex) : null
  const mime = tex !== null ? texMimeOf(tex) : null
  let pngOk = false
  if (png !== null && png.length > 24) {
    if (mime === 'image/jpeg') {
      // JPEG 纹理：原样返回 JPEG 字节
      pngOk = png[0] === 0xff && png[1] === 0xd8 && png[2] === 0xff
    } else if (png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47) {
      const w = ((png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19]) >>> 0
      const h = ((png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23]) >>> 0
      pngOk = w === tex?.mip0?.width && h === tex?.mip0?.height
    }
  }
  const ok = okFormat && okDims && pngOk
  if (ok) { pass++; console.log('  PASS ' + texName + ' fmt=' + tex.format + ' mip0=' + tex.mip0.width + 'x' + tex.mip0.height + ' kind=' + tex.mip0.kind + ' out=' + png.length + 'B mime=' + mime) }
  else {
    fail++
    console.log('  FAIL ' + texName + ' fmt=' + (tex?.format ?? 'null') + ' dims=' + (tex?.mip0 ? tex.mip0.width + 'x' + tex.mip0.height : 'null') + ' png=' + (pngOk ? 'ok' : 'bad') + ' | expect fmt=' + expFormat + ' dims=' + expDims)
  }
}
console.log('\nRESULT: ' + pass + ' pass, ' + fail + ' fail')
process.exit(fail === 0 ? 0 : 1)
