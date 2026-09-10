/**
 * 版本串比较（市场用）：点分数字段逐段比大小，后缀（如 `-rc` / `-T` / `+build`）忽略。
 *
 * 为什么需要它：市场目录是**远端数据**（`raw.githubusercontent` 有 CDN 缓存、Actions 也要跑一会儿），
 * 所以"目录里的版本比本机已装的旧"是真会出现的状态。拿它当"更新"用，就会把新包静默装回旧版本
 * （2026-09-10 实际发生过一次：刚发布的 1.1.0 被目录里的 1.0.0 覆盖）。比较在这里统一实现，
 * node 半（安装护栏）与 client 半（卡片按钮状态）共用同一套语义。
 */
export function compareVersion(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v.trim().replace(/^v/i, '').split('.').map((seg) => {
      const m = /^\d+/.exec(seg)
      return m === null ? 0 : Number(m[0])
    })
  const xs = parse(a)
  const ys = parse(b)
  const n = Math.max(xs.length, ys.length)
  for (let i = 0; i < n; i++) {
    const x = xs[i] ?? 0
    const y = ys[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}
