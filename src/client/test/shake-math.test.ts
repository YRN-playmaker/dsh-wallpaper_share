import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHAKE_TWO_PI,
  shakeFlowMask,
  shakeOffset,
  shakePulseInfo,
  shakeTexCoordOffset,
  type ShakeParams,
} from '../shake-math.ts';

/** 达妮娅 Denia（3791428510）眼睛层「眨眼」的实测参数（scene.json passes[0]） */
const DENIA: ShakeParams = { speed: 1, bounds: [0.992, 0.998], friction: [1, 1], direction: 1 };

test('shakeOffset：基频周期 = 2π / speed（WE 的 M_PI_2 实为 2π，不是 π/2）', () => {
  assert.equal(SHAKE_TWO_PI, 6.28318530718);
  const p: ShakeParams = { speed: 1, bounds: [0, 1], friction: [1, 1], direction: 0 };
  for (const t of [0, 0.3, 1.5707963, 4.2]) {
    assert.ok(Math.abs(shakeOffset(t, p) - shakeOffset(t + SHAKE_TWO_PI, p)) < 1e-9, `t=${t} 应满足 2π 周期`);
  }
  // speed=2 → 周期减半
  const p2: ShakeParams = { ...p, speed: 2 };
  for (const t of [0.1, 0.8, 2.5]) {
    assert.ok(Math.abs(shakeOffset(t, p2) - shakeOffset(t + SHAKE_TWO_PI / 2, p2)) < 1e-9, `speed=2 t=${t}`);
  }
});

test('shakeOffset：bounds 是脉冲阈值——达妮娅眨眼只在正弦峰值附近出现一次窄脉冲', () => {
  const info = shakePulseInfo(DENIA);
  assert.ok(Math.abs(info.period - SHAKE_TWO_PI) < 1e-6, '周期 2π');
  assert.ok(Math.abs(info.peakAt - Math.PI / 2) < 0.01, '峰值在 sin=1 处');
  // 脉冲宽度实测约 0.22s（原版渲染一帧眨眼≈0.2s）
  assert.ok(info.aboveHalfSpan > 0.18 && info.aboveHalfSpan < 0.26, `脉冲宽度=${info.aboveHalfSpan}`);
  // 周期内绝大部分时间为 0（不位移）——这正是"每 6.28s 眨一下"而不是持续滑动
  assert.equal(shakeOffset(0, DENIA), 0);
  assert.equal(shakeOffset(Math.PI, DENIA), 0);
  assert.equal(shakeOffset(Math.PI / 2 + 0.6, DENIA), 0);
  assert.equal(shakeOffset(Math.PI / 2, DENIA), 1);
  assert.ok(shakeOffset(1.5, DENIA) > 0.7 && shakeOffset(1.5, DENIA) < 0.85, '脉冲上升沿');
});

test('shakeOffset：bounds=[0,1] 时为连续摆动（编辑器默认），DIRECTION center 映射到 -1..1', () => {
  const p: ShakeParams = { speed: 1, bounds: [0, 1], friction: [1, 1], direction: 0 };
  assert.ok(Math.abs(shakeOffset(0, p) - (0.5 * 2 - 1)) < 1e-9, 't=0 → 0（居中）');
  assert.ok(Math.abs(shakeOffset(Math.PI / 2, p) - (0.998 * 2 - 1)) < 1e-6, '峰值 → +0.996');
  assert.ok(Math.abs(shakeOffset(-Math.PI / 2, p) - (0.002 * 2 - 1)) < 1e-6, '谷值 → -0.996');
});

test('shakeOffset：DIRECTION 1/2 = 单向（1 原样、2 取负）', () => {
  const peak = Math.PI / 2;
  assert.equal(shakeOffset(peak, { ...DENIA, direction: 1 }), 1);
  assert.equal(shakeOffset(peak, { ...DENIA, direction: 2 }), 0);
  const up: ShakeParams = { speed: 1, bounds: [0, 1], friction: [1, 1], direction: 0 };
  assert.ok(Math.abs(shakeOffset(peak, { ...up, direction: 2 }) - (0.998 - 1)) < 1e-6, 'right 分支 = offset-1（仅负向）');
});

test('shakeOffset：friction 是上升/下降沿的幂曲线', () => {
  const p: ShakeParams = { speed: 1, bounds: [0, 1], friction: [2, 2], direction: 1 };
  // cos(time) >= 0 → pow(offset, friction.y)
  assert.ok(Math.abs(shakeOffset(Math.PI / 2, p) - Math.pow(0.998, 2)) < 1e-9);
  // cos(time) < 0 → 1 - pow(1 - offset, friction.x)
  const t = Math.PI * 1.5;
  const raw = Math.sin(t) * 0.498 + 0.5;
  assert.ok(Math.abs(shakeOffset(t, p) - (1 - Math.pow(1 - raw, 2))) < 1e-9);
});

test('shakeOffset：AUDIOPROCESSING 打开时用音频脉冲取代计时脉冲（我们无音频分析 → 视为有声）', () => {
  const aud: ShakeParams = { speed: 1, bounds: [0, 1], friction: [1, 1], direction: 1, audioProcessing: true };
  assert.equal(shakeOffset(0.3, aud), 0, 'left：1 - pulse = 0 → 静止睁眼');
  assert.equal(shakeOffset(1.2, { ...aud, direction: 0 }), 1);
  assert.equal(shakeOffset(1.2, { ...aud, direction: 2 }), -1);
});

test('shakeFlowMask / shakeTexCoordOffset：官方 flowMask = (rg-0.498)×2，位移 = offset×strength²×flowMask', () => {
  const [fx, fy] = shakeFlowMask(1, 0.5);
  assert.ok(Math.abs(fx - 1.004) < 1e-9);
  assert.ok(Math.abs(fy - 0.004) < 1e-9);
  const [ox, oy] = shakeTexCoordOffset(1, 0.4, [1, 0]);
  assert.ok(Math.abs(ox - 0.16) < 1e-9, 'strength 0.4 → 位移 0.16 UV（= 眼睛纹理 201px 上的 32px）');
  assert.equal(oy, 0);
  // 0.5 灰度 = 无位移
  assert.deepEqual(shakeTexCoordOffset(1, 0.4, shakeFlowMask(0.498, 0.498)), [0, 0]);
});
