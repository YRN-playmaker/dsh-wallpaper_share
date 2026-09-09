/**
 * $var 变量表（协议 §2/§4：直接替换，无表达式、无算术）。
 * 解析优先级：运行时覆写 > params.default > scene.variables。
 */
import type { Manifest, Scene } from './types.ts';
import { DocumentError } from './errors.ts';

export type VarValue = number | string | boolean;
export type VarTable = ReadonlyMap<string, VarValue>;

const REF = /^\$([a-zA-Z][a-zA-Z0-9_]*)$/;

export function isVarRef(v: unknown): v is string {
  return typeof v === 'string' && REF.test(v);
}

export function buildVarTable(
  scene: Scene,
  manifest: Pick<Manifest, 'params'> | undefined,
  overrides: Record<string, VarValue> = {},
): VarTable {
  const table = new Map<string, VarValue>();
  for (const [k, v] of Object.entries(scene.variables ?? {})) table.set(k, v);
  // 协议 §6：variables 可被 params 覆写 → params.default 覆盖同名变量；运行时覆写最高
  for (const p of manifest?.params ?? []) table.set(p.key, p.default);
  for (const [k, v] of Object.entries(overrides)) table.set(k, v);
  return table;
}

/** 收集文档内全部 "$name" 引用（编译期孤儿检测用）。 */
export function collectVarRefs(node: unknown, pointer = '', out: Array<{ name: string; pointer: string }> = []) {
  if (typeof node === 'string') {
    const m = REF.exec(node);
    if (m) out.push({ name: m[1], pointer });
  } else if (Array.isArray(node)) {
    node.forEach((child, i) => collectVarRefs(child, `${pointer}/${i}`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) collectVarRefs(v, `${pointer}/${k}`, out);
  }
  return out;
}

export function assertRefsDefined(refs: Array<{ name: string; pointer: string }>, vars: VarTable) {
  const errors: DocumentError[] = [];
  for (const r of refs) {
    if (!vars.has(r.name)) {
      errors.push(new DocumentError('undefined-var', r.pointer, `引用 "$${r.name}" 无对应 variables/params 声明`));
    }
  }
  return errors;
}

export function resolveNum(v: number | string | undefined, vars: VarTable, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v === 'number') return v;
  const m = REF.exec(v);
  if (!m) return Number(v);
  const got = vars.get(m[1]);
  return typeof got === 'number' ? got : fallback;
}

export function resolveColor(v: string | number | undefined, vars: VarTable): string | number | undefined {
  if (typeof v === 'string') {
    const m = REF.exec(v);
    if (m) {
      const got = vars.get(m[1]);
      if (typeof got === 'string' || typeof got === 'number') return got as string | number;
    }
  }
  return v;
}
