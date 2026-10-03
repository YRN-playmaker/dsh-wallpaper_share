import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ParticleRuntime } from '../ParticleRuntime.ts'
import { isSafeAssetTextureName } from '../../scene/asset-texture-name.ts'
import { buildSceneModel, type ParticleSystemDesc } from '../../scene/SceneModel.ts'

function desc(type = 'spritetrail'): ParticleSystemDesc {
  return {
    particleRef: 'particles/rain.json', materialRef: 'materials/rain.json', blending: 'translucent',
    refract: true, refractAmount: 0.05, animationMode: null, overbright: 1, textureNames: ['particle/drop'],
    maxCount: 4, hasAlpharandom: true, startTime: 0, worldSpace: false, perspective: false, perspectiveFocal: 1000,
    emitter: { type: 'boxrandom', rate: 0, instantaneous: 1, directions: [1, 1, 0], distanceMin: 0, distanceMax: 0, origin: [0, 0, 0] },
    initializers: { lifetime: [3, 3], size: [10, 10], alphaMin: 0.4, alphaMax: 0.4, velocityMin: [0, -100, 0], velocityMax: [0, -100, 0] },
    operators: {}, renderer: { type, length: 0.01, maxlength: 2 }, sequenceMultiplier: 1, children: [],
    controlPointLine: null, sequenceCount: 0, sequenceMirror: false,
  }
}

test('Rainy Day Unicode texture names load without allowing path traversal', () => {
  for (const name of ['particle/drop', 'workshop/2446129945/particle/particles 256x1280 blank',
    'workshop/3462439536/particle/размытая капля дождя 1', 'particle/雨滴', 'particle/e\u0301']) {
    assert.ok(isSafeAssetTextureName(name), name)
  }
  for (const name of ['', '../secret', 'particle/../../secret', '/absolute', 'C:/secret', '\\server\\file',
    'particle/..', 'particle/%2e%2e', 'particle/file:stream', 'particle/line\nfeed', 'particle/\0']) {
    assert.equal(isSafeAssetTextureName(name), false, name)
  }
})

test('falling rain retains material refraction and opacity, with vertical trailing geometry', () => {
  const rt = new ParticleRuntime(desc())
  rt.setTexture({ width: 32, height: 128 } as HTMLCanvasElement)
  rt.update(0.1)
  const [batch] = rt.collectGl(1, 1, 50, 50, 1)
  assert.equal(batch.refract, true)
  assert.equal(batch.trail, true)
  assert.equal(batch.refractAmount, 0.05)
  assert.equal(batch.particles[0].a, 0.4)
  assert.ok(batch.particles[0].aspect > 1)
  assert.ok(Math.abs(batch.particles[0].rot) < 1e-6)
})

test('sprite and falling rain do not allocate per-frame path histories; rope trails still keep their path', () => {
  for (const type of ['sprite', 'spritetrail', 'ropetrail']) {
    const rt = new ParticleRuntime(desc(type))
    rt.update(0.1); rt.update(0.1); rt.update(0.1)
    const particles = (rt as unknown as { particles: Array<{ history: Array<{ x: number; y: number }> }> }).particles
    assert.equal(particles[0].history.length, type === 'ropetrail' ? 4 : 1)
  }
})

// 最小真实 PKGV 容器，覆盖缺省值与显式 0 的材质区别。
function scenePkg(refractAmount?: number): Uint8Array {
  const files = [
    ['scene.json', JSON.stringify({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, objects: [{ id: 1, name: 'Rain', particle: 'particles/rain.json' }] })],
    ['particles/rain.json', JSON.stringify({ material: 'materials/rain.json', emitter: [{ name: 'boxrandom', rate: 1 }] })],
    ['materials/rain.json', JSON.stringify({ passes: [{ combos: { REFRACT: 1 }, textures: ['particle/drop', 'particle/drop_normal'], constantshadervalues: refractAmount === undefined ? {} : { ui_editor_properties_refract_amount: refractAmount } }] })],
  ]
  const enc = new TextEncoder(), names = files.map(([name]) => enc.encode(name)), data = files.map(([, text]) => enc.encode(text))
  const header = 4 + 8 + 4 + names.reduce((n, name) => n + 12 + name.length, 0) + 4
  const out = new Uint8Array(header + data.reduce((n, d) => n + d.length, 0)), view = new DataView(out.buffer)
  view.setInt32(0, 8, true); out.set(enc.encode('PKGV0001'), 4); view.setInt32(12, 1, true)
  let pos = 16, offset = 0
  for (let i = 0; i < names.length; i++) {
    view.setInt32(pos, names[i].length, true); pos += 4; out.set(names[i], pos); pos += names[i].length
    view.setInt32(pos, offset, true); pos += 4; view.setInt32(pos, data[i].length, true); pos += 4
    out.set(data[i], header + offset); offset += data[i].length
  }
  view.setInt32(pos, 0, true)
  return out
}

test('refractive material defaults to 0.05 and preserves explicit zero and negative values', () => {
  for (const value of [undefined, 0, -0.1]) {
    const model = buildSceneModel(scenePkg(value))!
    assert.equal(model.layers[0].particle?.refractAmount, value ?? 0.05)
  }
})
