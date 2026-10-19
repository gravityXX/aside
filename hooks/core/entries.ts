import type { Entry, Kind } from '../../types'
import { findFencedLines, visibleText } from './markdown'
import { shortenText } from './text'

// Each kind with the mark it is typed with and the word /aside shows for it.
export const KINDS: Record<Kind, { mark: string; label: string }> = {
  idea: { mark: '+', label: 'idea' },
  question: { mark: '?', label: 'question' },
  change: { mark: '!', label: 'change' },
  drop: { mark: '-', label: 'drop' },
  deeper: { mark: '++', label: 'dig deeper' },
}

// A comment's kind by the character after its "+", which is also the one inside a tag:
// "+?" and <!-- ? -->. A plain "+" is an idea.
const KIND_BY_MARK: Record<string, Kind> = { '?': 'question', '!': 'change', '-': 'drop', '+': 'deeper' }

// Where a comment points, as typed after its kind: "@file", "@file:42", "@file#heading" or "#heading".
export type Anchor = { file?: string; line?: number; heading?: string }

// An entry as typed, before it is pinned and stored.
// `isGlobal`: typed as "+g idea", for the global list rather than this project's queue.
export type TypedEntry = { kind: Kind; text: string; anchor: Anchor; raw: string; isGlobal?: true }

const ANCHOR_PATTERN = /^(?:@(?<file>(?:[A-Za-z]:(?=[\\/]))?[^\s:#]+)(?::(?<line>\d+)|#(?<fileHeading>[\p{L}\p{N}-]+))?|#(?<heading>[\p{L}\p{N}-]+))(?=\s|$)/u

const parseEntry = (raw: string): TypedEntry | null => {
  const body = raw.trim().slice(1)
  // "+g idea" is an idea for the global list; "+go home" is an idea that starts with "go".
  if (/^g(?=\s|$)/.test(body)) {
    const text = body.slice(1).trim()
    return text === '' ? null : { kind: 'idea', text, anchor: {}, raw: raw.trim(), isGlobal: true }
  }
  const kind: Kind = KIND_BY_MARK[body[0] ?? ''] ?? 'idea'
  let text = (kind === 'idea' ? body : body.slice(1)).trim()
  const anchor: Anchor = {}

  // Only comments carry an anchor: a plain idea keeps its text as typed.
  const found = kind === 'idea' ? null : ANCHOR_PATTERN.exec(text)
  if (found?.groups) {
    const { file, line, fileHeading, heading } = found.groups
    if (file) anchor.file = file
    if (line) anchor.line = Number(line)
    const named = fileHeading ?? heading
    if (named) anchor.heading = named
    text = text.slice(found[0].length).trim()
  }

  const isPinned = anchor.file !== undefined || anchor.heading !== undefined

  return text === '' && (kind === 'idea' || !isPinned) ? null : { kind, text, anchor, raw: raw.trim() }
}

// A pasted diff starts with "+" too; it is a prompt, not an idea. An idea followed by
// "- bullet" lines is not a diff: that takes a header, a removed line ("-code" or "-  code")
// or a context line (one space, then text).
const looksLikeDiff = (text: string): boolean => {
  const all = text.split(/\r?\n/)
  const inFence = findFencedLines(all)
  const lines = all.filter((line, i) => !inFence[i] && line !== '')
  const isHeader = (line: string) =>
    /^(diff --git |\+\+\+ (a\/|b\/|\/)|--- (a\/|b\/|\/)|@@ -\d+(,\d+)? \+\d+(,\d+)? @@)/.test(line)
  if (lines.some(isHeader)) {
    return true
  }

  return (
    lines.length >= 3 &&
    lines.every(line => /^[+\- ]/.test(line)) &&
    lines.some(line => /^-(?! \S)/.test(line) || /^ \S/.test(line))
  )
}

// A draft already typed goes to the queue too when it ends with a mark after a space or a
// line break: "why is this so slow +?" is "+? why is this so slow", "read it later +g" an idea
// for the global list. "C++" is not.
const parseTrailingMark = (text: string): TypedEntry | null => {
  const end = /\s(\+(?:[?!+-]|g)?)$/.exec(text)
  if (!end) {
    return null
  }
  const body = text.slice(0, end.index).trim()

  return body === '' ? null : parseEntry(`${end[1]} ${body}`)
}

// A message that starts with "+" is queued, not sent. When every line starts with "+",
// each line is its own entry; otherwise the whole message is one.
export const parseEntries = (text: string): TypedEntry[] | null => {
  const typed = text.trim()
  const lines = typed.split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length === 0 || looksLikeDiff(typed)) {
    return null
  }
  if (!lines[0]!.trim().startsWith('+')) {
    const one = parseTrailingMark(typed)

    return one === null ? null : [one]
  }

  const isList = lines.every(line => line.trim().startsWith('+'))
  const entries = (isList ? lines : [typed]).map(parseEntry).filter((one): one is TypedEntry => one !== null)

  return entries.length === 0 ? null : entries
}

// A comment written straight into a markdown file, with the line it sits on and the text
// above it: <!-- ? question -->, <!-- ! change -->, <!-- - drop -->, <!-- + dig deeper -->.
export type FileTag = { kind: Kind; text: string; line: number; quote?: string }

export const findTags = (source: string): FileTag[] => {
  const found: FileTag[] = []
  const lines = source.split(/\r?\n/)
  // A tag shown in a code block or a `code span` (a README explaining the syntax) is not a
  // comment: both are blanked out, keeping every offset, before the search.
  const inFence = findFencedLines(lines)
  const plain = lines
    .map((text, i) => (inFence[i] ? ' '.repeat(text.length) : text.replace(/(`+)[^`]*?\1/g, span => ' '.repeat(span.length))))
    .join('\n')
  for (const one of plain.matchAll(/<!--\s*([?!+-])\s+([\s\S]*?)\s*-->/g)) {
    const line = plain.slice(0, one.index).split('\n').length
    const near = lines
      .slice(0, line)
      .map((text, i) => (inFence[i] ? '' : visibleText(text).trim()))
      .reverse()
      .find(text => text !== '')
    found.push({
      kind: KIND_BY_MARK[one[1]!]!,
      text: one[2]!.replace(/\s+/g, ' '),
      line,
      ...(near ? { quote: shortenText(near, 80) } : {}),
    })
  }

  return found
}

// Which entry comes first, from the order setting. The store keeps the oldest first either
// way, so the setting can change at any time; only what /aside shows, numbers and runs follows it.
export type Order = 'oldest' | 'newest'

export const inOrder = (list: readonly Entry[], order: Order): Entry[] => (order === 'newest' ? [...list].reverse() : [...list])
