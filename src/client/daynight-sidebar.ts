// Inline vectors stay behind the button's contents and do not intercept clicks.
// Fixed pixel sizes keep silhouettes readable in both wide rows and the icon rail.
const fishImage = (opacity: number, flipped: boolean): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="40" viewBox="0 0 144 40"><g fill="#10254c" opacity="${opacity}"${flipped ? ' transform="translate(144 0) scale(-1 1)"' : ''}><g transform="translate(3.9 2) scale(0.9)"><path d="M53 20C47 13 39 13 32 17L25 12L26 20L25 28L32 23C39 27 47 27 53 20Z"/><path d="M38 15L42 10L45 16ZM37 25L41 30L44 24Z"/></g></g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** Host sidebar accents belong to the plugin, not the code-free DWP scene. */
export function dayNightSidebarCss(id: string | null): string {
  if (id !== 'yrn.deepseek-day-night') return ''
  // AppFrame's sidebarCol contains both the expanded sidebar and collapsed rail.
  // Scope by the CSS-module local name instead of its changing generated hash.
  // The brand wordmark is an action button but intentionally has no accents.
  const control = '[class*="sidebarCol"] :is(button, a[href], [role="button"], [role="treeitem"]):not([class*="brand"]):not(:disabled):not([aria-disabled="true"])'
  const selected = control + ':is([aria-current="page"], [aria-current="true"], [aria-selected="true"], [aria-pressed="true"], [data-state="active"])'
  return `
${control}:hover, ${selected} {
  background-color: #2563eb !important;
  color: #fff !important;
  --dsw-alias-label-primary: #fff;
  --dsw-alias-label-secondary: #fff;
}
${selected} {
  background-image: ${fishImage(0.48, false)}, ${fishImage(0.25, true)} !important;
  background-size: 144px 40px, 216px 32px;
  background-repeat: repeat-x;
  animation: wesync-daynight-fish-swim 8s linear infinite;
}
@keyframes wesync-daynight-fish-swim {
  0% { background-position: -144px calc(50% - 2px), 0 calc(50% + 5px); }
  50% { background-position: -72px calc(50% + 2px), -108px calc(50% + 1px); }
  100% { background-position: 0 calc(50% - 2px), -216px calc(50% + 5px); }
}
@media (prefers-reduced-motion: reduce) {
  ${selected} {
    animation: none;
    background-position: 0 50%, 72px 50%;
  }
}
`
}
