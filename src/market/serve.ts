/**
 * DWP 内容伺服 + 应用路由（R4 渲染面 node 半）。
 * 把已装 .dwp 解包，按需提供 scene.json / wallpaper.json / 单个资源，供 client 半
 * 用 @dwp/web 的 mount() 组装渲染；并管理"当前应用"状态。
 * 与 routes.ts 同构（本地 Req/Res/Route，兼容 share 的 WebServer.register）。
 */
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { InstalledStore } from './store.ts';
import type { ApplyState } from './apply.ts';
import { readZipMap } from './unzip.ts';

export interface Req { url?: string; method?: string }
export interface Res { statusCode: number; setHeader(name: string, v: string): void; end(body?: unknown): void }
export interface Route { kind: 'exact' | 'prefix'; path: string; handler(req: Req, res: Res): void | Promise<void> }

export interface ServeDeps { store: InstalledStore; apply: ApplyState; base?: string }

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml',
};
const mimeOf = (name: string): string => MIME[extname(name).toLowerCase()] ?? 'application/octet-stream';

function query(req: Req): URLSearchParams { return new URL(req.url ?? '/', 'http://localhost').searchParams; }
function json(res: Res, code: number, body: unknown): void {
  res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body));
}

export function createDwpServeRoutes(deps: ServeDeps): Route[] {
  const base = deps.base ?? '/we-sync/dwp';
  // 解包缓存：id@version → Map<name, bytes>（重装换 version 自动失效）
  const cache = new Map<string, Map<string, Uint8Array>>();
  const unzipped = (id: string): Map<string, Uint8Array> | null => {
    const rec = deps.store.get(id);
    if (!rec) return null;
    const key = id + '@' + rec.version;
    let m = cache.get(key);
    if (!m) { m = readZipMap(new Uint8Array(readFileSync(join(deps.store.dir, rec.path)))); cache.set(key, m); }
    return m;
  };
  const pick = (m: Map<string, Uint8Array>, want: string): Uint8Array | undefined => {
    if (m.has(want)) return m.get(want);
    const norm = want.replace(/^\.\//, '').replace(/^\/+/, '');
    if (m.has(norm)) return m.get(norm);
    return undefined;
  };

  const applied: Route = { kind: 'exact', path: base + '/applied', handler: (_q, res) => {
    json(res, 200, { applied: deps.apply.get() });
  } };

  const apply: Route = { kind: 'exact', path: base + '/apply', handler: (req, res) => {
    const id = query(req).get('id');
    if (!id) return json(res, 400, { error: '缺 id' });
    const rec = deps.store.get(id);
    if (!rec) return json(res, 404, { error: `未安装: ${id}` });
    json(res, 200, { ok: true, applied: deps.apply.set(id, rec.version) });
  } };

  const unapply: Route = { kind: 'exact', path: base + '/unapply', handler: (_q, res) => {
    deps.apply.clear(); json(res, 200, { ok: true });
  } };

  const files: Route = { kind: 'exact', path: base + '/files', handler: (req, res) => {
    const m = unzipped(query(req).get('id') ?? '');
    if (!m) return json(res, 404, { error: '未安装' });
    json(res, 200, { files: [...m.keys()] });
  } };

  const file: Route = { kind: 'exact', path: base + '/file', handler: (req, res) => {
    const q = query(req); const m = unzipped(q.get('id') ?? '');
    if (!m) return json(res, 404, { error: '未安装' });
    const name = q.get('name'); if (!name) return json(res, 400, { error: '缺 name' });
    const data = pick(m, name); if (!data) return json(res, 404, { error: `包内无此文件: ${name}` });
    res.statusCode = 200; res.setHeader('Content-Type', mimeOf(name)); res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.end(Buffer.from(data));
  } };

  // scene / manifest：从包内取指定 json 文件回传（client 直接 JSON.parse）
  const jsonEntry = (path: string, defaultName: string): Route => ({ kind: 'exact', path: base + path, handler: (req, res) => {
    const q = query(req); const m = unzipped(q.get('id') ?? '');
    if (!m) return json(res, 404, { error: '未安装' });
    const want = q.get('name') ?? defaultName;
    const data = pick(m, want); if (!data) return json(res, 404, { error: `包内无 ${want}` });
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(new TextDecoder().decode(data));
  } });

  return [applied, apply, unapply, files, file, jsonEntry('/manifest', 'wallpaper.json'), jsonEntry('/scene', 'scene.json')];
}
