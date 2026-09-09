/** dwp-core：DWP 场景解算（纯 TS，零 DOM，确定性）。设计：dsh-wallpaper_edit/docs/design-runtime.md */
export * from './types.ts';
export { compile, setParam, type CompiledDoc, type CompiledLayer } from './compile.ts';
export { evaluate, formatPlaceholders, formatVars, parseFont } from './eval.ts';
export { DocumentError, DocumentErrors } from './errors.ts';
export { buildVarTable, collectVarRefs, isVarRef, resolveNum, resolveColor, type VarValue, type VarTable } from './vars.ts';
export { parseEasing, cubicBezier, linear } from './easing.ts';
export { compileAnimation, evalTrack, evalLayerAnimation, oscillateDelta, scrollValue, type CompiledAnim, type CompiledTrack } from './anim.ts';
export { compileMesh, evalMesh, type CompiledMesh, type CompiledBone, type CompiledPart, type CompiledClip, type CompiledClipTrack, type BoneProp, type MeshPartQuad } from './bones.ts';
export { createSim, emitParticleSteps, curve, DT, type SimState } from './particles.ts';
export { expandSceneEffects, foldLayerEffects, type EffectFold, type SceneExpansion, type PassTemplate } from './effects.ts';
export { createPool, slotVerts, type PlanPool, type PlanSlot } from './pool.ts';
export { mul, translate, rotate, scale, invert, applyPoint, boxMatrix, quadVerts, quadUV, parseColor, fitScale } from './layout.ts';
