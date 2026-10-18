import type { HookFailure } from 'claude-code'

// Lower case, without diacritics, ł as l: how two spellings of a word are compared.
const foldText = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase()

export const splitWords = (s: string): string[] => foldText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

export const slugify = (s: string) => splitWords(s).join('-')

export const shortenText = (text: string, room = 40): string => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length <= room ? line : `${line.slice(0, room - 1).trimEnd()}…`
}

export const relativePath = (path: string, root: string): string =>
  path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path

const PLURALS = { idea: 'ideas', comment: 'comments', tag: 'tags', step: 'steps', entry: 'entries' } as const

export const formatCount = (n: number, noun: keyof typeof PLURALS): string => `${n} ${n === 1 ? noun : PLURALS[noun]}`

// A step's length as the toast at the end of a plan gives it: "40 s", "23 min", "1 h 5 min".
export const formatDuration = (ms: number): string => {
  const minutes = Math.round(ms / 60_000)
  if (ms < 60_000) {
    return `${Math.max(1, Math.round(ms / 1000))} s`
  }

  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 > 0 ? ` ${minutes % 60} min` : ''}`
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
