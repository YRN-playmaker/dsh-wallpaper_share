/**
 * PKGV0001 容器解析器（纯 DataView 实现，node 半与浏览器半均可用）。
 *
 * 布局（已对 8 个真实 scene.pkg 实测确认，版本 v4–v307）：
 *   头部：[4B magicLen]["PKGV0001"][4B version]
 *   条目表（每条）：[4B nameLen][name(nameLen)][4B offset][4B size]
 *   data 区：紧随条目表，各条目数据位于 [dataStart + offset, +size]
 *
 * 注意（WE 导出怪癖，已实测）：
 *   - scene.json / models/*.json / materials/*.json 的内容「缺开头 {」，
 *     且尾部可能带 \r\n// 注释、\0、或下一段对象开头等垃圾；
 *     解析时补 { 并按「最后一个不在字符串内的 }」截断。
 */
import type { SceneModel, SceneModelLayer } from './SceneModel.ts'

export interface PkgEntry {
  name: string
  offset: number
  size: number
}

export interface ParsedPkg {
  magic: string
  version: number
  entries: PkgEntry[]
  dataStart: number
  /** 读取某条目的数据（不存在返回 null） */
  read(name: string): Uint8Array | null
  has(name: string): boolean
}

export function parseScenePkg(buf: Uint8Array): ParsedPkg {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 0
  const readI32 = (): number => { const v = view.getInt32(pos, true); pos += 4; return v }
  const magicLen = readI32()
  const magic = utf8Slice(buf, pos, pos + Math.max(0, Math.min(magicLen, 64))); pos += magicLen
  const version = readI32()
  const entries: PkgEntry[] = []
  let guard = 0
  while (pos + 8 <= buf.length && guard++ < 100000) {
    const nameLen = readI32()
    if (nameLen <= 0 || nameLen > 2048 || pos + nameLen + 8 > buf.length) break
    const name = utf8Slice(buf, pos, pos + nameLen); pos += nameLen
    const offset = readI32()
    const size = readI32()
    if (offset < 0 || size < 0 || offset + size > buf.length) break
    entries.push({ name, offset, size })
  }
  const dataStart = pos
  const read = (name: string): Uint8Array | null => {
    const e = entries.find((x) => x.name === name)
    if (e === undefined) return null
    return buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size)
  }
  return {
    magic,
    version,
    entries,
    dataStart,
    read,
    has: (name: string) => entries.some((x) => x.name === name),
  }
}

/** 读取并解析 scene.json（WE 怪癖：缺头括号 + 尾部垃圾） */
export function readSceneJson(pkg: ParsedPkg): Record<string, unknown> | null {
  const buf = pkg.read('scene.json')
  if (buf === null) return null
  try {
    return parseJsonLike(buf) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 解析 WE 的"类 JSON"文本：补 { 并截断到最后一个未引用 } */
export function parseJsonLike(buf: Uint8Array): unknown {
  const raw = utf8Slice(buf, 0, buf.length)
  const last = lastUnquotedBrace(raw)
  if (last < 0) throw new Error('no closing brace')
  let text = raw.slice(0, last + 1).trim()
  if (!text.startsWith('{')) text = '{' + text
  return JSON.parse(text)
}

function lastUnquotedBrace(text: string): number {
  let inStr = false
  let esc = false
  let last = -1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') {
      inStr = true
    } else if (c === '}') {
      last = i
    }
  }
  return last
}

function utf8Slice(buf: Uint8Array, start: number, end: number): string {
  let out = ''
  const bytes = buf.subarray(start, end)
  // 只处理常见 ASCII + 多字节 UTF-8（模型/材质文件名常含中文）
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b < 0x80) {
      out += String.fromCharCode(b)
    } else if (b >= 0xc0 && b < 0xe0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i++
    } else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)); i += 2
    } else {
      out += String.fromCharCode(b)
    }
  }
  return out
}

/** 解析 "x y z" 形式的字符串向量（含小数/负数/多余空格），失败返回默认 */
export function parseVec3(text: unknown, def: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (typeof text !== 'string') return def
  const parts = text.trim().split(/\s+/).map(Number)
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return def
  return [parts[0] ?? def[0], parts[1] ?? def[1], parts[2] ?? def[2]]
}

export function parseVec2(text: unknown, def: [number, number] = [0, 0]): [number, number] {
  if (typeof text !== 'string') return def
  const parts = text.trim().split(/\s+/).map(Number)
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return def
  return [parts[0] ?? def[0], parts[1] ?? def[1]]
}

/** 解析 visible：true / {user|script, value} / undefined → 默认 true */
export function resolveVisible(v: unknown, def = true): boolean {
  if (v === undefined || v === null) return def
  if (typeof v === 'boolean') return v
  if (typeof v === 'object' && (v as { value?: unknown }).value !== undefined) {
    const val = (v as { value?: unknown }).value
    return typeof val === 'boolean' ? val : def
  }
  return def
}

export type { SceneModel, SceneModelLayer }
