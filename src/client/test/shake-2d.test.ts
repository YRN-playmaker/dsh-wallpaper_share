import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAKE_2D_PIXEL_BUDGET, shakeMeanFlow } from '../Shake2D.ts';

/** 构造单通道值写进 RGBA 光栅（模拟 decodeMip 的解码语义） */
function raster(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { data, w, h };
}

test('shakeMeanFlow：方向场全 0.5（= 无位移）→ 平均位移为 0', () => {
  const flow = raster(8, 8, () => [127, 127, 127, 127]);
  const [mx, my] = shakeMeanFlow(flow, null, true, true);
  assert.ok(Math.abs(mx) < 0.01 && Math.abs(my) < 0.01, `got ${mx},${my}`);
});

test('shakeMeanFlow：RG88 语义（y 在 A 通道）→ 只取到 x 方向的正位移', () => {
  // r = 255 → flowMask.x = (1 - 0.498)*2 ≈ 1.004；a（= 第二通道）= 127 → y ≈ 0.004
  const flow = raster(8, 8, () => [255, 255, 255, 127]);
  const [mx, my] = shakeMeanFlow(flow, null, true, true);
  assert.ok(Math.abs(mx - 1.004) < 0.01, `mx=${mx}`);
  assert.ok(Math.abs(my - 0.004) < 0.01, `my=${my}`);
  // 若误按 .g 读取（RGBA 语义），x/y 会同时 ~1.004（对角位移）——这是此前的错误实现
  const [gx, gy] = shakeMeanFlow(flow, null, false, false);
  assert.ok(Math.abs(gx - 1.004) < 0.01 && Math.abs(gy - 1.004) < 0.01, `got ${gx},${gy}`);
});

test('shakeMeanFlow：不透明度 mask 按值加权（mask=0 的区域不贡献位移）', () => {
  const flow = raster(8, 8, (x) => (x < 4 ? [255, 255, 255, 127] : [127, 127, 127, 127]));
  // mask：R8 解码语义 → 值在 A；整张 0 → 全部位移被屏蔽
  const zero = raster(8, 8, () => [255, 255, 255, 0]);
  const [zx, zy] = shakeMeanFlow(flow, zero, true, true);
  assert.ok(Math.abs(zx) < 1e-6 && Math.abs(zy) < 1e-6, `全 0 mask 应完全屏蔽，got ${zx},${zy}`);
  // 半张 0（边界处双线性过渡，允许小残差）
  const half = raster(8, 8, (x) => [255, 255, 255, x < 4 ? 0 : 255]);
  const [hx] = shakeMeanFlow(flow, half, true, true);
  assert.ok(hx > 0 && hx < 0.15, `半张 mask 应只剩一小部分位移，got ${hx}`);
  // 无 mask 时 x 方向位移约为一半
  const [nx] = shakeMeanFlow(flow, null, true, true);
  assert.ok(Math.abs(nx - 1.004 / 2) < 0.02, `nx=${nx}`);
});

test('Shake2D 像素预算为正且有界', () => {
  assert.ok(SHAKE_2D_PIXEL_BUDGET >= 250_000 && SHAKE_2D_PIXEL_BUDGET <= 4_000_000);
});
