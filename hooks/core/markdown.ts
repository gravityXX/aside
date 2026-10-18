import { slugify, splitWords } from './text'

export const MARKDOWN_PATH = /\.(md|markdown|mdx)$/i

// Fewer words than this are too little evidence to pin a copied fragment anywhere.
export const MIN_FRAGMENT_WORDS = 5

// Which lines sit inside a fenced code block, the fences included: a fence closes only on
// the same character, at least as many times, as CommonMark has it.
export const findFencedLines = (lines: readonly string[]): boolean[] => {
  let open: string | undefined
  return lines.map(text => {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(text)?.[1]
    if (open === undefined) {
      if (fence) open = fence
      return fence !== undefined
    }
    if (fence && fence[0] === open[0] && fence.length >= open.length && /^\s{0,3}[`~]+\s*$/.test(text)) open = undefined
    return true
  })
}

// The text a reader sees of a source line: no quote marks, list numbers, task boxes, link
// targets, HTML tags or comments, which the rendered preview does not copy.
export const visibleText = (line: string) =>
  line
    .replace(/^\s*(?:>\s*)*(?:(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?/, '')
    .replace(/<!--.*?-->/g, ' ')
    .replace(/<(https?:[^<>\s]+)>/g, '$1')
    .replace(/<\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?\/?>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')

type Token = { word: string; line: number }

const tokenize = (source: string): Token[] =>
  source.split(/\r?\n/).flatMap((line, i) => splitWords(visibleText(line)).map(word => ({ word, line: i + 1 })))

// A copied fragment as words, without the list numbers or bullets a preview may copy.
export const fragmentWords = (quote: string): string[] =>
  splitWords(quote.split(/\r?\n/).map(line => line.replace(/^\s*(?:\d{1,9}[.)]|[-*+•·▪◦‣])\s+/, '')).join('\n'))

// The line a fragment copied from the rendered preview starts on, or undefined when the
// file does not hold it. The match runs on words alone. A fragment of five to eight words
// must be there whole; a longer one may differ here and there (a table cell, a footnote),
// but most of its six-word windows must land in one place. Too little evidence pins nothing,
// so a stale clipboard is not attached to an unrelated file.
export const findFragment = (quote: string, source: string): number | undefined => {
  const needle = fragmentWords(quote).slice(0, 60)
  if (needle.length < MIN_FRAGMENT_WORDS) {
    return undefined
  }

  const hay = tokenize(source)
  const at = new Map<string, number[]>()
  hay.forEach((token, i) => {
    const list = at.get(token.word)
    if (list) list.push(i)
    else at.set(token.word, [i])
  })
  const find = (part: readonly string[]) =>
    (at.get(part[0]!) ?? []).find(i => part.every((word, j) => hay[i + j]?.word === word)) ?? -1

  const whole = find(needle)
  if (whole >= 0) {
    return hay[whole]!.line
  }
  if (needle.length < 9) {
    return undefined
  }

  const hits: { start: number; at: number }[] = []
  let windows = 0
  for (let k = 0; k + 6 <= needle.length; k += 3) {
    windows += 1
    const i = find(needle.slice(k, k + 6))
    if (i >= 0) hits.push({ start: i - k, at: i })
  }
  const best = hits
    .map(hit => hits.filter(other => Math.abs(other.start - hit.start) <= 3))
    .sort((a, b) => b.length - a.length)[0]
  if (best === undefined || best.length < Math.max(2, Math.ceil(windows / 2))) {
    return undefined
  }

  return hay[best[0]!.at]!.line
}

// The heading whose slug starts with the one typed after "#", else the first containing it.
export const findHeading = (source: string, wanted: string): { line: number; title: string } | undefined => {
  const target = slugify(wanted)
  const headings: { line: number; title: string }[] = []
  const lines = source.split(/\r?\n/)
  const inFence = findFencedLines(lines)
  lines.forEach((text, i) => {
    const found = inFence[i] ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(text)
    if (found) headings.push({ line: i + 1, title: found[1]! })
  })

  return (
    headings.find(one => slugify(one.title).startsWith(target)) ??
    headings.find(one => slugify(one.title).includes(target))
  )
}
