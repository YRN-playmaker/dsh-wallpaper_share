# edit 0.2.0 integration

The DWP Studio placeholder is replaced with an optional editor installer. The editor runs inline or in a separate window after downloading the fixed GitHub release asset and verifying its SHA-256. Installed files are cached under DSH_HOME/storages/wallpaper-editor (default ~/.dsh/storages/wallpaper-editor). It does not change host profiles or execute package scripts.

GET /we-sync/editor reads installation status. Same-origin POST with X-Wallpaper-Editor: install installs the pinned asset. GET /we-sync/editor/app serves only verified content. Concurrent requests share one download, temporary files are removed on failure, and subsequent opens work offline.

Source: https://github.com/YRN-playmaker/dsh-wallpaper_edit

Published: https://github.com/YRN-playmaker/dsh-wallpaper_edit/releases/tag/v0.2.0

The public release contains editor.html, editor.sha256 and dsh-wallpaper_edit-0.2.0.tgz. The share installer pins the published editor.html SHA-256. No GitHub login is required for users to download this release.

Windows / Node 24: installation, retry, corruption, concurrent requests and route checks passed; browser installation, inline opening, standalone window, clocks, particles and playback verified using the exact extension bytes through the real installer with a local download fixture.
