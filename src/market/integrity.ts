/**
 * 完整性校验（R4 market 拉取）：npm 风格 "sha512-<base64>"。
 * 下载字节必须匹配注册表声明的 integrity，否则拒绝安装（防篡改/半包）。
 */
import { createHash } from 'node:crypto';

export function sha512Base64(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('base64');
}

/** 计算某字节流的规范 integrity 串。 */
export function integrityOf(bytes: Uint8Array): string {
  return 'sha512-' + sha512Base64(bytes);
}

/** 校验字节流是否匹配 integrity（"sha512-…"）。 */
export function verifyIntegrity(bytes: Uint8Array, integrity: string): boolean {
  const m = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity.trim());
  if (!m) return false;
  const want = m[1]!;
  const got = sha512Base64(bytes);
  // 长度不等先短路；再逐字符定长比较（避免早退时序，虽非机密但保持一致习惯）
  if (want.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
