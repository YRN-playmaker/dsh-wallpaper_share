/**
 * catalog 数据模型 + 拉取（R4 market）。与 dwp-registry 的 catalog.json 对齐。
 * fetch 注入：默认 globalThis.fetch，测试喂假响应。
 */

export interface CatalogEntry {
  id: string;
  name: { zh: string; en: string };
  author: string;
  description?: string;
  tags?: string[];
  license: { code: string; content: string; commercial: boolean };
  dwp: {
    spec: string;
    width?: number; height?: number;
    package: { version: string; url: string; integrity: string; size: number; entry?: string };
    thumbnail: string;
    screenshots?: string[];
    params?: Record<string, string | number | boolean>;
  };
  sales?: null | { platform: string; url: string; entitlement: string };
  compatibility?: { dsh?: string; platform?: string[] };
  featured?: boolean;
  updatedAt?: string;
}

export interface Catalog {
  schemaVersion: number;
  generatedAt: string;
  count: number;
  entries: CatalogEntry[];
}

export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

const defaultFetch: FetchFn = (url) => fetch(url);

/** 拉取并粗校验 catalog.json。 */
export async function fetchCatalog(url: string, fetchFn: FetchFn = defaultFetch): Promise<Catalog> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`catalog 拉取失败 ${url}: ${res.status}`);
  const raw = await res.json() as Partial<Catalog>;
  if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.entries)) {
    throw new Error('catalog 形状非法：缺 entries 数组');
  }
  if (raw.schemaVersion !== 1) throw new Error(`catalog schemaVersion 不支持: ${raw.schemaVersion}`);
  return { schemaVersion: 1, generatedAt: raw.generatedAt ?? '', count: raw.entries.length, entries: raw.entries };
}

/** 免费包可自动安装；付费包需先经销售平台授权。 */
export const canAutoInstall = (e: CatalogEntry): boolean => e.license.commercial === false;
