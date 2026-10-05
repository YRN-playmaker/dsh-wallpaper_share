// 生成 WebGL 校验页：把 ShakeGL 的 GLSL 与「官方公式的 JS 参考实现」逐像素对比，
// 结果写进 DOM，用 headless Chrome --dump-dom 读回数字。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodeTex, texMipToPng } from '../src/scene/SceneTex.ts'

const PKG = 'D:/SteamLibrary/steamapps/workshop/content/431960/3791428510/scene.pkg'
const OUT = resolve(import.meta.dirname, 'denia-out')
const IMG = resolve(OUT, 'gl-images')

function parsePkg(buf) {
  let pos = 0
  const i32 = () => { const v = buf.readInt32LE(pos); pos += 4; return v }
  const magicLen = i32(); pos += magicLen; pos += 4
  const entries = []
  for (;;) {
    if (pos + 8 > buf.length) break
    const nameLen = buf.readInt32LE(pos); pos += 4
    if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = buf.subarray(pos, pos + nameLen).toString('utf8'); pos += nameLen
    const offset = buf.readInt32LE(pos); pos += 4
    const size = buf.readInt32LE(pos); pos += 4
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  return { read: (n) => { const e = entries.find((x) => x.name === n); return e === undefined ? null : buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size) } }
}
const pkg = parsePkg(readFileSync(PKG))
mkdirSync(IMG, { recursive: true })
const meta = {}
for (const [entry, file] of [
  ['materials/09眼睛.tex', 'eyes.png'],
  ['materials/masks/shake_mask_73999545.tex', 'flow.png'],
  ['materials/masks/shake_mask_5bdd3707.tex', 'mask.png'],
]) {
  const tex = decodeTex(pkg.read(entry))
  if (tex === null) throw new Error('decode fail ' + entry)
  const png = texMipToPng(tex)
  if (png === null) throw new Error('png fail ' + entry)
  writeFileSync(resolve(IMG, file), png)
  meta[file] = { imgW: tex.imageWidth, imgH: tex.imageHeight, texW: tex.textureWidth, texH: tex.textureHeight, format: tex.format }
  console.log(`${file}: image=${tex.imageWidth}x${tex.imageHeight} canvas=${tex.textureWidth}x${tex.textureHeight} format=${tex.format}`)
}

// 从源码取出 GLSL（构建是直译，源码与实际产物一致）
const src = readFileSync(resolve(import.meta.dirname, '..', 'src', 'client', 'ShakeGL.ts'), 'utf8')
const grab = (name) => {
  const m = new RegExp('const ' + name + ' = `([\\s\\S]*?)`').exec(src)
  if (m === null) throw new Error('cannot extract ' + name)
  return m[1]
}
const VERT = grab('VERT_SRC')
const FRAG = grab('FRAG_SRC')

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>shake gl verify</title></head>
<body><pre id="out">running…</pre>
<script>
const VERT_SRC = ${JSON.stringify(VERT)};
const FRAG_SRC = ${JSON.stringify(FRAG)};
const META = ${JSON.stringify(meta)};
const STRENGTH = 0.4;                 // 达妮娅「眨眼」strength
const OFFSETS = [0, 0.25, 0.5, 0.75, 1];
const CHY = 3;                        // RG88 解码：方向场第二通道在 A
const CHM = 3;                        // R8 解码：mask 值在 A

function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load ' + src)); i.src = src; }); }

function bilinearRGBA(data, w, h, u, v, out) {
  const x = Math.min(w - 1.001, Math.max(0, u * w - 0.5));
  const y = Math.min(h - 1.001, Math.max(0, v * h - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  for (let c = 0; c < 4; c++) {
    const a = data[(y0 * w + x0) * 4 + c] * (1 - fx) + data[(y0 * w + x1) * 4 + c] * fx;
    const b = data[(y1 * w + x0) * 4 + c] * (1 - fx) + data[(y1 * w + x1) * 4 + c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
}

// 官方公式的独立 JS 参考（图像空间，y 向下；srcPx 为已裁剪到内容区的图层像素）
function referenceFrame(srcPx, flowPx, maskPx, W, H, fw, fh, mw, mh, offset) {
  const out = new Uint8ClampedArray(W * H * 4);
  const s = new Float32Array(4), k = new Float32Array(4), m = new Float32Array(4);
  const amp = STRENGTH * STRENGTH;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = (y + 0.5) / H;
    bilinearRGBA(flowPx, fw, fh, u, v, k);
    const fmx = (k[0] / 255 - 0.498) * 2;
    const fmy = (k[CHY] / 255 - 0.498) * 2;
    const tox = offset * amp * fmx, toy = offset * amp * fmy;
    bilinearRGBA(srcPx, W, H, u, v, s);
    bilinearRGBA(srcPx, W, H, u + tox, v + toy, m);
    bilinearRGBA(maskPx, mw, mh, u + tox, v + toy, k);
    const mv = k[CHM] / 255;
    const i = (y * W + x) * 4;
    for (let c = 0; c < 4; c++) out[i + c] = s[c] * (1 - mv) + m[c] * mv;
  }
  return out;
}

function pixels(img, sx, sy, sw, sh, dw, dh) {
  const c = document.createElement('canvas'); c.width = dw; c.height = dh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  return g.getImageData(0, 0, dw, dh).data;
}

function compile(gl, type, src) {
  const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('compile: ' + gl.getShaderInfoLog(sh));
  return sh;
}

(async () => {
  const [eyesImg, flowImg, maskImg] = await Promise.all([
    loadImg('gl-images/eyes.png'), loadImg('gl-images/flow.png'), loadImg('gl-images/mask.png'),
  ]);
  // 图层内容区（与客户端一致：image 尺寸 = 200x355）
  const W = META['eyes.png'].imgW, H = META['eyes.png'].imgH;
  const fw = META['flow.png'].imgW, fh = META['flow.png'].imgH;
  const mw = META['mask.png'].imgW, mh = META['mask.png'].imgH;
  const srcPx = pixels(eyesImg, 0, 0, W, H, W, H);
  const flowPx = pixels(flowImg, 0, 0, fw, fh, fw, fh);
  const maskPx = pixels(maskImg, 0, 0, mw, mh, mw, mh);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) { document.getElementById('out').textContent = 'NO_WEBGL'; return; }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT_SRC));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link fail');
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_Pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  function upload(img) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }
  const tSrc = upload(eyesImg), tFlow = upload(flowImg), tMask = upload(maskImg);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tSrc); gl.uniform1i(gl.getUniformLocation(prog, 'u_Src'), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tFlow); gl.uniform1i(gl.getUniformLocation(prog, 'u_Flow'), 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tMask); gl.uniform1i(gl.getUniformLocation(prog, 'u_Mask'), 2);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_UseMask'), 1);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_FlowYFromAlpha'), 1);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_MaskFromAlpha'), 1);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_Amp'), STRENGTH);
  gl.uniform2f(gl.getUniformLocation(prog, 'u_SrcRect'), W / META['eyes.png'].texW, H / META['eyes.png'].texH);
  gl.uniform2f(gl.getUniformLocation(prog, 'u_FlowRect'), fw / META['flow.png'].texW, fh / META['flow.png'].texH);
  gl.uniform2f(gl.getUniformLocation(prog, 'u_MaskRect'), mw / META['mask.png'].texW, mh / META['mask.png'].texH);
  gl.viewport(0, 0, W, H);

  const lines = ['W=' + W + ' H=' + H + ' srcCanvas=' + META['eyes.png'].texW + 'x' + META['eyes.png'].texH];
  // 图层最终是叠在场景（不透明）上的：按 alpha 合成到皮肤底色再比较，
  // 避免「全透明像素的 RGB 在 canvas 预乘往返中丢失」污染判定。
  const BG = [240, 211, 189];
  const comp = (px, i) => {
    const a = px[i + 3] / 255;
    return [px[i] * a + BG[0] * (1 - a), px[i + 1] * a + BG[1] * (1 - a), px[i + 2] * a + BG[2] * (1 - a)];
  };
  for (const off of OFFSETS) {
    gl.uniform1f(gl.getUniformLocation(prog, 'u_Offset'), off);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const glPx = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, glPx);
    const ref = referenceFrame(srcPx, flowPx, maskPx, W, H, fw, fh, mw, mh, off);
    let maxD = 0, sum = 0, n = 0, big = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const j = ((H - 1 - y) * W + x) * 4;   // readPixels 自下而上，翻转对齐
        const a = comp(glPx, i), b = comp(ref, j);
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(a[c] - b[c]);
          if (d > maxD) maxD = d;
          sum += d; n++;
          if (d > 8) big++;
        }
      }
    }
    lines.push('offset=' + off + ' maxDiff=' + maxD.toFixed(0) + ' meanDiff=' + (sum / n).toFixed(3) + ' px_over8=' + big);
  }
  document.getElementById('out').textContent = lines.join('\\n');
})().catch((e) => { document.getElementById('out').textContent = 'ERROR ' + e.message; });
</script></body></html>`
writeFileSync(resolve(OUT, 'gl-verify.html'), html, 'utf8')
console.log('gl-verify.html written')
