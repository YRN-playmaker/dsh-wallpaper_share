import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDayNightManifest, buildDayNightPackage, buildDayNightScene, DAYNIGHT_HD_ASSETS, DAYNIGHT_ID, DAYNIGHT_VERSION, DAYNIGHT_TAB_CLIENT_VERSION } from '../pack.ts';
import { readZipMap } from '../../market/unzip.ts';
import { DAYNIGHT_TAB_SCENE, mixTabScenePalette, parseTabScene } from '../tab-scene.ts';

const TINY_DAY = new Uint8Array([1, 2, 3, 4, 5]);
const TINY_NIGHT = new Uint8Array([9, 8, 7, 6]);
const TINY_DAY_HD = new Uint8Array([11, 12]);
const TINY_NIGHT_HD = new Uint8Array([21, 22]);

const text = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes ?? new Uint8Array());

test('tab scene is self-contained: behavior and all referenced textures survive ZIP roundtrip', () => {
  const tabAssets = Object.fromEntries([DAYNIGHT_TAB_SCENE.portrait, ...DAYNIGHT_TAB_SCENE.foam].map(name => [name, TINY_DAY]))
  const files = readZipMap(buildDayNightPackage({ dayPng: TINY_DAY, nightPng: TINY_NIGHT, tabAssets }))
  const profile = parseTabScene(JSON.parse(text(files.get('scene.json'))).dsh.tabScene)
  assert.ok(profile)
  assert.deepEqual(profile, DAYNIGHT_TAB_SCENE)
  for (const name of [profile.portrait, ...profile.foam]) assert.deepEqual(files.get(name), TINY_DAY)
  assert.equal(profile.entry.start, profile.splash.start)
  assert.equal(profile.water.clipFigure, true)
  assert.ok(profile.water.revealStart + profile.water.revealDuration < profile.entry.start + profile.entry.duration * 0.6)
  assert.equal(profile.figure.opacity, 0.75)
  assert.deepEqual(profile.figure.surfaceTint, { color: '#F7F4D4', maxAlpha: 0.3, depth: 0.4 })
  assert.deepEqual([profile.focus.minBlur, profile.focus.maxBlur], [1, 4])
  assert.ok(profile.bottomDots && profile.bottomDots.scrollStart > 0.8)
  assert.equal(profile.bubbleLight?.mode, 'enhanced')
  assert.deepEqual(profile.bubbleLight?.heightFade, { start: 0.5, end: 0.25 })
  assert.equal(profile.bubblePaint?.mode, 'enhanced')
  assert.equal(profile.bubblePaint?.color, '#ffffff')
  assert.equal(profile.bubblePaint?.opacity, 0.1)
  assert.equal(profile.bubbleShape?.style, 'ellipsoid-2d')
  assert.equal(profile.surfaceLight?.mode, 'enhanced')
  assert.ok(profile.surfaceLight)
  assert.equal(profile.surfaceLight.scrollFadeEnd, 0.65)
  assert.equal(parseTabScene({ ...profile, surfaceLight: { ...profile.surfaceLight, scrollFadeEnd: 0 } }), null)
  assert.equal(parseTabScene({ ...profile, surfaceLight: { ...profile.surfaceLight, opacity: 1 } }), null)
  const legacyLight = { mode: 'enhanced' as const, style: 'top-haze' as const, radius: 0.018, detailOpacity: 0.48, glowOpacity: 0.018, color: '#90e4ff' }
  assert.ok(parseTabScene({ ...profile, bubbleLight: legacyLight }))
  assert.equal(parseTabScene({ ...profile, bubbleLight: { ...legacyLight, radius: -1 } }), null)
  assert.equal(parseTabScene({ ...profile, bubbleLight: { ...legacyLight, hazeBlur: -1 } }), null)
  assert.equal(parseTabScene({ ...profile, bubbleLight: { ...legacyLight, shadowOpacity: 2 } }), null)
  assert.equal(parseTabScene({ ...profile, bubbleLight: { ...legacyLight, heightFade: { start: 0.5, end: 0.6 } } }), null)
  assert.equal(parseTabScene({ ...profile, bubbleLight: { ...legacyLight, heightFade: { start: 1.1, end: 0.2 } } }), null)
  assert.equal(parseTabScene({ ...profile, bubbleLens: { ...profile.bubbleLens, magnification: 0 } }), null)
  assert.equal(parseTabScene({ ...profile, bubbleLens: { ...profile.bubbleLens, mode: 'eco' } }), null)
  assert.equal(parseTabScene({ ...profile, bubbleShape: { ...profile.bubbleShape, lowerWobble: -1 } }), null)
  assert.equal(parseTabScene({ ...profile, bubblePaint: { ...profile.bubblePaint, opacity: 2 } }), null)
  assert.equal(parseTabScene({ ...profile, bubbleShape: { ...profile.bubbleShape, style: 'unknown' } }), null)
  assert.equal(parseTabScene({ ...profile, bubbleShape: { ...profile.bubbleShape, physics: undefined } }), null)
  assert.equal(parseTabScene({ ...profile, bubbleShape: { ...profile.bubbleShape, physics: { ...profile.bubbleShape?.physics, timeScale: 0 } } }), null)
  assert.equal(parseTabScene({ ...profile, bubbleField: { ...profile.bubbleField, count: 500 } }), null)
  assert.equal(parseTabScene({ ...profile, bubbleField: { ...profile.bubbleField, seed: NaN } }), null)
  assert.equal(parseTabScene({ ...profile, bottomDots: { ...profile.bottomDots, spacing: 0 } }), null)
  assert.ok(files.has('TAB-SCENE.md'))
  assert.ok(text(files.get('README.md')).includes(DAYNIGHT_TAB_CLIENT_VERSION))
  assert.ok(text(files.get('README.md')).includes(`DWP ${DAYNIGHT_VERSION}`))
  assert.equal(JSON.parse(text(files.get('wallpaper.json'))).version, DAYNIGHT_VERSION)
  assert.throws(() => buildDayNightPackage({ dayPng: TINY_DAY, nightPng: TINY_NIGHT, tabAssets: {} }), /Missing DWP tab asset/)
  assert.equal(parseTabScene({ ...profile, portrait: 'assets/../secret.png' }), null)
  assert.equal(parseTabScene({ ...profile, entry: {} }), null)
})

test('night tab palette is packaged, Complete-only and preserves animation through crossfade', () => {
  const source = structuredClone(DAYNIGHT_TAB_SCENE)
  const files = readZipMap(buildDayNightPackage({ dayPng: TINY_DAY, nightPng: TINY_NIGHT, tabAssets: Object.fromEntries([source.portrait, ...source.foam].map(name => [name, TINY_DAY])) }))
  const profile = parseTabScene(JSON.parse(text(files.get('scene.json'))).dsh.tabScene)!
  assert.ok(profile.nightPalette)
  const night = mixTabScenePalette(profile, 1, 'enhanced')
  assert.deepEqual(night.water.stops, profile.nightPalette.water.stops)
  assert.equal(night.figure.ink, '#320f20')
  assert.equal(night.figure.opacity, 0.75)
  assert.equal(night.figure.colorOpacity, 0, 'night hides the global portrait color layer, keeping bubble detail independent')
  assert.equal(night.bottomDots?.completeColor, night.figure.ink)
  assert.deepEqual([night.ui?.hoverColor, night.ui?.selectedColor], ['#f15b63', '#e94650'])
  assert.deepEqual(night.splash.tone, profile.nightPalette.splash?.tone)
  assert.equal(night.splash.particleColor, '#f2ca92')
  assert.equal(night.splash.fps, profile.splash.fps)
  assert.deepEqual(night.splash.exposures, profile.splash.exposures, 'postprocessing preserves cel timing and frame count')
  for (const key of ['entry', 'exit', 'scroll', 'depth', 'bubbleShape', 'bubbleLens', 'bubbleField'] as const) assert.deepEqual(night[key], source[key])
  for (const mode of ['eco', 'perf', undefined]) assert.equal(mixTabScenePalette(profile, 1, mode), profile)
  assert.equal(mixTabScenePalette(profile, 0, 'enhanced'), profile)
  assert.equal(mixTabScenePalette(profile, NaN, 'enhanced'), profile)
  const half = mixTabScenePalette(profile, 0.5, 'enhanced')
  assert.equal(half.water.stops[0][1], '#6ca69d')
  assert.equal(half.figure.colorOpacity, 0.45, 'portrait colors crossfade out with the dusk clock')
  assert.equal(half.ui?.selectedColor, '#87559e', 'interactive accents follow the same dusk crossfade')
  assert.deepEqual([half.splash.tone?.sepia, half.splash.tone?.saturation, half.splash.tone?.hueRotate], [0.5, 1.35, -10])
  assert.ok(Math.abs(half.splash.tone!.brightness - 0.89) < 1e-12)
  assert.equal(half.figure.tint.slice(-2), '2b')
  assert.deepEqual(profile, source, 'palette blending never mutates the DWP profile')
  const legacy = { ...profile, nightPalette: undefined }
  assert.equal(mixTabScenePalette(legacy, 1, 'enhanced'), legacy)
  assert.equal(parseTabScene({ ...profile, nightPalette: { ...profile.nightPalette, mode: 'eco' } }), null)
  assert.equal(parseTabScene({ ...profile, nightPalette: { ...profile.nightPalette, figure: { ...profile.nightPalette.figure, ink: 'red' } } }), null)
  assert.equal(parseTabScene({ ...profile, nightPalette: { ...profile.nightPalette, ui: { hoverColor: 'red', selectedColor: '#e94650' } } }), null)
  assert.equal(parseTabScene({ ...profile, ui: { ...profile.ui, hoverColor: 'red' } }), null)
  assert.equal(parseTabScene({ ...profile, splash: { ...profile.splash, tone: { sepia: 2, saturation: 1, hueRotate: 0, brightness: 1 } } }), null)
  assert.equal(parseTabScene({ ...profile, nightPalette: { ...profile.nightPalette, splash: { ...profile.nightPalette.splash, particleColor: 'orange' } } }), null)
  for (const saturation of [-1, 5, NaN]) assert.equal(parseTabScene({ ...profile, nightPalette: { ...profile.nightPalette, splash: { ...profile.nightPalette.splash, tone: { ...profile.nightPalette.splash?.tone, saturation } } } }), null)
  const oldSplash = { ...profile, nightPalette: { ...profile.nightPalette, splash: undefined } }
  assert.ok(parseTabScene(oldSplash))
  assert.deepEqual(mixTabScenePalette(oldSplash, 1, 'enhanced').splash, profile.splash, 'older packages keep the original foam')
  const oldUi = { ...profile, ui: { ...profile.ui!, hoverColor: undefined, selectedColor: undefined } }
  assert.ok(parseTabScene(oldUi))
  assert.equal(mixTabScenePalette(oldUi, 0.5, 'enhanced').ui?.selectedColor, half.ui?.selectedColor, 'older UI profiles use the original blue as the clock fallback')
  for (const colorOpacity of [-0.1, 1.1, NaN]) assert.equal(parseTabScene({ ...profile, nightPalette: { ...profile.nightPalette, figure: { ...profile.nightPalette.figure, colorOpacity } } }), null)
  const oldNight = { ...profile, nightPalette: { ...profile.nightPalette, figure: { ...profile.nightPalette.figure, colorOpacity: undefined } } }
  assert.ok(parseTabScene(oldNight))
  assert.equal(mixTabScenePalette(oldNight, 1, 'enhanced').figure.colorOpacity, 0.9, 'older night profiles keep their previous portrait visibility')
  assert.equal(parseTabScene({ ...profile, nightPalette: { ...profile.nightPalette, water: { ...profile.nightPalette.water, stops: [[0, '#FB8604']] } } }), null)
  assert.equal(parseTabScene({ ...profile, nightPalette: { ...profile.nightPalette, water: { ...profile.nightPalette.water, stops: profile.nightPalette.water.stops.map(([offset, color], i) => [i === 1 ? 0.3 : offset, color]) } } }), null)
})

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
    'README.md', 'assets/day.png', 'assets/day_hd.png', 'assets/night.png', 'assets/night_hd.png', 'assets/preview.png', 'scene.json', 'wallpaper.json',
  ]);
  assert.deepEqual([...(map.get('assets/day.png') ?? [])], [...TINY_DAY]);
  assert.ok(text(map.get('README.md')).includes('26.10.9-D'), '用户安装包应包含配套插件升级要求');
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
