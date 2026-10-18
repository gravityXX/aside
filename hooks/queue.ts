import type { Idea, Kind, Step } from '../types'

// What a queued entry is, read from the character after its "+": "+?" a question,
// "+!" a change, "+-" something to drop, "++" something to dig into, "+" a plain idea.
export const KINDS: Record<Kind, { mark: string; label: string }> = {
  idea: { mark: '+', label: 'idea' },
  question: { mark: '?', label: 'question' },
  change: { mark: '!', label: 'change' },
  drop: { mark: '-', label: 'drop' },
  deeper: { mark: '++', label: 'dig deeper' },
}

const KIND_OF: Record<string, Kind> = { '?': 'question', '!': 'change', '-': 'drop', '+': 'deeper' }

// Where a comment points, as typed after its kind: "@file", "@file:42", "@file#heading" or "#heading".
export type Anchor = { file?: string; line?: number; heading?: string }

export type Entry = { kind: Kind; text: string; anchor: Anchor; raw: string }

const ANCHOR = /^(?:@(?<file>[^\s:#]+)(?::(?<line>\d+)|#(?<fileHeading>[\p{L}\p{N}-]+))?|#(?<heading>[\p{L}\p{N}-]+))(?=\s|$)/u

const entry = (raw: string): Entry | null => {
  const body = raw.trim().slice(1)
  const kind: Kind = KIND_OF[body[0] ?? ''] ?? 'idea'
  let text = (kind === 'idea' ? body : body.slice(1)).trim()
  const anchor: Anchor = {}

  // Only comments carry an anchor: a plain idea keeps its text as typed.
  const found = kind === 'idea' ? null : ANCHOR.exec(text)
  if (found?.groups) {
    const { file, line, fileHeading, heading } = found.groups
    if (file) anchor.file = file
    if (line) anchor.line = Number(line)
    if (fileHeading ?? heading) anchor.heading = (fileHeading ?? heading)!
    text = text.slice(found[0].length).trim()
  }

  const isPinned = anchor.file !== undefined || anchor.heading !== undefined

  return text === '' && (kind === 'idea' || !isPinned) ? null : { kind, text, anchor, raw: raw.trim() }
}

// Which lines sit inside a fenced code block, the fences included: a fence closes only on
// the same character, at least as many times, as CommonMark has it.
export const fenced = (lines: readonly string[]): boolean[] => {
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

// A pasted diff starts with "+" too; it is a prompt, not an idea. An idea followed by
// "- bullet" lines is not a diff: that takes a header, a removed line ("-code" or "-  code")
// or a context line (one space, then text).
export const looksLikeDiff = (text: string): boolean => {
  const all = text.split(/\r?\n/)
  const inFence = fenced(all)
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

// A message that starts with "+" is queued, not sent. When every line starts with "+",
// each line is its own entry; otherwise the whole message is one.
export const capture = (text: string): Entry[] | null => {
  const lines = text.trim().split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length === 0 || !lines[0]!.trim().startsWith('+') || looksLikeDiff(text.trim())) {
    return null
  }

  const isList = lines.every(line => line.trim().startsWith('+'))
  const entries = (isList ? lines : [text.trim()]).map(entry).filter((one): one is Entry => one !== null)

  return entries.length === 0 ? null : entries
}

// --- Finding a copied fragment in a file -----------------------------------------------

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase()

export const words = (s: string): string[] => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

// The words a reader sees in each source line: no quote marks, list numbers, task boxes,
// link targets, HTML tags or comments, which the rendered preview does not copy.
const visible = (line: string) =>
  line
    .replace(/^\s*(?:>\s*)*(?:(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?/, '')
    .replace(/<!--.*?-->/g, ' ')
    .replace(/<(https?:[^<>\s]+)>/g, '$1')
    .replace(/<\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?\/?>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')

type Token = { word: string; line: number }

const tokens = (source: string): Token[] =>
  source.split(/\r?\n/).flatMap((line, i) => words(visible(line)).map(word => ({ word, line: i + 1 })))

// The line a fragment copied from the rendered preview starts on, or undefined when the
// file does not hold it. The match runs on words alone. A fragment of five to eight words
// must be there whole; a longer one may differ here and there (a table cell, a footnote),
// but most of its six-word windows must land in one place. Too little evidence pins nothing,
// so a stale clipboard is not attached to an unrelated file.
// A copied fragment as words, without the list numbers or bullets a preview may copy.
export const quoteWords = (quote: string): string[] =>
  words(quote.split(/\r?\n/).map(line => line.replace(/^\s*(?:\d{1,9}[.)]|[-*+•·▪◦‣])\s+/, '')).join('\n'))

export const locate = (quote: string, source: string): number | undefined => {
  const needle = quoteWords(quote).slice(0, 60)
  if (needle.length < 5) {
    return undefined
  }

  const hay = tokens(source)
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

export const slug = (s: string) => words(s).join('-')

// The heading line whose slug starts with the one typed after "#", else the first containing it.
export const headingLine = (source: string, wanted: string): { line: number; title: string } | undefined => {
  const target = slug(wanted)
  const headings: { line: number; title: string }[] = []
  const lines = source.split(/\r?\n/)
  const inFence = fenced(lines)
  lines.forEach((text, i) => {
    const found = inFence[i] ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(text)
    if (found) headings.push({ line: i + 1, title: found[1]! })
  })

  return (
    headings.find(one => slug(one.title).startsWith(target)) ??
    headings.find(one => slug(one.title).includes(target))
  )
}

// Comments written straight into a file: <!-- ? question -->, <!-- ! change -->,
// <!-- - drop -->, <!-- + dig deeper -->, each with the line it sits on.
export const tags = (source: string): { kind: Kind; text: string; line: number; quote?: string }[] => {
  const found: { kind: Kind; text: string; line: number; quote?: string }[] = []
  const lines = source.split(/\r?\n/)
  // A tag shown in a code block or a `code span` (a README explaining the syntax) is not a
  // comment: both are blanked out, keeping every offset, before the search.
  const inFence = fenced(lines)
  const plain = lines
    .map((text, i) => (inFence[i] ? ' '.repeat(text.length) : text.replace(/(`+)[^`]*?\1/g, span => ' '.repeat(span.length))))
    .join('\n')
  for (const one of plain.matchAll(/<!--\s*([?!+-])\s+([\s\S]*?)\s*-->/g)) {
    const line = plain.slice(0, one.index).split('\n').length
    const near = lines
      .slice(0, line)
      .map((text, i) => (inFence[i] ? '' : visible(text).trim()))
      .reverse()
      .find(text => text !== '')
    found.push({
      kind: KIND_OF[one[1]!]!,
      text: one[2]!.replace(/\s+/g, ' '),
      line,
      ...(near ? { quote: snippet(near, 80) } : {}),
    })
  }

  return found
}

// --- Words for the person and prompts for the model ---------------------------------

export const ideasOf = (n: number): string => (n === 1 ? '1 idea' : `${n} ideas`)

export const commentsOf = (n: number): string => (n === 1 ? '1 comment' : `${n} comments`)

export const snippet = (text: string, room = 40): string => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length <= room ? line : `${line.slice(0, room - 1).trimEnd()}…`
}

export const relative = (path: string, root: string): string =>
  path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path

export const where = (idea: Idea, root: string): string => {
  if (idea.file === undefined) {
    return idea.heading ? `#${idea.heading}` : ''
  }
  const at = idea.line ? `:${idea.line}` : ''

  return `${relative(idea.file, root)}${at}`
}

// One line per entry, as /aside list shows the queue.
// One entry as /aside shows it: its number (or a bullet) and kind in fixed columns, its text,
// and what it is about (file and line, quote, tool output) on an indented line under it.
export const entryLines = (idea: Idea, root: string, label: string, note = ''): string => {
  const head = `${label.padStart(3)}  ${KINDS[idea.kind].label.padEnd(10)}  `
  const indent = ' '.repeat(head.length)
  const text = (idea.text || '(no text)').replace(/\n/g, `\n${indent}`)
  const loose = idea.from === 'terminal' ? ' (from the terminal)' : ' (not in a file)'
  const about = [
    where(idea, root),
    idea.quote ? `"${snippet(idea.quote, 60)}"${idea.isLoose ? loose : ''}` : '',
    idea.output ? `after: ${snippet(idea.output, 50)}` : '',
    note,
  ]
    .filter(Boolean)
    .join('  ')

  return `${head}${text}${about ? `\n${indent}${about}` : ''}`
}

export const listed = (ideas: readonly Idea[], root: string): string =>
  ideas.map((idea, i) => entryLines(idea, root, String(i + 1))).join('\n')

// The line over the list: how many ideas and comments wait.
export const summary = (ideas: readonly Idea[]): string => {
  const plain = ideas.filter(idea => idea.kind === 'idea').length
  const parts = [plain ? ideasOf(plain) : '', ideas.length - plain ? commentsOf(ideas.length - plain) : ''].filter(Boolean)

  return `${parts.join(' and ')} waiting`
}

const MARKER = '(Composed by the aside plugin from my queued notes, not typed by me as a message.)'

const context = (idea: Idea) => {
  const parts = [idea.task ? `while you worked on "${snippet(idea.task, 70)}"` : '', idea.branch ? `branch ${idea.branch}` : '']

  return parts.some(Boolean) ? ` (${parts.filter(Boolean).join(', ')})` : ''
}

// Where a comment stands, in words for the model: line, section, quote, tool output.
const spotOf = (idea: Idea) => {
  const at = [idea.line ? `line ${idea.line}` : '', idea.heading ? `section "${idea.heading}"` : '']
    .filter(Boolean)
    .join(', ')
  const loose = idea.from === 'terminal' ? ' (selected in your reply in the terminal)' : ' (copied by me, not found in the project files)'
  const on = idea.quote ? `on "${snippet(idea.quote, 160)}"${idea.isLoose ? loose : ''}` : ''
  const output = idea.output ? `after this tool output: "${snippet(idea.output, 240)}"` : ''

  return [at, on, output].filter(Boolean).join(', ')
}

// The queue as the model reads it: ideas, then comments grouped by file.
const body = (ideas: readonly Idea[], root: string): string[] => {
  const plain = ideas.map((idea, i) => ({ idea, n: i + 1 })).filter(({ idea }) => idea.kind === 'idea')
  const comments = ideas.map((idea, i) => ({ idea, n: i + 1 })).filter(({ idea }) => idea.kind !== 'idea')
  const files = [...new Set(comments.map(({ idea }) => idea.file ?? ''))]

  const sections: string[] = ['My queue, collected while you were working, oldest first.']
  if (plain.length > 0) {
    sections.push(['Ideas:', ...plain.map(({ idea, n }) => `${n}. ${idea.text.replace(/\n/g, '\n   ')}${context(idea)}`)].join('\n'))
  }
  if (comments.length > 0) {
    const groups = files.map(file => {
      const own = comments.filter(({ idea }) => (idea.file ?? '') === file)
      const head = file === '' ? 'Not tied to a file:' : `${relative(file, root)}:`

      return [
        head,
        ...own.map(({ idea, n }) => {
          const spot = spotOf(idea)
          const tag = idea.isTag ? ' [a <!-- --> tag in the file]' : ''

          return `  ${n}. [${KINDS[idea.kind].label}]${spot ? ` ${spot}` : ''}${tag}: ${idea.text || '(no text)'}`
        }),
      ].join('\n')
    })
    sections.push(['Comments on what you wrote (question, change, drop, dig deeper):', ...groups].join('\n'))
  }

  return sections
}

export const plan = (ideas: readonly Idea[], root: string, pending: readonly Step[] = [], tool = 'mcp__aside__plan'): string => {
  const sections = body(ideas, root)
  if (pending.length > 0) {
    sections.push(
      [
        'The saved plan still has these steps to do. Keep them: merge them with the new items into one plan.',
        ...pending.map((step, i) => `${i + 1}. ${step.title}: ${snippet(step.prompt, 300)}`),
      ].join('\n'),
    )
  }
  sections.push(
    [
      'Organize all of it without doing any of it yet:',
      '- answer the questions right away in this reply, unless an answer needs real work;',
      '- merge related items into one task and keep unrelated ones apart;',
      '- suggest an order (whatever the rest depends on comes first) and say why in a few words;',
      '- for each step, write a prompt I could send you as it is; it must stand on its own, file paths included;',
      '- list items that are already done, contradictory or unclear separately, each with a question;',
      '- when a step handles a comment that is a <!-- --> tag in a file, the step removes that tag.',
      `Then save the steps with the ${tool} tool and stop: I run them with /aside run (all, in order) or /aside run N.`,
    ].join('\n'),
  )
  sections.push(MARKER)

  return sections.join('\n\n')
}

// The queue handed over as it is, to be worked through now, with no plan in between.
export const send = (ideas: readonly Idea[], root: string): string =>
  [
    ...body(ideas, root),
    [
      'Work through all of it now, in this order, in this one reply:',
      '- answer the questions first;',
      '- then the changes, drops and things to dig into, then the ideas;',
      '- when you handle a comment that is a <!-- --> tag in a file, remove that tag;',
      '- if an item is unclear or contradicts another, ask instead of guessing.',
    ].join('\n'),
    MARKER,
  ].join('\n\n')

// One entry as a prompt of its own, for /aside each: what it says and what it is about.
export const entryPrompt = (idea: Idea, root: string, withContext = true): string => {
  const file = idea.file ? `In ${relative(idea.file, root)}: ` : ''
  const spot = spotOf(idea)
  const kind = idea.kind === 'idea' ? '' : `${KINDS[idea.kind].label[0]!.toUpperCase()}${KINDS[idea.kind].label.slice(1)}`
  const head = [kind, file + spot].filter(Boolean).join(' - ')
  const tag = idea.isTag ? '\n\nThis comment is a <!-- --> tag in the file; remove the tag once it is handled.' : ''

  return `${head ? `${head}:\n` : ''}${idea.text || '(no text)'}${withContext ? context(idea) : ''}${tag}`
}

// An entry as a prompt to send right away (/aside pop): an idea as typed, without its "+";
// a comment with what it is about.
export const popText = (idea: Idea, root: string): string =>
  idea.kind === 'idea' ? idea.text : entryPrompt(idea, root, false)

export const stepPrompt = (step: Step, n: number, total: number): string =>
  `${step.prompt}\n\n(Step ${n} of ${total} of the queue plan, "${step.title}", sent by the aside plugin.)`
