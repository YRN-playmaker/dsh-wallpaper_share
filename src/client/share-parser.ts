/**
 * 应用启动器「Smart Paste」解析器（纯逻辑；浏览器安全：零 DOM / 零 node 依赖）。
 *
 * 目标：用户把一整段混乱的分享文本（帖子正文 + 链接 + 提取码 + 解压码 + 需求说明）
 * 一次性粘进来，这里从中**局部**提取出安装真正需要的四项信息：
 *
 *   原始文本 → normalizeInput → 候选提取 → 锚点/关键词 + 局部窗口 → 置信度 → ParsedInstallInfo
 *
 * 设计约束（见需求文档）：
 *  - 不做整段语义分析、不接 LLM、不引 NLP 依赖；
 *  - 关键词只影响它**附近有限字符**（锚点 + 局部窗口），避免"几百字之外的 token"被误吃；
 *  - 一切判断都是"候选 + 评分"，字段值附带 0~1 置信度，由 UI 决定是否自动填入；
 *  - 任何异常输入（''、null、超长、纯标点）都不得抛错——解析器只是"尽力而为"。
 *
 * 之所以放在 client 半：只有面板（WallpaperSharePanel.tsx）用它，且必须能进浏览器包。
 * 与 library-model.ts 同款：纯函数抽出来，便于 node --test 直接覆盖（.tsx 无法被类型剥离加载）。
 */

/* =========================================================================
 * 0. 对外类型与阈值
 * ========================================================================= */

/** 密码候选的分类：分享提取码 / 解压密码 / 无法判断。 */
export type CredentialType = 'share' | 'archive' | 'unknown'

/** 一条密码候选（提取码或解压密码）。 */
export interface CredentialCandidate {
  value: string
  type: CredentialType
  /** 0~1；「解压密码:」这类明确锚点高，「密码:」这类通用锚点低 */
  confidence: number
  /** 命中的锚点原文（如「解压码」「提取码」「密码」），可用于 UI 提示判断依据 */
  anchor: string
  /** 锚点是否明确标注了用途；通用锚点（密码 / password）为 false */
  labeled: boolean
}

export interface ParsedConfidence {
  sourceUrl: number
  shareCode: number
  archivePassword: number
  executableName: number
}

/** 解析结果：字段缺省 = 没识别到（不是空串）。 */
export interface ParsedInstallInfo {
  sourceUrl?: string
  shareCode?: string
  archivePassword?: string
  executableName?: string
  confidence: ParsedConfidence
  /** 全部密码候选（含未落字段的），供 UI 提示 */
  candidates: CredentialCandidate[]
  /** 置信度达标的字段数（用于"已识别 N 项信息"提示） */
  matched: number
  /** 用户原始输入（未 normalize），原样带回 */
  rawText: string
}

/** 达到此置信度才自动填入（>= 0.8）。 */
export const CONFIDENCE_AUTO = 0.8
/** 低于此置信度不填入；[0.5, 0.8) 填入但 UI 应提示"可能"（< 0.5）。 */
export const CONFIDENCE_LOW = 0.5

/* =========================================================================
 * 1. 文本预处理
 * ========================================================================= */

/** 零宽字符 / 双向控制符：肉眼看不见，但会打断锚点匹配。 */
const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g

/**
 * Markdown 链接 / 图片：[label](target "title") → label target
 * title 里常常是同一个 URL（复制粘贴产物），一并丢掉，后面按 URL 去重。
 * target 用非空白、非括号序列匹配：云盘链接里出现括号的情况极少。
 */
const MD_LINK_RE = /!?\[([^\]\n]*)\]\(\s*([^()\s]+)(?:\s+["'][^"']*["'])?\s*\)/g

/**
 * 输入 normalize（幂等）：换行 / 全角冒号 / Tab / 多空格 / Markdown / 零宽字符 / 连续空行。
 * 只做"不影响语义"的整理，不改动中文正文本身。
 */
export function normalizeInput(rawText: unknown): string {
  if (typeof rawText !== 'string' || rawText === '') return ''
  let s = rawText
  s = s.replace(ZERO_WIDTH_RE, '')
  s = s.replace(/\r\n?/g, '\n')
  s = s.replace(/\t/g, ' ')
  s = s.replace(MD_LINK_RE, (_m, label: string, target: string) => `${label} ${target}`)
  // 换行折断的链接先拼回去（再往后的空白/换行整理不会再把它们分开）
  s = s.replace(WRAPPED_URL_RE, (_m, a: string | undefined, b: string | undefined) => a ?? b ?? '')
  // 全角冒号/等号 → 半角：锚点分隔符只需认一种写法
  s = s.replace(/：/g, ':').replace(/＝/g, '=')
  // 行内连续空白（不含换行）压成一个空格；3 个以上换行压成一个空行
  s = s.replace(/[^\S\n]{2,}/g, ' ')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

/* =========================================================================
 * 2. URL 提取与排序
 * ========================================================================= */

/**
 * URL 扫描：http(s):// 开头，遇到空白 / 引号 / 反斜杠 / 括号 / 管道 / CJK / 全角字符即停。
 * 因此"链接：https://a.com/x 复制内容…"、"https://a.com/x需要预留10G"、
 * "(https://a.com/x)"、"（https://a.com/x）" 都能正确截断。
 * 代价：URL 自身带括号（维基式 `Foo_(bar)`）会被截短——分享链接里几乎不会出现。
 */
const URL_RE = /https?:\/\/[^\s<>"'`\\|^[\]{}()\u3000-\u303F\u4E00-\u9FFF\uFF00-\uFFEF]+/gi

/** URL 允许出现的一个字符（不含空白 / 引号 / 反斜杠 / 括号 / CJK / 全角）。 */
const URL_CHAR = '[^\\s<>"\'`\\\\|^\\[\\]{}()\\u3000-\\u303F\\u4E00-\\u9FFF\\uFF00-\\uFFEF]'

/**
 * 换行折断的链接（复制论坛 / 微信正文时的常见形态）：上一行以 URL 结尾，下一行是它的续接。
 * 只在两种明确信号下拼接，避免把"URL 后面另起一行的普通词"错接进去：
 *   a) 下一行以路径续接符 `/ # ? & = %` 开头；或
 *   b) 上一行 URL 停在 `/#?&=%_-`（明显断在结构中间）**且**下一行整行都是 URL 安全字符。
 */
const WRAPPED_URL_RE = new RegExp(
  `(https?:\\/\\/${URL_CHAR}+)\\n(?=[/#?&=%])`
  + `|(https?:\\/\\/${URL_CHAR}*[/#?&=%_-])\\n(?=[A-Za-z0-9._~:/?#\\[\\]@!$&'()*+,;=%-]+(?:\\n|$))`,
  'g',
)

/**
 * 无协议链接：`host.tld/路径`。
 * 分享文本里很常见（微信 / QQ / 网盘客户端复制出来的正文经常只剩裸域名），
 * 只在前面的 http(s) 扫描一个都没命中时才启用：既避免与正常链接重复，也少惹噪声。
 * 必须带 `/` 路径段，所以 `Game.exe`、散文里的 `example.com`、`版本1.2.3` 都不会命中。
 */
const BARE_URL_RE = new RegExp(
  `(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,24}(?::\\d{2,5})?\\/${URL_CHAR}*`,
  'gi',
)
/** 裸链接前面不能是这些字符（否则说明它粘在更长的 token / 路径 / 邮箱里）。 */
const BARE_URL_GLUE_RE = /[\w@./-]/

/** URL 末尾常见的标点（中文句读 / 句号 / 右括号等）：扫描残留时剪掉。 */
const URL_TAIL_RE = /[.,;:!?'"`、。，；：！？…·）】》」』]+$/

/** 已知云盘 / 文件托管域名 → 加分（只用于"多个 URL 时排序"，不是白名单）。 */
const HOST_SCORES: ReadonlyArray<readonly [RegExp, number]> = [
  [/(?:^|\.)yun\.139\.com$/i, 0.35],                    // 本插件唯一已适配的云盘分享
  [/(?:^|\.)(?:caiyun\.139|139)\.com$/i, 0.2],
  [/(?:^|\.)(?:aliyundrive|alipan)\.com$/i, 0.3],
  [/(?:^|\.)pan\.quark\.cn$/i, 0.3],
  [/(?:^|\.)cloud\.189\.cn$/i, 0.3],
  [/(?:^|\.)123pan\.com$/i, 0.3],
  [/(?:^|\.)lanzou[a-z]?\.com$/i, 0.3],
  [/(?:^|\.)(?:115|anxia)\.com$/i, 0.25],
  [/(?:^|\.)(?:weiyun|drive\.qq)\.com$/i, 0.25],
  [/(?:^|\.)(?:mega\.nz|mediafire\.com|dropbox\.com|1drv\.ms|onedrive\.live\.com|drive\.google\.com)$/i, 0.25],
  [/(?:^|\.)(?:github\.com|githubusercontent\.com|gitee\.com|sourceforge\.net|itch\.io|nexusmods\.com|moddb\.com)$/i, 0.2],
]

/** 分享 / 下载特征路径。 */
const PATH_HINT_RE = /(?:\/share|\/download|\/file|\/s\/|\/d\/|\/f\/|\/p\/|\/w\/i\/|shareweb)/i
/** 压缩包 / 安装包扩展名。 */
const ARCHIVE_EXT_RE = /\.(?:zip|7z|rar|tar|gz|xz|bz2|exe|msi|iso|001)(?:\.\d{3})?$/i

/** 去重键：忽略大小写与末尾斜杠，避免同一链接的两种写法被当成两个候选。 */
function urlDedupeKey(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '')
}

interface UrlSpan {
  url: string
  start: number
  end: number
}

/**
 * 扫描全部 URL 出现位置（含清洗后的起止下标，供"是否落在 URL 内"判断）。
 * 先找带协议的；一个都没有时才退到"裸域名 + 路径"（分享正文里很常见）。
 */
function findUrlSpans(text: string): UrlSpan[] {
  const spans: UrlSpan[] = []
  const re = new RegExp(URL_RE.source, 'gi')
  for (const m of text.matchAll(re)) {
    const raw = m[0]
    const start = m.index ?? 0
    const trimmed = raw.replace(URL_TAIL_RE, '')
    if (trimmed === '') continue
    spans.push({ url: trimmed, start, end: start + trimmed.length })
  }
  if (spans.length > 0) return spans

  const bare = new RegExp(BARE_URL_RE.source, 'gi')
  for (const m of text.matchAll(bare)) {
    const raw = m[0]
    const start = m.index ?? 0
    if (start > 0 && BARE_URL_GLUE_RE.test(text[start - 1]!)) continue
    const trimmed = raw.replace(URL_TAIL_RE, '')
    if (trimmed === '') continue
    // 补协议：后续校验（isValidHttpUrl / new URL）都按 http(s) 处理
    spans.push({ url: 'https://' + trimmed, start, end: start + trimmed.length })
  }
  return spans
}

/** 从任意文本中提取 URL（保持出现顺序、按规范化键去重）。 */
export function extractUrls(text: string): string[] {
  if (typeof text !== 'string' || text === '') return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const span of findUrlSpans(text)) {
    const key = urlDedupeKey(span.url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(span.url)
  }
  return out
}

/** 单条 URL 的"像不像下载源"打分（0~1），只影响多个候选时的排序。 */
export function scoreSourceUrl(url: string): number {
  let score = 0.6
  let host = ''
  let path = ''
  try {
    const u = new URL(url)
    host = u.hostname
    path = u.pathname
  } catch {
    return 0.5
  }
  for (const [re, add] of HOST_SCORES) {
    if (re.test(host)) { score += add; break }
  }
  if (PATH_HINT_RE.test(path)) score += 0.15
  if (ARCHIVE_EXT_RE.test(path)) score += 0.25
  return Math.max(0, Math.min(1, score))
}

export interface SourceUrlPick {
  url: string
  score: number
  confidence: number
}

/**
 * 多 URL 时挑一个最像"下载 / 分享源"的。
 * 只有一个 URL 时置信度 0.9~0.99；多个时按与次优的分差给 0.5 / 0.7 / 0.9——
 * 打平时仍返回第一个（宁可填上让用户改，也不要什么都不填），但置信度只有 0.5。
 */
export function pickSourceUrl(urls: string[]): SourceUrlPick | null {
  if (!Array.isArray(urls) || urls.length === 0) return null
  const scored = urls.map((url) => ({ url, score: scoreSourceUrl(url) }))
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]!
  if (scored.length === 1) {
    return { ...best, confidence: Math.min(0.99, Math.max(0.9, best.score)) }
  }
  const gap = best.score - scored[1]!.score
  const confidence = gap >= 0.25 ? 0.9 : gap >= 0.1 ? 0.7 : 0.5
  return { ...best, confidence }
}

/** 是否"云盘分享页"（用于判断未标注用途的密码更可能是提取码还是解压密码）。 */
const CLOUD_HOST_RE = /(?:^|\.)(?:yun\.139\.com|caiyun\.139\.com|aliyundrive\.com|alipan\.com|pan\.quark\.cn|cloud\.189\.cn|123pan\.com|lanzou[a-z]?\.com|115\.com|weiyun\.com|drive\.qq\.com|mega\.nz|mediafire\.com|dropbox\.com|1drv\.ms|drive\.google\.com)$/i
const CLOUD_SHARE_PATH_RE = /(?:#\/|\/s\/|\/share|\/w\/i\/|\/f\/|\/d\/|shareweb)/i

export function isShareLikeUrl(url: string): boolean {
  if (typeof url !== 'string' || url === '') return false
  try {
    const u = new URL(url)
    return CLOUD_HOST_RE.test(u.hostname) && CLOUD_SHARE_PATH_RE.test(u.pathname + u.hash)
  } catch { return false }
}

/* =========================================================================
 * 3. 密码候选：锚点 + 局部窗口
 * ========================================================================= */

interface AnchorDef {
  text: string
  type: CredentialType
  confidence: number
  /** 明确标注用途（解压 / 提取…）= true；通用「密码」= false */
  labeled: boolean
  /** 锚点是否纯 ASCII（英文锚点需要额外防"粘在单词里"） */
  ascii: boolean
}

/**
 * 锚点表。注意：
 *  - 中文锚点必须"长者在先"，组合成正则时按长度倒序，避免「解压密码」被「密码」先吃掉；
 *  - 普通「密码」置信度 0.5，明显低于「解压密码 / 压缩包密码」（0.95）——
 *    它只作为低置信度候选，由 classifyCredential 结合链接类型再猜。
 */
const ANCHORS: readonly AnchorDef[] = [
  // —— 解压 / 压缩包（强锚点）——
  { text: '压缩包解压密码', type: 'archive', confidence: 0.95, labeled: true, ascii: false },
  { text: '压缩包解压码', type: 'archive', confidence: 0.95, labeled: true, ascii: false },
  { text: '解压缩密码', type: 'archive', confidence: 0.95, labeled: true, ascii: false },
  { text: '压缩包密码', type: 'archive', confidence: 0.95, labeled: true, ascii: false },
  { text: '解压密码', type: 'archive', confidence: 0.95, labeled: true, ascii: false },
  { text: '解压口令', type: 'archive', confidence: 0.9, labeled: true, ascii: false },
  { text: '压缩密码', type: 'archive', confidence: 0.9, labeled: true, ascii: false },
  { text: '解包密码', type: 'archive', confidence: 0.85, labeled: true, ascii: false },
  { text: '解密密码', type: 'archive', confidence: 0.85, labeled: true, ascii: false },
  { text: '解压码', type: 'archive', confidence: 0.95, labeled: true, ascii: false },
  { text: 'archive password', type: 'archive', confidence: 0.9, labeled: true, ascii: true },
  { text: 'unzip password', type: 'archive', confidence: 0.9, labeled: true, ascii: true },
  { text: 'zip password', type: 'archive', confidence: 0.9, labeled: true, ascii: true },
  { text: 'rar password', type: 'archive', confidence: 0.9, labeled: true, ascii: true },
  { text: 'extract password', type: 'archive', confidence: 0.85, labeled: true, ascii: true },
  // —— 分享提取码（强锚点）——
  { text: '分享提取码', type: 'share', confidence: 0.95, labeled: true, ascii: false },
  { text: '提取码', type: 'share', confidence: 0.95, labeled: true, ascii: false },
  { text: '提取密码', type: 'share', confidence: 0.9, labeled: true, ascii: false },
  { text: '访问码', type: 'share', confidence: 0.9, labeled: true, ascii: false },
  { text: '访问密码', type: 'share', confidence: 0.9, labeled: true, ascii: false },
  { text: '分享码', type: 'share', confidence: 0.9, labeled: true, ascii: false },
  { text: '分享密码', type: 'share', confidence: 0.9, labeled: true, ascii: false },
  { text: '取件码', type: 'share', confidence: 0.9, labeled: true, ascii: false },
  { text: 'share code', type: 'share', confidence: 0.9, labeled: true, ascii: true },
  { text: 'access code', type: 'share', confidence: 0.9, labeled: true, ascii: true },
  { text: 'share password', type: 'share', confidence: 0.85, labeled: true, ascii: true },
  // —— 通用（弱锚点，低置信度）——
  { text: 'password', type: 'unknown', confidence: 0.5, labeled: false, ascii: true },
  { text: '密码', type: 'unknown', confidence: 0.5, labeled: false, ascii: false },
]

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 锚点原文（小写）→ 定义；正则匹配结果按此回查，避免在正则里塞重复分支。 */
const ANCHOR_INDEX = new Map<string, AnchorDef>(
  ANCHORS.map((a) => [a.text.toLowerCase(), a] as const),
)

/**
 * 锚点后允许的分隔符（局部窗口只有几个字符）：
 * 空白 / 冒号 / 等号 / "是|为|等于" 的任意组合，最多跨**一个**换行
 * （"解压密码：\nWS" 在分享帖里很常见）。
 * 关键性质：这个集合里没有中文字、也没有普通字母，所以它只能前进几个字符，
 * 不可能把锚点的影响范围拉远——"局部窗口"由此保证。
 * 这里同时接受全角冒号，便于函数在未 normalize 的文本上直接调用（幂等、不自作聪明）。
 */
const SEP = '(?:[^\\S\\n]|[:=：＝]|是|为|等于)*(?:\\n(?:[^\\S\\n]|[:=：＝])*)?[:=：＝]?[^\\S\\n]*'

/** 密码 token：字母数字 + 常见密码/URL-safe 特殊字符，长度 <= 64（防"把整句吃进来"）。 */
const TOKEN = '[A-Za-z0-9_\\-@#!.$%^&*+~]{1,64}'

const ANCHOR_ALT = [...ANCHORS]
  .sort((a, b) => b.text.length - a.text.length)
  .map((a) => escapeRe(a.text))
  .join('|')

const CRED_RE = new RegExp(`(${ANCHOR_ALT})${SEP}(${TOKEN})`, 'gi')

/** token 尾部的中文句读 / 英文句号：属于句子而不属于密码。 */
const TOKEN_TAIL_RE = /[.,;:!?]+$/
/** 尺寸 / 版本号这类"看着像密码其实不是"的 decoy（仅在弱锚点下过滤）。 */
const SIZE_TOKEN_RE = /^\d{1,4}(?:\.\d+)?\s?(?:k|kb|m|mb|g|gb|t|tb|p|pb)$/i
const VERSION_TOKEN_RE = /^\d+(?:\.\d+){2,}$/
/** 前一字符为这些时说明锚点"粘"在 URL / 查询串里。 */
const URL_GLUE_RE = /[&=?#]/
/** 前一字符为这些时说明英文锚点粘在更长的英文单词里（mypassword）。 */
const WORD_GLUE_RE = /[A-Za-z0-9._-]/

function isInsideSpan(index: number, spans: UrlSpan[]): boolean {
  return spans.some((s) => index >= s.start && index < s.end)
}

function isDecoyToken(value: string): boolean {
  return SIZE_TOKEN_RE.test(value) || VERSION_TOKEN_RE.test(value)
}

/**
 * 从整段文本里提取全部密码候选（此时 type 可能仍是 unknown）。
 * 每一步都受"锚点 + 局部窗口"约束：anchor 后立即取短 token，取不到就放弃——
 * 绝不从远处捞一个 token 回来（否则「游戏密码机制做得不好」会误伤）。
 */
export function extractCredentialCandidates(text: string): CredentialCandidate[] {
  if (typeof text !== 'string' || text === '') return []
  const spans = findUrlSpans(text)
  const out: CredentialCandidate[] = []
  const re = new RegExp(CRED_RE.source, 'gi')
  for (const m of text.matchAll(re)) {
    const anchorDef = ANCHOR_INDEX.get((m[1] ?? '').toLowerCase())
    if (anchorDef === undefined) continue
    const index = m.index ?? 0
    const value = (m[2] ?? '').replace(TOKEN_TAIL_RE, '')
    if (value === '' || !/[A-Za-z0-9]/.test(value)) continue
    if (isInsideSpan(index, spans)) continue
    const prev = text[index - 1]
    if (prev !== undefined && URL_GLUE_RE.test(prev)) continue
    if (anchorDef.ascii && prev !== undefined && WORD_GLUE_RE.test(prev)) continue
    // 锚点后面紧跟 `://` → token 其实是 URL 的 scheme，不是密码
    const after = text.slice(index + (m[0]?.length ?? 0), index + (m[0]?.length ?? 0) + 3)
    if (after === '://') continue
    if (!anchorDef.labeled && isDecoyToken(value)) continue
    out.push({
      value,
      type: anchorDef.type,
      confidence: anchorDef.confidence,
      anchor: anchorDef.text,
      labeled: anchorDef.labeled,
    })
  }
  return out
}

/**
 * 给"用途未知"的候选补一个最可能的分类（不改动已明确的候选）：
 *  - 链接像云盘分享页 → 更可能是分享提取码（0.6，低置信度）；
 *  - 否则按解压密码处理（0.5，低置信度，UI 应提示"未标注用途，请核对"）。
 * 明确不猜成高置信度：错填密码会让安装直接失败，不如让用户看一眼。
 */
export function classifyCredential(
  candidate: CredentialCandidate,
  ctx: { url?: string } = {},
): CredentialCandidate {
  if (candidate.type !== 'unknown') return candidate
  if (ctx.url !== undefined && isShareLikeUrl(ctx.url)) {
    return { ...candidate, type: 'share', confidence: 0.6 }
  }
  return { ...candidate, type: 'archive', confidence: 0.5 }
}

/** 取某类型里置信度最高的候选（并列取先出现的）。 */
function bestCandidate(
  candidates: CredentialCandidate[],
  type: CredentialType,
): CredentialCandidate | undefined {
  let best: CredentialCandidate | undefined
  for (const c of candidates) {
    if (c.type !== type) continue
    if (best === undefined || c.confidence > best.confidence) best = c
  }
  return best
}

/* =========================================================================
 * 4. 启动文件（executable）
 * ========================================================================= */

/** 可执行文件：ASCII 文件名字符 + 常见 Windows 可执行后缀（不含 .com，避免把域名当文件）。 */
const EXE_RE = /[A-Za-z0-9_][A-Za-z0-9_\-.+]*\.(?:exe|bat|cmd|msi|lnk)\b/gi

/** 锚点关键词（前后局部窗口内出现才算"被指认为启动文件"）。 */
const LAUNCH_KEYWORD_RE = /(?:启动|运行|打开|双击|主程序|程序入口|入口|可执行|exe\s*文件)|(?:\b(?:launcher|launch|run|open|start|execute)\b)/i

/** 依赖 / 安装器：同名 token 往往是"先装这个再运行主程序"，不是入口。 */
const DEP_NAME_RE = /^(?:vcredist|vc_redist|dxsetup|directx|dotnet|setup|install|unins|uninstall|update|patch)/i

/** 关键词窗口：锚点在前 40 字符 / 在后 20 字符内都算命中。 */
const KEYWORD_BEFORE = 40
const KEYWORD_AFTER = 20

export interface ExecutablePick {
  name: string
  confidence: number
}

/**
 * 提取启动文件候选。
 *  .exe + 附近有"运行/启动"类关键词 → 0.95+（自动填入）；
 *  只有 .exe 但无关键词 → 0.75（填入但提示）；
 *  依赖型名字（vcredist / setup…）扣分，避免抢在真正的入口前；
 *  什么都没有 → null（调用方保持字段为空，不报错）。
 */
export function extractExecutableCandidate(text: string): ExecutablePick | null {
  if (typeof text !== 'string' || text === '') return null
  const spans = findUrlSpans(text)
  const lower = text.toLowerCase()
  const found: Array<{ name: string; index: number; count: number; confidence: number }> = []
  const re = new RegExp(EXE_RE.source, 'gi')
  for (const m of text.matchAll(re)) {
    const name = m[0]
    const index = m.index ?? 0
    if (isInsideSpan(index, spans)) continue      // 链接里的 xxx.exe 是下载地址，不是入口名
    const before = text.slice(Math.max(0, index - KEYWORD_BEFORE), index)
    const after = text.slice(index + name.length, index + name.length + KEYWORD_AFTER)
    const keywordNear = LAUNCH_KEYWORD_RE.test(before) || LAUNCH_KEYWORD_RE.test(after)
    const count = lower.split(name.toLowerCase()).length - 1
    let confidence = 0.55
    if (/\.exe$/i.test(name)) confidence += 0.2
    if (keywordNear) confidence += 0.25
    if (count >= 2) confidence += 0.05
    if (DEP_NAME_RE.test(name)) confidence -= 0.35
    found.push({ name, index, count, confidence: Math.max(0, Math.min(1, confidence)) })
  }
  if (found.length === 0) return null
  found.sort((a, b) => (b.confidence - a.confidence) || (b.count - a.count) || (a.index - b.index))
  const best = found[0]!
  return { name: best.name, confidence: best.confidence }
}

/* =========================================================================
 * 5. 主入口
 * ========================================================================= */

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * 解析一整段分享文本 → 四项安装信息 + 置信度。
 * 任何字段识别不到就留空（undefined），绝不猜一个高置信度的错值。
 */
export function parseInstallShareText(rawText: string): ParsedInstallInfo {
  const raw = typeof rawText === 'string' ? rawText : ''
  const confidence: ParsedConfidence = { sourceUrl: 0, shareCode: 0, archivePassword: 0, executableName: 0 }
  const result: ParsedInstallInfo = { confidence, candidates: [], matched: 0, rawText: raw }

  let text = ''
  try {
    text = normalizeInput(raw)
  } catch {
    return result
  }
  if (text === '') return result

  const pick = pickSourceUrl(extractUrls(text))
  const candidates = extractCredentialCandidates(text)
    .map((c) => classifyCredential(c, pick === null ? {} : { url: pick.url }))
  const share = bestCandidate(candidates, 'share')
  const archive = bestCandidate(candidates, 'archive')
  const exec = extractExecutableCandidate(text)

  if (pick !== null) {
    result.sourceUrl = pick.url
    confidence.sourceUrl = round2(pick.confidence)
  }
  if (share !== undefined) {
    result.shareCode = share.value
    confidence.shareCode = share.confidence
  }
  if (archive !== undefined) {
    result.archivePassword = archive.value
    confidence.archivePassword = archive.confidence
  }
  if (exec !== null) {
    result.executableName = exec.name
    confidence.executableName = round2(exec.confidence)
  }
  result.candidates = candidates
  result.matched = [confidence.sourceUrl, confidence.shareCode, confidence.archivePassword, confidence.executableName]
    .filter((c) => c >= CONFIDENCE_LOW).length
  return result
}
