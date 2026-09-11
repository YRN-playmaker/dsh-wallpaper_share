Adds a community manifest for **Wallpaper Share** per `registry/community/README.md`.

- `dsh.bundle.patch` → `./cordis.patch.yml` (self-activating bundle row `id: we-sync`, `name: dsh-wallpaper_share`)
- Published on npm as `dsh-wallpaper_share` (latest `26.9.10`); build output (`lib/index.js`, `lib/client.js`) is committed, so the GitHub source is also installable
- Surfaces: `server` (host half — polling + HTTP routes) and `web` (client module — the `wallpaper_share` tab)
- Capability disclosure for review: `shell` / `process-spawn` (the app launcher starts executables after an explicit confirmation dialog), `network` (Wallpaper Engine bridge + cloud-drive share links), `fs-write` (installs into `~/.dsh/storages/we-sync-apps`), `credentials` (optional 139 cloud-drive auth header, stored locally)
- No runtime dependencies (`dependencies` is empty); client half depends on host-provided `@deepseek-ai/dsh-client-runtime` / `@deepseek-ai/dsh-client-ui-theme`

Authorization: the listing is authorized from the plugin's own repository — see the issue opened at https://github.com/YRN-playmaker/dsh-wallpaper_share/issues linking this PR.

Note on `status`: marked `beta` because the app-launcher surface is still evolving (we'd rather understate; happy to have it reviewed as `stable` if you prefer).