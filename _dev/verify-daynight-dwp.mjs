/**
 * 静态校验一个 .dwp（不启动浏览器）：
 *   1) 解出 wallpaper.json / scene.json；
 *   2) 交给 dwp-core 编译（能抓出未声明变量 / 非法图层 / 非法效果目标）；
 *   3) 用 evaluate() 在「时刻 × 档位」组合下算渲染计划，验证四个图层的 alpha 真的按预期切换
 *      —— 低档只见 day_sd/night_sd，高档只见 day_sd/day_hd/night_hd，两档永不叠图。
 *
 * 用法：node _dev/verify-daynight-dwp.mjs [path/to.dwp]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readZipMap } from '../src/market/unzip.ts'
import { compile, evaluate, setParam, DocumentErrors } from '../vendor/dwp/packages/dwp-core/src/index.ts'
import { DAYNIGHT_ID, DAYNIGHT_VERSION } from '../src/daynight/pack.ts'
import { clockVars } from '../src/client/clock-vars.ts'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const p = process.argv[2] ?? join(ROOT, '_dist', 'daynight', DAYNIGHT_ID + '-' + DAYNIGHT_VERSION + '.dwp')
const map = readZipMap(new Uint8Array(readFileSync(p)))
const dec = (name) => {
  const bytes = map.get(name)
  if (bytes === undefined) throw new Error('包内缺文件：' + name)
  return JSON.parse(new TextDecoder().decode(bytes))
}

const manifest = dec('wallpaper.json')
const scene = dec('scene.json')
console.log('包内条目 : ' + [...map.keys()].join(', '))
console.log('manifest : ' + manifest.id + '@' + manifest.version + '  type=' + manifest.type + '  entry=' + manifest.entry + '  preview=' + manifest.preview + '  license=' + manifest.license)
console.log('scene    : ' + scene.canvas.width + 'x' + scene.canvas.height + '  layers=' + scene.layers.map((l) => l.id + ':' + l.type).join(' / '))
console.log('高档资源 : ' + JSON.stringify(scene.dsh?.hdAssets ?? null))

let doc
try {
  doc = compile(manifest, scene)
  console.log('编译     : 无错误 ✓')
} catch (e) {
  if (e instanceof DocumentErrors) {
    console.error('编译错误 : ' + JSON.stringify(e.errors, null, 1))
    process.exit(1)
  }
  throw e
}

/** 取某时刻 + 档位下的渲染计划里各图层的 alpha。 */
function planAt(hour, minute, hd) {
  const vars = clockVars(new Date(2026, 8, 10, hour, minute, 0), { hd })
  let d = doc
  for (const [k, v] of Object.entries(vars)) d = setParam(d, k, v)
  const plan = evaluate(d, {
    t: 0, viewport: { w: 1920, h: 1080 }, dpr: 1,
    assetSizes: {
      'assets/day.png': { w: 1920, h: 1080 }, 'assets/night.png': { w: 1920, h: 1080 },
      'assets/day_hd.png': { w: 7680, h: 4320 }, 'assets/night_hd.png': { w: 7680, h: 4320 },
    },
  })
  const alphas = {}
  for (const s of plan.steps) if (s.op === 'quad') alphas[s.layer] = Number(s.alpha.toFixed(4))
  return { vars, alphas, unsupported: (plan.unsupported ?? []).map((u) => u.id + ':' + u.reason) }
}

const pad = (s, n) => String(s).padEnd(n, ' ')
const cases = [[12, 0, '正午'], [17, 59, '傍晚前'], [18, 0, '夜间起点'], [18, 5, '淡入中'], [21, 0, '夜里'], [3, 0, '凌晨'], [5, 55, '淡出中'], [6, 0, '回到白天'], [9, 30, '上午']]
const IDS = ['day_sd', 'day_hd', 'night_sd', 'night_hd']

let ok = true
const fail = (msg) => { ok = false; console.log('    ✗ ' + msg) }
for (const hd of [false, true]) {
  console.log('\n档位 ' + (hd ? '高档（增强/完整）' : '低档（预览/捕获）') + '  →  各层 alpha：')
  console.log('  ' + pad('时刻', 8) + pad('说明', 10) + IDS.map((i) => pad(i, 10)).join('') + '可见层')
  for (const [h, m, label] of cases) {
    const r = planAt(h, m, hd)
    const visible = IDS.filter((i) => (r.alphas[i] ?? 0) > 0.001)
    console.log('  ' + pad(h + ':' + String(m).padStart(2, '0'), 8) + pad(label, 10) +
      IDS.map((i) => pad(r.alphas[i] ?? '缺', 10)).join('') + visible.join('+') +
      (r.unsupported.length ? '  未实现=' + r.unsupported.join(',') : ''))
    if ((r.alphas.day_sd ?? 0) !== 1) fail('day_sd 应恒为 1（打底层）')
    if (hd) {
      if ((r.alphas.day_hd ?? 0) !== 1) fail('高档位 day_hd 应为 1')
      if ((r.alphas.night_sd ?? 0) !== 0) fail('高档位 night_sd 应为 0（否则两档夜图叠加）')
      if ((r.alphas.night_hd ?? 0) !== r.vars.night_alpha) fail('高档位 night_hd 应等于 night_alpha')
    } else {
      if ((r.alphas.day_hd ?? 0) !== 0) fail('低档位 day_hd 应为 0')
      if ((r.alphas.night_sd ?? 0) !== r.vars.night_alpha) fail('低档位 night_sd 应等于 night_alpha')
      if ((r.alphas.night_hd ?? 0) !== 0) fail('低档位 night_hd 应为 0（否则会去用没拉取的 8K 纹理）')
    }
  }
}

const at = (h, hd) => planAt(h, 0, hd)
const check = (r, layer, want) => (r.alphas[layer] ?? -1) === want
const switchOk = check(at(12, false), 'night_sd', 0) && check(at(21, false), 'night_sd', 1)
  && check(at(12, true), 'night_hd', 0) && check(at(21, true), 'night_hd', 1)
  && check(at(12, true), 'day_hd', 1) && check(at(12, false), 'day_hd', 0)
console.log('\n结论     : ' + ((ok && switchOk) ? '两档纹理 × 昼夜切换链路均成立 ✓' : '链路有问题 ✗'))
process.exit(ok && switchOk ? 0 : 1)
