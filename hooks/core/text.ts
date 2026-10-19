import type { HookFailure } from 'claude-code'

// Lower case, without diacritics, ł as l: how two spellings of a word are compared.
export const foldText = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase()

export const splitWords = (s: string): string[] => foldText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

export const slugify = (s: string) => splitWords(s).join('-')

export const shortenText = (text: string, room = 40): string => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length <= room ? line : `${line.slice(0, room - 1).trimEnd()}…`
}

// A Windows path, by its drive ("C:\\x", "c:/x") or a share ("\\\\host\\x", "//host/x").
export const isWindowsPath = (path: string) => /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/.test(path)

// A drive on its own, as in "C:".
const isDrive = (part: string | undefined) => part !== undefined && /^[A-Za-z]:$/.test(part)

// A path with no "." segments, each ".." folded into the folder before it, and no doubled
// slashes but a share's leading two, as the system reads it: "C:/p/./docs//a.md" is "C:/p/docs/a.md".
const tidySegments = (path: string): string => {
  const lead = /^\/\/(?=[^/])/.test(path) ? '//' : path.startsWith('/') ? '/' : ''
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    const last = parts.at(-1)
    if (part !== '..' || (last === undefined && lead === '') || last === '..') parts.push(part)
    else if (last !== undefined && !isDrive(last)) parts.pop()
  }
  const tidy = `${lead}${parts.join('/')}`

  return isDrive(tidy) ? `${tidy}/` : tidy
}

// One spelling of a path, so that a file Claude wrote as "C:\\p\\a.md" and the same file found
// as "C:/p/./a.md" are one file, with one tag list. On every system the segments are tidied
// ("./docs//a.md" is "docs/a.md"); on Windows the slashes go forward and the drive upper case,
// and a name under a Windows root ("docs\\a.md") is spelled the same. A POSIX path keeps its
// backslashes, which may be part of a file name there.
export const canonicalPath = (path: string, root = path): string =>
  isWindowsPath(path) || isWindowsPath(root)
    ? tidySegments(path.replace(/\\/g, '/')).replace(/^[a-z](?=:\/)/, drive => drive.toUpperCase())
    : tidySegments(path)

// What two paths are compared by: their one spelling, in lower case on Windows, whose file
// system takes "Docs\\Report.md" for "docs\\report.md".
export const pathKey = (path: string, root = path): string => {
  const own = canonicalPath(path, root)

  return isWindowsPath(own) || isWindowsPath(root) ? own.toLowerCase() : own
}

// Whether a path canonicalPath spelled starts from a root: "/home/...", "C:/..." or "//host/...".
export const isAbsolutePath = (path: string) => /^(?:[A-Za-z]:)?\//.test(path)

export const relativePath = (path: string, root: string): string => {
  const file = canonicalPath(path, root)
  const dir = canonicalPath(root).replace(/\/$/, '')
  const head = file.slice(0, dir.length + 1)
  const isUnder = isWindowsPath(dir) ? head.toLowerCase() === `${dir}/`.toLowerCase() : head === `${dir}/`

  return isUnder ? file.slice(dir.length + 1) : file
}

const PLURALS = { idea: 'ideas', comment: 'comments', tag: 'tags', step: 'steps', entry: 'entries', queue: 'queues', run: 'runs' } as const

export const formatCount = (n: number, noun: keyof typeof PLURALS): string => `${n} ${n === 1 ? noun : PLURALS[noun]}`

// A step's length as the toast at the end of a plan gives it: "40 s", "23 min", "1 h 5 min".
export const formatDuration = (ms: number): string => {
  const minutes = Math.round(ms / 60_000)
  if (ms < 60_000) {
    return `${Math.max(1, Math.round(ms / 1000))} s`
  }

  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 > 0 ? ` ${minutes % 60} min` : ''}`
}

// How long ago something was, by the clock: "just now", "5 min ago", "3 h ago", "2 days ago".
// No date, which would need the person's time zone.
export const formatAge = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes} min ago`
  }
  const hours = Math.floor(minutes / 60)

  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} ${Math.floor(hours / 24) === 1 ? 'day' : 'days'} ago`
}

// What went wrong, in a few words for the person: the first line of the error's message,
// never a stack.
export const describeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : String((error as { message?: unknown })?.message ?? error)

  // The engine leads its own errors with the plugin and the call ("aside: $.store.set: ..."),
  // which say nothing to the person.
  const line = (message.split('\n')[0] ?? '').replace(/^[\w-]+: \$\.[\w.]+: /, '')

  return shortenText(line, 120) || 'an unknown error'
}

// The same for a hook that failed, as its .catch handler hears it.
export const describeFailure = (failure: HookFailure): string =>
  failure.message === undefined && failure.kind === 'timeout' ? 'it took too long' : describeError(failure.message ?? 'an unknown error')

// How far a plan is, as the line above the prompt shows it: "▰▰▱▱ 2/4", ten marks at most.
export const formatProgress = (done: number, total: number): string => {
  const marks = Math.min(total, 10)
  const filled = total === 0 ? 0 : Math.round((done / total) * marks)

  return `${'▰'.repeat(filled)}${'▱'.repeat(marks - filled)} ${done}/${total}`
}
