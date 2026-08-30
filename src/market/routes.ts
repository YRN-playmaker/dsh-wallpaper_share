/**
 * DWP market 的 HTTP 路由（R4 node 半）：注册到 share 的 WebServer。
 * 与 src/index.ts 的 Route/Req/Res 契约结构兼容（本地重声明避免拉入重依赖）。
 * 控制面 API（localhost）：
 *   GET  <base>/catalog            → 拉取并回传 catalog（缓存于 client）
 *   GET  <base>/installed          → 已装列表
 *   GET  <base>/install?id=<id>    → 从缓存 catalog 查条目并安装（付费回 402）
 *   GET  <base>/uninstall?id=<id>  → 卸载
 *   GET  <base>/updates            → 可更新条目
 * 纯 handler，Node 用假 req/res 可测。
 */
import type { MarketClient } from './pull.ts';
import { NeedsPurchaseError } from './pull.ts';
import type { Catalog, CatalogEntry } from './catalog.ts';

export interface Req { url?: string; method?: string }
export interface Res { statusCode: number; setHeader(name: string, v: string): void; end(body?: unknown): void }
export interface Route { kind: 'exact' | 'prefix'; path: string; handler(req: Req, res: Res): void | Promise<void> }

export interface MarketRoutesDeps {
  market: MarketClient;
  catalogUrl: string;
  base?: string;   // 路由前缀，默认 /we-sync/dwp/market
}

function query(req: Req): URLSearchParams {
  const u = new URL(req.url ?? '/', 'http://localhost');
  return u.searchParams;
}
function json(res: Res, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function createMarketRoutes(deps: MarketRoutesDeps): Route[] {
  const base = deps.base ?? '/we-sync/dwp/market';
  let cache: Catalog | null = null;
  const ensureCatalog = async (): Promise<Catalog> => (cache ??= await deps.market.catalog(deps.catalogUrl));

  const catalog: Route = { kind: 'exact', path: base + '/catalog', handler: async (_req, res) => {
    try { json(res, 200, await ensureCatalog()); }
    catch (e) { json(res, 502, { error: String((e as Error).message ?? e) }); }
  } };

  const installed: Route = { kind: 'exact', path: base + '/installed', handler: (_req, res) => {
    json(res, 200, { installed: deps.market.installed() });
  } };

  const install: Route = { kind: 'exact', path: base + '/install', handler: async (req, res) => {
    const id = query(req).get('id');
    if (!id) return json(res, 400, { error: '缺 id' });
    let entry: CatalogEntry | undefined;
    try { entry = (await ensureCatalog()).entries.find((e) => e.id === id); }
    catch (e) { return json(res, 502, { error: String((e as Error).message ?? e) }); }
    if (!entry) return json(res, 404, { error: `catalog 无此 id: ${id}` });
    try { json(res, 200, { ok: true, record: await deps.market.install(entry) }); }
    catch (e) {
      if (e instanceof NeedsPurchaseError) return json(res, 402, { error: 'needs-purchase', salesUrl: e.salesUrl, platform: e.platform });
      return json(res, 500, { error: String((e as Error).message ?? e) });
    }
  } };

  const uninstall: Route = { kind: 'exact', path: base + '/uninstall', handler: (req, res) => {
    const id = query(req).get('id');
    if (!id) return json(res, 400, { error: '缺 id' });
    deps.market.uninstall(id);
    json(res, 200, { ok: true });
  } };

  const updates: Route = { kind: 'exact', path: base + '/updates', handler: async (_req, res) => {
    try { json(res, 200, { updates: deps.market.updates(await ensureCatalog()) }); }
    catch (e) { json(res, 502, { error: String((e as Error).message ?? e) }); }
  } };

  return [catalog, installed, install, uninstall, updates];
}
