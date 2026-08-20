// 单元测试：DXT1/DXT5/RGBA8888 解码器（合成块验证）
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'

const here = fileURLToPath(import.meta.url).replace(/\\/g, '/')
const root = here.slice(0, here.lastIndexOf('/_dev/'))
const { decodeMip } = await import(pathToFileURL(join(root, 'src/scene/TexDecode.ts')).href)

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')) }
}

// 1) RGBA8888 直通
{
  const w = 4, h = 4
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h * 4; i++) data[i] = (i * 7) & 0xff
  const out = decodeMip('rgba8888', data, 0, w, h)
  let same = true
  for (let i = 0; i < w * h * 4; i++) if (out[i] !== data[i]) same = false
  check('RGBA8888 passthrough', same, 'len=' + out.length)
}

// 2) DXT1 纯色块：color0=color1=红色 (RGB565 0xF800)，全索引 0 → 全红不透明
{
  const w = 4, h = 4
  const data = new Uint8Array(8)
  data[0] = 0x00; data[1] = 0xf8  // color0 = 0xF800 (red)
  data[2] = 0x00; data[3] = 0xf8  // color1 = 0xF800
  // 全索引 0
  const out = decodeMip('dxt1', data, 0, w, h)
  let ok = true
  for (let i = 0; i < 16; i++) {
    if (out[i * 4] !== 255 || out[i * 4 + 1] !== 0 || out[i * 4 + 2] !== 0 || out[i * 4 + 3] !== 255) ok = false
  }
  check('DXT1 solid red (indices=0)', ok, JSON.stringify([...out.slice(0, 8)]))
}

// 3) DXT1 透明块：color0 < color1（3 色模式），索引 3 → 全透明
{
  const w = 4, h = 4
  const data = new Uint8Array(8)
  data[0] = 0x00; data[1] = 0x00  // color0 = 0x0000 (black)
  data[2] = 0xff; data[3] = 0xff  // color1 = 0xFFFF (white) → color0<color1 → 3-color
  // 索引全部 = 3（二进制 11）
  data[4] = 0xff; data[5] = 0xff; data[6] = 0xff; data[7] = 0xff
  const out = decodeMip('dxt1', data, 0, w, h)
  let ok = true
  for (let i = 0; i < 16; i++) if (out[i * 4 + 3] !== 0) ok = false
  check('DXT1 3-color transparent (idx=3)', ok)
}

// 4) DXT5 透明 alpha 块：a0=255, a1=0 (a0>a1 → 8 步)，索引 0 → alpha 255
{
  const w = 4, h = 4
  const data = new Uint8Array(16)
  data[0] = 255; data[1] = 0  // a0=255, a1=0 → 8 步插值
  // alpha 索引全 0
  data[2] = 0; data[3] = 0; data[4] = 0; data[5] = 0; data[6] = 0; data[7] = 0
  // 颜色：color0=0xF800 red, color1=0xF800, 全索引 0
  data[8] = 0x00; data[9] = 0xf8
  data[10] = 0x00; data[11] = 0xf8
  data[12] = 0; data[13] = 0; data[14] = 0; data[15] = 0
  const out = decodeMip('dxt5', data, 0, w, h)
  let ok = true
  for (let i = 0; i < 16; i++) {
    if (out[i * 4] !== 255 || out[i * 4 + 3] !== 255) ok = false
  }
  check('DXT5 alpha=255 (idx=0) + red', ok, JSON.stringify([...out.slice(0, 8)]))
}

// 5) DXT5 全 0 颜色（color0=color1=0, 索引0）→ 黑 + alpha 索引 7 场景：a0=0,a1=255 → 6 步插值, idx=7 → alpha 0
{
  const w = 4, h = 4
  const data = new Uint8Array(16)
  data[0] = 0; data[1] = 255  // a0=0, a1=255 → 6 步（alphas[6]=0, alphas[7]=255）→ idx7=255?? 
  // 等等：a0<=a1 时 alphas[6]=0, alphas[7]=255。若想测 alpha 0 用 idx=6。
  // 索引全 6：3bit 每像素 LSB 优先（值 6 = 位流 0,1,1 每像素重复）
  // 48 位打包字节 = B6 6D DB B6 6D DB
  data[2] = 0xb6; data[3] = 0x6d; data[4] = 0xdb; data[5] = 0xb6; data[6] = 0x6d; data[7] = 0xdb
  data[8] = 0; data[9] = 0; data[10] = 0; data[11] = 0 // color0=0 black
  data[12] = 0; data[13] = 0; data[14] = 0; data[15] = 0
  const out = decodeMip('dxt5', data, 0, w, h)
  let ok = true
  for (let i = 0; i < 16; i++) if (out[i * 4 + 3] !== 0) ok = false
  check('DXT5 alpha=0 (idx=6, 6-step mode)', ok, 'a=' + out[3])
}

// 6) DXT5 非 4 倍宽高（6x5）：不应越界
{
  const w = 6, h = 5
  const data = new Uint8Array(32) // 2x2 块 DXT5 = 64B? 不，6x5 → ceil(6/4)*ceil(5/4)=4 块 *16 = 64
  const full = new Uint8Array(64)
  for (let i = 0; i < 8; i++) full[i] = 255 // alpha 全 255
  full[0] = 255; full[1] = 128
  full[8] = 0xf8; full[9] = 0xf8 >> 8 // 随便
  let threw = false
  try { decodeMip('dxt5', full, 0, w, h) } catch (e) { threw = true }
  check('DXT5 non-multiple-of-4 (6x5) no throw', !threw)
}

console.log('\nRESULT: ' + pass + ' pass, ' + fail + ' fail')
process.exit(fail === 0 ? 0 : 1)
