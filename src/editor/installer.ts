import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const EDITOR_VERSION = '0.2.0'
export const EDITOR_URL = 'https://github.com/YRN-playmaker/dsh-wallpaper_edit/releases/download/v0.2.0/editor.html'
// Pinned to the reviewed release, never to a mutable latest/download URL.
export const EDITOR_SHA256 = 'fdc7e4a97ea4b65ddb8531e91a72e28846b7737722404ec208c79695c5c9a432'
const MAX_BYTES = 8 * 1024 * 1024
export type EditorStatus = { installed: boolean; version: string; installing: boolean }

export class EditorInstaller {
  private pending: Promise<void> | null = null
  private directory: string
  private source: { url: string; sha256: string }
  private download: typeof fetch
  constructor(directory: string, source = { url: EDITOR_URL, sha256: EDITOR_SHA256 }, download: typeof fetch = fetch) {
    this.directory = directory; this.source = source; this.download = download
  }
  private get file(): string { return join(this.directory, `editor-${EDITOR_VERSION}.html`) }
  private valid(bytes: Uint8Array): boolean { return createHash('sha256').update(bytes).digest('hex') === this.source.sha256 }
  async content(): Promise<Buffer | null> {
    try { const b = await readFile(this.file); return this.valid(b) ? b : null }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
  }
  async status(): Promise<EditorStatus> { return { installed: (await this.content()) !== null, version: EDITOR_VERSION, installing: this.pending !== null } }
  async install(): Promise<void> {
    if (this.pending) return this.pending
    this.pending = this.acquire().finally(() => { this.pending = null })
    return this.pending
  }
  private async acquire(): Promise<void> {
    if (await this.content()) return
    const response = await this.download(this.source.url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}），请检查 GitHub 连接后重试。`)
    const chunks: Uint8Array[] = []; let size = 0
    const reader = response.body.getReader()
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) throw new Error('编辑器下载超出大小限制。'); chunks.push(value) }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    const bytes = Buffer.concat(chunks)
    if (!this.valid(bytes)) throw new Error('编辑器完整性校验失败，请重试。')
    await mkdir(this.directory, { recursive: true })
    const temporary = this.file + '.' + randomUUID() + '.tmp'
    try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, this.file) }
    finally { await rm(temporary, { force: true }) }
  }
}
