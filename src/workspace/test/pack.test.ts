import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPulseScene, buildPulseManifest, buildPulsePackage, renderBubblePng, renderPreviewPng, PULSE_ID } from '../pack.ts';
import { compile } from '../../../vendor/dwp/packages/dwp-core/src/index.ts';
import { readZipMap } from '../../market/unzip.ts';

test('scene 通过 dwp-core compile 语义校验（$var 孤儿/动画白名单/效果目标）', () => {
  const scene = buildPulseScene();
  const doc = compile(buildPulseManifest(), scene);
  assert.equal(doc.layers.length, scene.layers.length);
  // 全部声明的变量都在变量表里（客户端喂食依赖这些键）
  for (const k of ['ws_count', 'idle_on', 'pulse_scale', 'b1_on', 'b2_on', 'b3_on']) {
    assert.ok(doc.vars.has(k), 'missing var ' + k);
  }
});

test('槽位 1..3 各含 bubble/name/size/badge/glyph 五层，opacity 效果齐全', () => {
  const scene = buildPulseScene();
  const ids = scene.layers.map((l) => l.id);
  for (let i = 1; i <= 3; i++) {
    for (const part of ['bubble', 'name', 'size', 'badge', 'glyph']) {
      assert.ok(ids.includes(`b${i}_${part}`), 'missing layer ' + `b${i}_${part}`);
    }
  }
  const targets = new Set(scene.effects!.map((e) => e.target));
  for (let i = 1; i <= 3; i++) {
    assert.ok(targets.has(`b${i}_bubble`) && targets.has(`b${i}_badge`), 'slot ' + i + ' opacity missing');
  }
  assert.ok(targets.has('idle'));
});

test('徽章颜色默认值：绿 + 红 − 与客户端 pulse-vars 一致', () => {
  const scene = buildPulseScene();
  assert.equal(scene.variables!['b1_badge'], '#3fb950');
});

test('组包：zip 可读回、含 manifest/scene/2 张 PNG、PNG 头合法', () => {
  const zip = buildPulsePackage();
  const map = readZipMap(zip);
  assert.deepEqual(
    [...map.keys()].sort(),
    ['assets/bubble.png', 'assets/preview.png', 'scene.json', 'wallpaper.json'],
  );
  const manifest = JSON.parse(new TextDecoder().decode(map.get('wallpaper.json')!));
  assert.equal(manifest.format, 'dwp/1.0');
  assert.equal(manifest.id, PULSE_ID);
  assert.equal(manifest.type, 'scene');
  assert.equal(manifest.entry, 'scene.json');
  // PNG 魔数
  for (const name of ['assets/bubble.png', 'assets/preview.png']) {
    const png = map.get(name)!;
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], name);
  }
  // scene 可被 compile（从包里读回走完整链路）
  const scene = JSON.parse(new TextDecoder().decode(map.get('scene.json')!));
  assert.doesNotThrow(() => compile(manifest, scene));
});

test('PNG 尺寸正确（bubble 192²，preview 640×360）', () => {
  // IHDR：8(签名)+4(len)+4(type) 后 width/height 各 4 字节大端
  const bubble = renderBubblePng();
  const bv = new DataView(bubble.buffer, bubble.byteOffset, bubble.byteLength);
  assert.equal(bv.getUint32(16, false), 192);
  assert.equal(bv.getUint32(20, false), 192);
  const prev = renderPreviewPng();
  const pv = new DataView(prev.buffer, prev.byteOffset, prev.byteLength);
  assert.equal(pv.getUint32(16, false), 640);
  assert.equal(pv.getUint32(20, false), 360);
});
