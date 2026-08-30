// 直接调用 lib 里的 parseDayNightAlpha？更简单：读 dist 里 buildSceneModel 的结果
// 用 tsx 直接 import SceneModel 的 parseDayNightAlpha（若导出）
import fs from 'fs'
const libPath = 'D:/SteamLibrary/steamapps/workshop/content/431960/2164591875'
// 直接内联复制 parseDayNightAlpha 逻辑并验证 2164591875 的 alpha 脚本
function parseDayNightAlpha(v: unknown): { dayStartH: number; dayEndH: number; nightWhenStart: boolean; nightWhenEnd: boolean } | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const script = (v as { script?: unknown }).script
  if (typeof script !== 'string') return undefined
  if (!script.includes('engine') || !script.includes('timeOfDay')) return undefined
  let startH = 7, endH = 18, hasStart = false, hasEnd = false
  const sh = /START_HOUR\s*=\s*([0-9.]+)/.exec(script)
  if (sh !== null) { startH = Number(sh[1]); hasStart = true }
  const eh = /END_HOUR\s*=\s*([0-9.]+)/.exec(script)
  if (eh !== null) { endH = Number(eh[1]); hasEnd = true }
  if (!hasStart || !hasEnd) return undefined
  if (startH < 0 || startH > 24 || endH < 0 || endH > 24) return undefined
  const negated = /1\s*-\s*WEMath\.smoothStep/.test(script)
  return { dayStartH: startH, dayEndH: endH, nightWhenStart: !negated, nightWhenEnd: !negated }
}
// 验证 2164591875 的脚本
const scriptSample = `import * as WEMath from 'WEMath';
const START_HOUR = 7;
const END_HOUR = 18;
export function update(value) {
 return Math.max(
 WEMath.smoothStep( START_HOUR / 24, ( START_HOUR - 0.004 ) / 24, engine.timeOfDay),
 WEMath.smoothStep( ( END_HOUR - 0.004 ) / 24, END_HOUR / 24, engine.timeOfDay)
 );
}`
const r = parseDayNightAlpha({ script: scriptSample, value: 1.0 })
console.log('2164591875 alpha 脚本解析: ' + JSON.stringify(r))
// 模拟 dayNightFactor
function dayNightFactor(dn: { dayStartH: number; dayEndH: number; nightWhenStart: boolean; nightWhenEnd: boolean }, hour: number): number {
  const { dayStartH: s, dayEndH: e, nightWhenStart } = dn
  if (s > e) {
    const isNight = hour >= s || hour < e
    return isNight ? (nightWhenStart ? 1 : 0) : (nightWhenStart ? 0 : 1)
  }
  const isNight = hour < s || hour >= e
  return isNight ? (nightWhenStart ? 1 : 0) : (nightWhenStart ? 0 : 1)
}
if (r !== undefined) {
  for (const h of [0, 3, 6.9, 7, 12, 17, 18, 21, 23.9]) {
    console.log('  hour=' + h.toFixed(1) + ' -> factor=' + dayNightFactor(r, h))
  }
}
