/** Desktop pages use a private scheme that external browsers cannot open. */
export function loginHelperUrl(pageUrl = location.href): string {
  const page = new URL(pageUrl)
  if (page.protocol === 'http:' || page.protocol === 'https:') {
    return new URL('/we-sync/login-sync.user.js', page).href
  }
  return 'https://raw.githubusercontent.com/YRN-playmaker/dsh-wallpaper_share/main/tools/login-sync.user.js'
}
