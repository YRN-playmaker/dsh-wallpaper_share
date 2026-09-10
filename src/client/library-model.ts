/**
 * 壁纸库「本地」栏的纯逻辑层：应用大类 / 二级分类归属、启动器记录匹配、详情字段格式化。
 *
 * 从 WallpaperSharePanel.tsx 抽出来的原因：面板是 .tsx（Node 的 TS 类型剥离不支持 JSX，
 * 测试无法直接 import），而这些判断逻辑是"看得见但容易写错"的部分（目录末段 = slug、
 * 二级分类计数、安装时间格式化），值得用 node --test 覆盖。全部为纯函数，无 DOM / fetch 依赖。
 */

/** 服务端 /we-sync/apps 返回的应用条目（scanApps 的扫描结果）。 */
export interface LibraryApp {
  id: string
  title: string
  file: string
  type: string
  hasPreview: boolean
  /** 'launcher' = 启动器安装根下的包；'' = WE 工坊 / 自定义目录扫到的 */
  source?: string
}

/** 启动器安装记录里本模块用到的字段子集（与 launcher-api 的 InstalledApp 结构兼容）。 */
export interface LauncherRecord {
  id: string
  title: string
  slug: string
  file: string
  installedAt: string
}

/** 「应用」大类下的二级分类：全部 / we应用（WE 工坊）/ 应用（启动器装的）。 */
export type AppSub = 'all' | 'we' | 'launcher'

export const isApplication = (a: LibraryApp): boolean => a.type === 'application'

export const isLauncherApp = (a: LibraryApp): boolean => (a.source ?? '') === 'launcher'

/** 应用大类切分：all 为全部应用；we 排除启动器装的；launcher 只留启动器装的。 */
export function partitionApps(apps: LibraryApp[]): { all: LibraryApp[]; we: LibraryApp[]; launcher: LibraryApp[] } {
  const only = apps.filter(isApplication)
  return {
    all: only,
    we: only.filter((a) => !isLauncherApp(a)),
    launcher: only.filter(isLauncherApp),
  }
}

/** 按二级分类取子集（all 返回全部应用）。 */
export function appsForSub(apps: LibraryApp[], sub: AppSub): LibraryApp[] {
  return partitionApps(apps)[sub]
}

/**
 * 目录路径取末段。scanApps 的 id 就是壁纸目录全路径（服务端 normalize 成 '/' 分隔），
 * 启动器安装的应用目录恒为 `<安装根>/<slug>`，因此末段即 slug。
 * 末尾有分隔符时也要正确取到（split + 过滤空段）。
 */
export function slugOfDir(dir: string): string {
  const parts = dir.replace(/\\/g, '/').split('/').filter((s) => s !== '')
  return parts.length === 0 ? '' : parts[parts.length - 1]!
}

/**
 * 扫描到的「应用」瓷砖 → 启动器安装记录（用于给出「卸载」）。
 * 优先按目录末段匹配 slug（唯一可信的对应关系）；匹配不到时**只在服务端已标记
 * source === 'launcher' 的前提下**按标题兜底（目录被重命名过的情况）。
 *
 * 标题兜底必须卡在 source 上：工坊 / 自定义目录里的应用和启动器应用完全可能同名，
 * 若放开兜底，点工坊瓷砖的「卸载」会删掉另一条启动器记录——那是真实的数据损失。
 * 返回 null 表示"不是启动器装的"：这种瓷砖只给「打开源文件」。
 */
export function matchLauncherRecord<T extends LauncherRecord>(app: LibraryApp, records: T[]): T | null {
  const slug = slugOfDir(app.id).toLowerCase()
  if (slug !== '') {
    const bySlug = records.find((r) => r.slug.toLowerCase() === slug)
    if (bySlug !== undefined) return bySlug
  }
  if (!isLauncherApp(app)) return null
  return records.find((r) => r.title === app.title) ?? null
}

/** ISO 安装时间 → 本地 `YYYY-MM-DD HH:mm`（解析失败时原样回显，不吞信息）。 */
export function formatInstalledAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number): string => String(n).padStart(2, '0')
  return String(d.getFullYear()) + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

/** 启动器应用目录（详情里的「地址」）：安装根 + slug，统一 Windows 反斜杠。 */
export function launcherAppDir(root: string, slug: string): string {
  const r = root.trim().replace(/[\\/]+$/, '')
  if (r === '') return slug
  return r.replace(/\//g, '\\') + '\\' + slug
}
