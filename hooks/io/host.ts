// The machine outside the store: the clipboard, git, the files and the processes. Everything
// here answers with a value or nothing, never a throw, so no failure reaches the person as a
// stack (4.10).

import { isExportText } from '../core/listing'
import { MARKDOWN_PATH, MIN_FRAGMENT_WORDS } from '../core/markdown'
import { canonicalPath, describeError, isAbsolutePath, pathKey } from '../core/text'
import type { Kit } from '../kit'

// A UTF-8 locale, so grep -P matches letters with \p{L} and ignores case beyond ASCII.
const GREP_ENV = { LC_ALL: 'C.UTF-8' }

export async function tryReadFile($: Kit, path: string): Promise<string | undefined> {
  try {
    // A leading byte-order mark would hide a heading or tag on the first line.
    return (await $.fs.read(path)).replace(/^\uFEFF/, '')
  } catch {
    return undefined
  }
}

// How writing an export went: written, refused as the file there is not an earlier export,
// or failed with the engine's reason.
export type ExportWrite = { isWritten: true } | { isWritten: false; isForeign: true } | { isWritten: false; reason: string }

// Writes an export to `path`, over an earlier export but never over any other file.
export async function writeExport($: Kit, path: string, text: string): Promise<ExportWrite> {
  if ((await $.fs.exists(path).catch(() => false)) && !isExportText((await tryReadFile($, path)) ?? '')) {
    return { isWritten: false, isForeign: true }
  }
  try {
    await $.fs.write(path, text)
    return { isWritten: true }
  } catch (error) {
    return { isWritten: false, reason: describeError(error) }
  }
}

const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw']

// The clipboard readers to try, in order: Windows' own under WSL and on Windows, then macOS,
// Wayland and X11. Each system is tried for every one, since a reader that is not installed
// is refused at once: WSL with no WSL_DISTRO_NAME (an ssh login, a systemd service) still
// reaches powershell.exe.
const CLIPBOARD_READERS: readonly (readonly string[])[] = [
  ['powershell.exe', ...POWERSHELL_ARGS],
  ['pbpaste'],
  ['wl-paste', '--no-newline', '--type', 'text'],
  ['xclip', '-selection', 'clipboard', '-out'],
  ['xsel', '--clipboard', '--output'],
  ['powershell', ...POWERSHELL_ARGS],
]

// The clipboard reader that works here, kept for the rest of the session, and the text the
// last read saw: an unchanged clipboard is likely stale.
export type ClipboardState = { reader?: readonly string[]; last?: string }

// The clipboard's text, '' with nothing to read; undefined when no reader runs here at all.
async function readClipboardText($: Kit, state: ClipboardState): Promise<string | undefined> {
  const candidates = state.reader ? [state.reader] : CLIPBOARD_READERS
  let isFallback = false
  for (const argv of candidates) {
    try {
      const ran = await $.process.run([...argv], { timeoutMs: 5000, stdin: '' })
      // A reader that ran and failed may have no clipboard to reach here (wl-paste with no
      // Wayland, xclip with no display), or only nothing to read this time: the next one is
      // tried, and kept only when no reader before it ran, so the next read asks again.
      if (ran.exitCode !== 0) {
        isFallback = true
        continue
      }
      if (!isFallback) state.reader = argv
      const text = ran.stdout.replace(/\r\n/g, '\n').trim()

      return text.length > 20_000 ? '' : text
    } catch {
      // The engine refuses a reader that is not installed or does not start.
      continue
    }
  }

  return isFallback ? '' : undefined
}

// The clipboard's text, whether it changed since the last read, and whether any reader runs here.
export async function readClipboard($: Kit, state: ClipboardState): Promise<{ text: string; isNew: boolean; hasReader: boolean }> {
  const read = await readClipboardText($, state)
  const text = read ?? ''
  const isNew = text !== state.last
  state.last = text

  return { text, isNew, hasReader: read !== undefined }
}

export async function readGitBranch($: Kit, root: string): Promise<string | undefined> {
  try {
    const ran = await $.process.run(['git', '-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 })
    const name = ran.stdout.trim()

    return ran.exitCode === 0 && name !== '' && name !== 'HEAD' ? name : undefined
  } catch {
    return undefined
  }
}

// The files under `root` that `accept` takes, walked through $.fs: no .git, node_modules or
// other dot folders, and a bound on how much is listed, so a huge tree stays cheap.
async function walkFiles($: Kit, root: string, accept: (path: string, size: number) => boolean, limit = 400): Promise<string[]> {
  const found: string[] = []
  const dirs = [root]
  let listed = 0
  while (dirs.length > 0 && found.length < limit && listed < 20_000) {
    const dir = dirs.shift()!
    let entries: Awaited<ReturnType<Kit['fs']['list']>>
    try {
      entries = await $.fs.list(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      listed += 1
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const path = `${dir.replace(/[\\/]$/, '')}/${entry.name}`
      if (entry.kind === 'dir') dirs.push(path)
      else if (entry.kind === 'file' && accept(path, entry.size)) found.push(path)
    }
  }

  return found
}

// The markdown files under the root holding a few words of the fragment in a row, across
// line breaks and markup. GNU grep with PCRE is the fast way; where it is missing (macOS,
// Windows) the walk through $.fs does the same, more slowly. rg is not used: in a Claude
// Code session it may be a shell function no child process can run.
export async function searchMarkdown($: Kit, quote: string, root: string): Promise<string[]> {
  const raw = quote.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (raw.length < MIN_FRAGMENT_WORDS) {
    return []
  }
  const at = [0, Math.max(0, Math.floor(raw.length / 2) - 2), Math.max(0, raw.length - 4)]
  const parts = [...new Set(at.map(i => raw.slice(i, i + 4).join('[^\\p{L}\\p{N}]+')))]
  const pattern = parts.map(p => `(?:${p})`).join('|')
  try {
    const ran = await $.process.run(
      [
        'grep', '-rlizP', '--include=*.md', '--include=*.markdown', '--include=*.mdx',
        '--exclude-dir=node_modules', '--exclude-dir=.?*', '-e', pattern, root,
      ],
      { timeoutMs: 8000, env: GREP_ENV, stdin: '' },
    )
    // 0: found, 1: nothing found, 2 with hits: found, with a folder it could not read; any
    // other 2 is a grep that cannot do this.
    if (ran.exitCode === 0 || ran.exitCode === 1 || (ran.exitCode === 2 && ran.stdout.trim() !== '')) {
      return ran.stdout.split('\n').filter(Boolean).slice(0, 20)
    }
  } catch {
    // No grep here: walk instead.
  }
  const regex = new RegExp(pattern, 'iu')
  const hits: string[] = []
  for (const file of await walkFiles($, root, (path, size) => MARKDOWN_PATH.test(path) && size <= 2_000_000)) {
    const text = await tryReadFile($, file)
    if (text !== undefined && regex.test(text)) hits.push(file)
    if (hits.length >= 20) break
  }

  return hits
}

// A file named after "@": as written from the root, else a session file ending with it,
// else the first one under the root at that path. `root` and `seen` are spelled as
// canonicalPath spells them, and so is the file found: a session file in its own spelling.
export async function resolveFile($: Kit, name: string, root: string, seen: readonly string[]): Promise<string> {
  const path = canonicalPath(name, root)
  // Absolute as written: "/home/...", or a Windows drive or share, "C:/..." or "//host/...".
  const direct = isAbsolutePath(path) ? path : canonicalPath(`${root}/${path}`)
  const known = seen.find(file => pathKey(file) === pathKey(direct))
  if (known) {
    return known
  }
  if (await $.fs.exists(direct).catch(() => false)) {
    return direct
  }
  const tail = `/${pathKey(path, root)}`
  const own = [...seen].reverse().find(file => pathKey(file).endsWith(tail))
  if (own) {
    return own
  }
  const [first] = await walkFiles($, root, file => pathKey(file).endsWith(tail), 1)

  return first ?? direct
}
