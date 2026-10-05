import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { ParticleRuntime as After } from '../src/client/ParticleRuntime.ts'
const file = new URL('./harness/dist/rainy-before.mjs', import.meta.url)
const copy = new URL('./harness/dist/rainy-before-runtime.mjs', import.meta.url)
writeFileSync(copy, readFileSync(file, 'utf8') + '\nexport { ParticleRuntime };\n', 'utf8')
const { ParticleRuntime: Before } = await import(copy.href)
const base = JSON.parse(readFileSync('_dev/rainy-day-out/model.json', 'utf8')).layers.find(l => l.id === 13041).particle
const desc = { ...base, startTime: 0, maxCount: 5000, emitter: { ...base.emitter, rate: 0, instantaneous: 5000 }, initializers: { ...base.initializers, lifetime: [100, 100] } }
const measure = Class => {
  const times = []
  for (let run = 0; run < 8; run++) {
    const rt = new Class(desc)
    rt.update(0.001)
    for (let i = 0; i < 30; i++) rt.update(1 / 60)
    global.gc?.()
    const t0 = performance.now()
    for (let i = 0; i < 120; i++) rt.update(1 / 60)
    times.push((performance.now() - t0) / 120)
  }
  times.sort((a, b) => a - b)
  return +times[4].toFixed(3)
}
const beforeMs = measure(Before), afterMs = measure(After)
console.log(JSON.stringify({ particles: 5000, steps: 120, runs: 8, beforeMs, afterMs, reductionPercent: +(100 * (1 - afterMs / beforeMs)).toFixed(1) }))
