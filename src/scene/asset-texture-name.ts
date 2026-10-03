/** WE 素材路径允许 Unicode 文件名，仍拒绝路径穿越及 Windows 路径控制字符。 */
export function isSafeAssetTextureName(name: string): boolean {
  return /^[\p{L}\p{M}\p{N}_/. -]+$/u.test(name)
    && !name.startsWith('/') && !name.includes('..')
}
