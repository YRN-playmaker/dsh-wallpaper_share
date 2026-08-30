// 自包含测试：解析右眼/左眼球/睫毛 puppet.mdl，检查动画 id 与 animationlayers 引用
import fs from 'fs'
const f32At = (b, q) => new Float32Array(new Int32Array([(b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0]).buffer)[0]
const u32At = (b, q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) >>> 0
const i32At = (b, q) => (b[q] | (b[q+1]<<8) | (b[q+2]<<16) | (b[q+3]<<24)) | 0
const u16At = (b, q) => b[q] | (b[q+1]<<8)

function parsePuppetMdl(bytes) {
  const len = bytes.length
  const find = (tag, from) => {
    const t = new Uint8Array(tag.length)
    for (let i = 0; i < tag.length; i++) t[i] = tag.charCodeAt(i)
    let i = from
    while (i < len - tag.length) {
      let ok = true
      for (let k = 0; k < tag.length; k++) if (bytes[i+k] !== t[k]) { ok = false; break }
      if (ok) return i
      i++
    }
    return -1
  }
  if (bytes.length < 16) return null
  let material = ''
  let p = 0
  const magic1 = (() => {
    let s = ''
    while (p < len && bytes[p] !== 0 && s.length < 32) { s += String.fromCharCode(bytes[p]); p++ }
    p++
    return s
  })()
  if (!magic1.startsWith('0023') && !magic1.startsWith('0021') && !magic1.startsWith('0020') && !magic1.startsWith('0013')) return null
  p += 12
  if (p < len) {
    let s = ''
    let q = p
    while (q < len && bytes[q] !== 0 && s.length < 4096) { s += String.fromCharCode(bytes[q]); q++ }
    if (s.includes('"name"') || s.includes('{')) material = s
    p = q + 1
  }
  const mdls4 = find('MDLS0004', 0)
  const mdls3 = find('MDLS0003', 0)
  const mdls1 = find('MDLS0001', 0)
  const mdls = mdls4 >= 0 ? mdls4 : mdls3 >= 0 ? mdls3 : mdls1
  const mdlsIs3 = mdls >= 0 && mdls4 < 0
  const mdat = find('MDAT0001', 0)
  const mdla6 = find('MDLA0006', 0)
  const mdla1 = find('MDLA0001', 0)
  const mdla = mdla6 >= 0 ? mdla6 : mdla1
  const mdle = find('MDLE0002', 0)
  let boneCount = 0
  const mdlsBones = []
  if (mdls >= 0 && mdls + 18 + 76 <= len) {
    boneCount = u32At(bytes, mdls + 13)
    if (boneCount > 512) boneCount = 0
    if (mdlsIs3) {
      let q = mdls + 17
      for (let i = 0; i < boneCount && q + 77 <= len; i++) {
        const parent = i32At(bytes, q + 5)
        const mp = q + 13
        const bind = []
        for (let k = 0; k < 16; k++) bind.push(f32At(bytes, mp + k * 4))
        mdlsBones.push({ parent, bind })
        let j = mp + 64
        while (j < len && bytes[j] !== 0 && j < q + 4096) j++
        q = j + 1
      }
    } else {
      let q = mdls + 18
      for (let i = 0; i < boneCount && q + 76 <= len; i++) {
        const parent = i32At(bytes, q + 4)
        const mp = q + 12
        const bind = []
        for (let k = 0; k < 16; k++) bind.push(f32At(bytes, mp + k * 4))
        mdlsBones.push({ parent, bind })
        let j = mp + 64
        while (j < len && bytes[j] !== 0 && j < q + 4096) j++
        q = j + 2
      }
    }
  }
  let poseMatrices = null
  if (mdle >= 0 && mdle + 17 + 64 <= len) {
    const byteCount = u32At(bytes, mdle + 13)
    const count = byteCount / 64
    if (count >= 1 && count <= 512 && mdle + 17 + count * 64 <= len) {
      const mats = []
      for (let i = 0; i < count * 16; i++) mats.push(f32At(bytes, mdle + 17 + i * 4))
      poseMatrices = mats
    }
  }
  const bonePositions = {}
  const mdatNames = []
  if (mdat >= 0) {
    const mdatEnd = (() => { let e = len; if (mdla >= 0 && mdla > mdat) e = Math.min(e, mdla); if (mdle >= 0 && mdle > mdat) e = Math.min(e, mdle); return e })()
    const mdatCount = u16At(bytes, mdat + 13)
    if (mdatCount > 0 && mdatCount <= 256) {
      let q = mdat + 17
      for (let i = 0; i < mdatCount && q + 65 <= mdatEnd; i++) {
        let skips = 0
        while (skips < 4 && q < mdatEnd && bytes[q] === 0 && q + 66 <= mdatEnd) { q++; skips++ }
        let nm = ''
        let s = q
        while (s < mdatEnd && bytes[s] !== 0 && bytes[s] >= 32 && bytes[s] < 127 && nm.length < 128) { nm += String.fromCharCode(bytes[s]); s++ }
        if (nm.length < 1 || s >= mdatEnd || bytes[s] !== 0) break
        const mp = s + 1
        if (mp + 64 > mdatEnd) break
        mdatNames.push(nm)
        bonePositions[nm] = [f32At(bytes, mp + 48), f32At(bytes, mp + 52), f32At(bytes, mp + 56)]
        q = mp + 64
      }
    } else {
      let q = mdat + 17
      let guard = 0
      while (q + 66 <= mdatEnd && guard++ < 256) {
        let nm = ''
        let s = q
        while (s < mdatEnd && bytes[s] !== 0 && bytes[s] >= 32 && bytes[s] < 127 && nm.length < 128) { nm += String.fromCharCode(bytes[s]); s++ }
        if (nm.length < 1 || s >= mdatEnd || bytes[s] !== 0) break
        const mp = s + 1
        if (mp + 64 > mdatEnd) break
        mdatNames.push(nm)
        bonePositions[nm] = [f32At(bytes, mp + 48), f32At(bytes, mp + 52), f32At(bytes, mp + 56)]
        q = mp + 64
      }
    }
  }
  const bones = []
  const total = Math.max(boneCount, mdatNames.length, poseMatrices !== null ? poseMatrices.length / 16 : 0)
  for (let i = 0; i < total; i++) {
    const mdlsB = mdlsBones[i]
    const pose = poseMatrices !== null && i * 16 + 15 < poseMatrices.length ? poseMatrices.slice(i * 16, i * 16 + 16) : null
    bones.push({ name: mdatNames[i] ?? '', parent: mdlsB !== undefined ? mdlsB.parent : -1, bind: mdlsB !== undefined ? mdlsB.bind : null, pose })
  }
  const animations = []
  if (mdla >= 0 && mdla + 17 <= len) {
    const animCount = Math.max(0, Math.min(64, u32At(bytes, mdla + 13)))
    let q = mdla + 17
    for (let a = 0; a < animCount && q + 8 <= len; a++) {
      const id = u32At(bytes, q); q += 4
      q += 4
      let nm = ''
      while (q < len && bytes[q] !== 0 && nm.length < 128) { nm += String.fromCharCode(bytes[q]); q++ }
      q++
      let lp = ''
      while (q < len && bytes[q] !== 0 && lp.length < 128) { lp += String.fromCharCode(bytes[q]); q++ }
      q++
      if (nm === '' || q + 20 > len) break
      const duration = f32At(bytes, q); q += 4
      const bc = u32At(bytes, q); q += 4
      q += 4; q += 4; q += 4
      const dataLen = u32At(bytes, q); q += 4
      if (dataLen <= 0 || dataLen > len - q) break
      q++
      // 解析关键帧（简化）
      const kfs = []
      const frameCount = Math.floor(dataLen / 36)
      for (let f = 0; f < Math.min(frameCount, 3); f++) {
        const fp = q + f * 36
        const t = (bytes[fp] | (bytes[fp+1]<<8) | (bytes[fp+2]<<16)) >>> 0
        kfs.push(t)
      }
      q += dataLen
      animations.push({ id, name: nm, loop: lp === 'loop', boneCount: bc, duration, frameCount, kfs })
    }
  }
  return { material, bones, mesh: null, animations, bonePositions, magic: magic1 }
}

function utf8Slice(buf, a, b) { return Buffer.from(buf.subarray(a, b)).toString('utf8') }
const readPkg = (path) => {
  const buf = fs.readFileSync(path)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 0
  const readI32 = () => { const v = view.getInt32(pos, true); pos += 4; return v }
  const magicLen = readI32(); pos += magicLen; const version = readI32()
  const entries = []
  while (pos + 8 <= buf.length) {
    const nameLen = readI32(); if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = utf8Slice(buf, pos, pos + nameLen); pos += nameLen
    const offset = readI32(); const size = readI32()
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  const read = (n) => { const e = entries.find((x) => x.name === n); return e ? buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) : null }
  return { read, entries }
}
const pkg = readPkg('D:/SteamLibrary/steamapps/workshop/content/431960/2804379697/scene.pkg')
const refs = { '右眼': 479, '右睫毛': 313, '左眼球': 218, 'z左睫毛': 549 }
for (const [eye, refId] of Object.entries(refs)) {
  const mdlBuf = pkg.read(`models/${eye}_puppet.mdl`)
  if (!mdlBuf) { console.log(eye, ': no mdl'); continue }
  const model = parsePuppetMdl(mdlBuf)
  if (!model) { console.log(eye, ': parse FAILED'); continue }
  console.log(`=== ${eye} (ref anim=${refId}) ===`)
  console.log('magic:', model.magic, 'bones:', model.bones.length, 'animations:', model.animations.length)
  for (const a of model.animations) {
    const match = a.id === refId ? '  <== MATCH' : ''
    console.log(`  id=${a.id} name=${JSON.stringify(a.name)} loop=${a.loop} duration=${a.duration.toFixed(3)} frames=${a.frameCount}${match}`)
  }
}
