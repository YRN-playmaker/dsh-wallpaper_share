/** The host exposes this marker on the Ctrl+, settings dialog in both clients. */
export const SETTINGS_GLASS_CSS = `
[data-shortcut-modal="settings"][role="dialog"] {
  --wesync-settings-fill: rgba(250, 251, 253, 0.55);
  background: var(--wesync-settings-fill) !important;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
[data-ds-dark-theme] [data-shortcut-modal="settings"][role="dialog"] {
  --wesync-settings-fill: rgba(24, 26, 32, 0.55);
}
@supports not (backdrop-filter: blur(1px)) {
  [data-shortcut-modal="settings"][role="dialog"] {
    --wesync-settings-fill: rgb(250, 251, 253);
  }
  [data-ds-dark-theme] [data-shortcut-modal="settings"][role="dialog"] {
    --wesync-settings-fill: rgb(24, 26, 32);
  }
}
`
