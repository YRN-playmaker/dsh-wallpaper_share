/**
 * 语义编译（design-runtime.md §1）：结构校验由调用方 ajv 做，compile 负责语义层——
 * 重复 id / $var 孤儿 / blend·effect 白名单 / 动画属性白名单 / 关键帧合法性 / params 闭环。
 * 输出 CompiledDoc（不可变；setParam 返回新实例）。
 */
import type { Layer, Manifest, Scene } from './types.ts';
import type { CompiledAnim } from './anim.ts';
import { compileAnimation } from './anim.ts';
import { compileMesh, type CompiledMesh } from './bones.ts';
import { DocumentError, DocumentErrors } from './errors.ts';
import { assertRefsDefined, buildVarTable, collectVarRefs, type VarTable, type VarValue } from './vars.ts';

const BLENDS = new Set(['normal', 'lighter', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'soft-light', 'hard-light', 'difference', 'exclusion']);
const EFFECTS = new Set(['waterwaves', 'waterripple', 'shake', 'scroll', 'tint', 'pulse', 'filmgrain',
  'opacity', 'vignette', 'chromatic', 'blur']);
const ANIM_PROPS = new Set(['offset.x', 'offset.y', 'scale', 'scale.x', 'scale.y', 'rotation', 'alpha',
  'size.w', 'size.h', 'uvOffset', 'color']);
const SCROLL_PROPS = new Set(['uvOffset', 'offset.x', 'offset.y']);
const VAR_ID = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export interface CompiledLayer {
  index: number;
  raw: Layer;
  anim?: CompiledAnim;
  mesh?: CompiledMesh;
}

export interface CompiledDoc {
  manifest?: Manifest;
  scene: Scene;
  vars: VarTable;
  layers: CompiledLayer[];
  canvas: { width: number; height: number; fit: 'cover' | 'contain' | 'stretch'; background: string | number };
  loop?: number;
  /** setParam 覆写累积（内部字段，构建 vars 用） */
  overrides?: Record<string, VarValue>;
}

export function compile(manifest: Manifest | undefined, scene: Scene): CompiledDoc {
  const errors: DocumentError[] = [];
  const vars = buildVarTable(scene, manifest);

  // $var 孤儿引用（全场景 + manifest.params 默认值不参与引用扫描，只扫 scene）
  for (const e of assertRefsDefined(collectVarRefs(scene), vars)) errors.push(e);

  // params 声明合法性
  const paramIds = new Set<string>();
  for (const [i, p] of (manifest?.params ?? []).entries()) {
    if (!VAR_ID.test(p.key)) {
      errors.push(new DocumentError('bad-param-key', `/params/${i}/key`, `参数 key 非法: ${p.key}`));
    }
    if (paramIds.has(p.key)) {
      errors.push(new DocumentError('dup-param-key', `/params/${i}/key`, `参数 key 重复: ${p.key}`));
    }
    paramIds.add(p.key);
    if (p.kind === 'slider' && (typeof p.min !== 'number' || typeof p.max !== 'number')) {
      errors.push(new DocumentError('slider-bounds', `/params/${i}`, `slider 参数 ${p.key} 缺 min/max`));
    }
    if (p.kind === 'select' && (!Array.isArray(p.options) || p.options.length === 0)) {
      errors.push(new DocumentError('select-options', `/params/${i}`, `select 参数 ${p.key} 缺 options`));
    }
  }

  // 图层
  const ids = new Set<string>();
  const compiled: CompiledLayer[] = [];
  scene.layers.forEach((layer, i) => {
    const ptr = `/layers/${i}`;
    if (ids.has(layer.id)) errors.push(new DocumentError('dup-layer-id', ptr, `图层 id 重复: ${layer.id}`));
    ids.add(layer.id);
    if (layer.blend !== undefined && !BLENDS.has(layer.blend)) {
      errors.push(new DocumentError('bad-blend', `${ptr}/blend`, `混合模式不在白名单: ${layer.blend}`));
    }
    let anim: CompiledAnim | undefined;
    if (layer.animation) {
      try {
        anim = compileAnimation(layer.animation, ptr);
        validateAnim(anim, `${ptr}/animation`, errors);
      } catch (e) {
        const code = (e as Error & { code?: string }).code ?? 'bad-easing';
        errors.push(new DocumentError(code, `${ptr}/animation`, (e as Error).message));
      }
    }
    let mesh: CompiledMesh | undefined;
    if (layer.type === 'mesh') {
      const r = compileMesh(layer, ptr);
      errors.push(...r.errors);
      mesh = r.mesh;
    }
    compiled.push({ index: i, raw: layer, anim, mesh });
  });

  // 效果
  (scene.effects ?? []).forEach((fx, i) => {
    if (!EFFECTS.has(fx.type)) {
      errors.push(new DocumentError('bad-effect', `/effects/${i}/type`, `效果不在白名单: ${fx.type}`));
    }
    if (fx.target !== 'scene' && !ids.has(fx.target)) {
      errors.push(new DocumentError('effect-target-missing', `/effects/${i}/target`, `效果目标图层不存在: ${fx.target}`));
    }
  });

  if (errors.length) throw new DocumentErrors(errors);

  return {
    manifest,
    scene,
    vars,
    layers: compiled,
    canvas: {
      width: scene.canvas.width, height: scene.canvas.height,
      fit: scene.canvas.fit ?? 'cover', background: scene.canvas.background ?? '#000000',
    },
    loop: scene.loop,
  };
}

function validateAnim(anim: CompiledAnim, ptr: string, errors: DocumentError[]) {
  if (anim.kind === 'keyframes') {
    for (const tr of anim.tracks ?? []) {
      if (!ANIM_PROPS.has(tr.property)) {
        errors.push(new DocumentError('bad-anim-property', `${ptr}/tracks/${tr.property}`, `动画属性不在白名单: ${tr.property}`));
      }
      if (tr.times.length < 2) {
        errors.push(new DocumentError('short-track', `${ptr}/tracks/${tr.property}`, '关键帧至少 2 帧'));
      }
    }
  } else if (anim.kind === 'oscillate') {
    if (!anim.property || !ANIM_PROPS.has(anim.property)) {
      errors.push(new DocumentError('bad-anim-property', `${ptr}/property`, `动画属性不在白名单: ${anim.property}`));
    }
    if (!(anim.period && anim.period > 0)) {
      errors.push(new DocumentError('bad-period', `${ptr}/period`, 'oscillate 需要 period > 0'));
    }
  } else if (anim.kind === 'scroll') {
    if (!anim.property || !SCROLL_PROPS.has(anim.property)) {
      errors.push(new DocumentError('bad-anim-property', `${ptr}/property`, `scroll 仅支持 uvOffset/offset.x/offset.y，收到: ${anim.property}`));
    }
  }
}

/** 不可变参数更新（design-runtime.md §1）：返回新 CompiledDoc，原实例不动。 */
export function setParam(doc: CompiledDoc, id: string, value: VarValue): CompiledDoc {
  const overrides: Record<string, VarValue> = { ...(doc.overrides ?? {}), [id]: value };
  const vars = buildVarTable(doc.scene, doc.manifest, overrides);
  return { ...doc, vars, overrides };
}
