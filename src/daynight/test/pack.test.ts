import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDayNightManifest, buildDayNightPackage, buildDayNightScene, DAYNIGHT_HD_ASSETS, DAYNIGHT_ID } from '../pack.ts';
import { readZipMap } from '../../market/unzip.ts';

const TINY_DAY = new Uint8Array([1, 2, 3, 4, 5]);
const TINY_NIGHT = new Uint8Array([9, 8, 7, 6]);
const TINY_DAY_HD = new Uint8Array([11, 12]);
const TINY_NIGHT_HD = new Uint8Array([21, 22]);

const text = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes ?? new Uint8Array());

test('scene：低档打底 + 高档覆盖，夜层按档位各自控透明度', () => {
  const s = buildDayNightScene();
  assert.deepEqual(s.layers.map((l) => l.id), ['day_sd', 'day_hd', 'night_sd', 'night_hd'], '自下而上的层序是昼夜切换正确的前提');
  for (const l of s.layers) {
    assert.equal(l.type, 'image');
    assert.equal(l.blend, undefined, '保持默认 normal 混合');
    assert.deepEqual(l.size, [1920, 1080]);
    assert.deepEqual(l.anchor, [0.5, 0.5]);
  }
  assert.deepEqual(s.layers.map((l) => l.src), [
    'assets/day.png', 'assets/day_hd.png', 'assets/night.png', 'assets/night_hd.png',
  ]);
  assert.deepEqual(s.effects, [
    { type: 'opacity', target: 'day_hd', params: { value: '$hd_on' } },
    { type: 'opacity', target: 'night_sd', params: { value: '$night_sd' } },
    { type: 'opacity', target: 'night_hd', params: { value: '$night_hd' } },
  ]);
  assert.deepEqual(s.variables, { night_alpha: 0, hd_on: 0, night_sd: 0, night_hd: 0 }, '变量必须声明，否则 core 编译期孤儿引用报错');
});

test('scene：扩展字段列出高档资源，供消费端在低档位顶替成占位图', () => {
  const ext = (buildDayNightScene() as unknown as { dsh?: { hdAssets?: string[] } }).dsh;
  assert.deepEqual(ext?.hdAssets, DAYNIGHT_HD_ASSETS);
  assert.deepEqual(DAYNIGHT_HD_ASSETS, ['assets/day_hd.png', 'assets/night_hd.png']);
});

test('manifest：dwp/1.0 + scene 入口 + 免费内容许可（市场硬校验：内容许可不得是 copyleft）', () => {
  const m = buildDayNightManifest();
  assert.equal(m.format, 'dwp/1.0');
  assert.equal(m.id, DAYNIGHT_ID);
  assert.equal(m.type, 'scene');
  assert.equal(m.entry, 'scene.json');
  assert.equal(m.preview, 'assets/preview.png');
  assert.equal(m.rating, 'general');
  assert.equal(m.commercial, undefined, '免费包不写 commercial');
  assert.ok(!/GPL|AGPL|LGPL/i.test(m.license), '内容许可不能含 copyleft');
});

test('组包：zip 可读回，含清单/场景/两档四张图/预览', () => {
  const pkg = buildDayNightPackage({ dayPng: TINY_DAY, nightPng: TINY_NIGHT, dayHdPng: TINY_DAY_HD, nightHdPng: TINY_NIGHT_HD });
  const map = readZipMap(pkg);
  assert.deepEqual([...map.keys()].sort(), [
    'assets/day.png', 'assets/day_hd.png', 'assets/night.png', 'assets/night_hd.png', 'assets/preview.png', 'scene.json', 'wallpaper.json',
  ]);
  assert.deepEqual([...(map.get('assets/day.png') ?? [])], [...TINY_DAY]);
  assert.deepEqual([...(map.get('assets/night.png') ?? [])], [...TINY_NIGHT]);
  assert.deepEqual([...(map.get('assets/day_hd.png') ?? [])], [...TINY_DAY_HD]);
  assert.deepEqual([...(map.get('assets/night_hd.png') ?? [])], [...TINY_NIGHT_HD]);
  assert.deepEqual([...(map.get('assets/preview.png') ?? [])], [...TINY_DAY], '预览缺省复用低档白天图');
  assert.equal(JSON.parse(text(map.get('wallpaper.json'))).id, DAYNIGHT_ID);
  assert.equal(JSON.parse(text(map.get('scene.json'))).canvas.width, 1920);
});

test('组包：缺高档图时回落低档图（不会打出缺资源的包）', () => {
  const map = readZipMap(buildDayNightPackage({ dayPng: TINY_DAY, nightPng: TINY_NIGHT }));
  assert.deepEqual([...(map.get('assets/day_hd.png') ?? [])], [...TINY_DAY]);
  assert.deepEqual([...(map.get('assets/night_hd.png') ?? [])], [...TINY_NIGHT]);
});

test('组包：确定性输出（同输入同字节 → integrity 稳定）', () => {
  const a = buildDayNightPackage({ dayPng: TINY_DAY, nightPng: TINY_NIGHT, dayHdPng: TINY_DAY_HD, nightHdPng: TINY_NIGHT_HD });
  const b = buildDayNightPackage({ dayPng: TINY_DAY, nightPng: TINY_NIGHT, dayHdPng: TINY_DAY_HD, nightHdPng: TINY_NIGHT_HD });
  assert.deepEqual([...a], [...b]);
});

test('组包：可自定义预览、版本与名称', () => {
  const preview = new Uint8Array([42]);
  const pkg = buildDayNightPackage({ dayPng: TINY_DAY, nightPng: TINY_NIGHT, previewPng: preview, version: '1.2.0', name: { zh: '自定义', en: 'Custom' } });
  const map = readZipMap(pkg);
  assert.deepEqual([...(map.get('assets/preview.png') ?? [])], [...preview]);
  const m = JSON.parse(text(map.get('wallpaper.json')));
  assert.equal(m.version, '1.2.0');
  assert.equal(m.name.zh, '自定义');
});
