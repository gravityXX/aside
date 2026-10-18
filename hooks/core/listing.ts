import type { Entry, Plan } from '../../types'
import { KINDS } from './entries'
import { formatCount, relativePath, shortenText } from './text'

// The /aside listing as data: sections of a title and rows, each row a number (or a
// bullet), a kind or a step's state, its lines of text and what it is about.
export type ListingRow = { label: string; word: string; lines: string[]; about: string[] }
export type ListingSection = { title: string; rows: ListingRow[] }

// Where an entry points, as /aside shows it: "docs/report.md:42", or "#heading" alone.
export const formatPlace = (entry: Entry, root: string): string => {
  if (entry.file === undefined) {
    return entry.heading ? `#${entry.heading}` : ''
  }
  const at = entry.line ? `:${entry.line}` : ''

  return `${relativePath(entry.file, root)}${at}`
}

// What an entry is about, place first: "docs/report.md:42 · "the quote" · after Bash".
const describeAbout = (entry: Entry, root: string, note: string): string => {
  const loose = entry.from === 'terminal' ? 'terminal' : 'not in a file'
  // A tool output reads "Bash failed: exit 1": the tool, then what it said.
  const [tool, ...said] = (entry.output ?? '').split(': ')

  return [
    formatPlace(entry, root) || (entry.quote && entry.isLoose ? loose : ''),
    entry.quote ? `"${shortenText(entry.quote, 60)}"` : '',
    entry.output ? `after ${tool}` : '',
    entry.output && said.length > 0 ? shortenText(said.join(': '), 50) : '',
    note,
  ]
    .filter(Boolean)
    .join(' · ')
}

const entryRow = (entry: Entry, root: string, label: string, note = ''): ListingRow => {
  const about = describeAbout(entry, root, note)

  return { label, word: KINDS[entry.kind].label, lines: (entry.text || '(no text)').split('\n'), about: about ? [about] : [] }
}

// "2 ideas and 1 comment": the queue's size in words.
export const describeCount = (entries: readonly Entry[]): string => {
  const ideas = entries.filter(entry => entry.kind === 'idea').length
  const comments = entries.length - ideas

  return [ideas ? formatCount(ideas, 'idea') : '', comments ? formatCount(comments, 'comment') : ''].filter(Boolean).join(' and ')
}

const summarizeQueue = (entries: readonly Entry[]): string => `${describeCount(entries)} waiting`

export const queueSection = (entries: readonly Entry[], root: string): ListingSection =>
  entries.length === 0
    ? { title: 'The queue is empty.', rows: [] }
    : { title: summarizeQueue(entries), rows: entries.map((entry, i) => entryRow(entry, root, String(i + 1))) }

// The tags in files, each marked once an earlier /aside handed it over.
export const tagsSection = (tags: readonly Entry[], root: string, isHandedOver: (tag: Entry) => boolean): ListingSection => ({
  title: 'Tags in files',
  rows: tags.map(tag => entryRow(tag, root, '·', isHandedOver(tag) ? 'handed over' : '')),
})

// What Claude left out of the plan it saved, back in the queue: each item with its question.
export const leftOutSection = (left: readonly { entry: Entry; question: string }[], root: string): ListingSection => ({
  title: 'Not in the plan, back in the queue',
  rows: left.map(({ entry, question }) => {
    const row = entryRow(entry, root, '·')

    return { ...row, about: [...row.about, shortenText(question, 200)] }
  }),
})

// The plan while it has steps to do, null once every step is done.
export const planSection = (plan: Plan): ListingSection | null => {
  const left = plan.steps.filter(step => !step.isDone).length
  if (left === 0) {
    return null
  }
  const stateOf = (i: number) => (plan.active?.step === i ? 'running' : plan.steps[i]!.isDone ? 'done' : 'to do')

  return {
    title: `Plan: ${left} of ${formatCount(plan.steps.length, 'step')} to do (/aside run)`,
    rows: plan.steps.map((step, i) => ({ label: String(i + 1), word: stateOf(i), lines: [step.title], about: [] })),
  }
}

// One row in columns: the label, then the word as wide as the longest in its section, then
// the text, with each further line and what it is about under the text's first character.
const formatRow = (row: ListingRow, width: number): string => {
  const head = `${row.label.padStart(3)}  ${row.word.padEnd(width)}  `
  const indent = ' '.repeat(head.length)
  const about = row.about.map(line => `\n${indent}↳ ${line}`).join('')

  return `${head}${row.lines.join(`\n${indent}`)}${about}`
}

export const listingText = (sections: readonly ListingSection[]): string =>
  sections
    .map(section => {
      const width = Math.max(0, ...section.rows.map(row => row.word.length))

      return section.rows.length === 0 ? section.title : `${section.title}\n\n${section.rows.map(row => formatRow(row, width)).join('\n')}`
    })
    .join('\n\n')

const ROW_WORDS = [...Object.values(KINDS).map(kind => kind.label), 'running', 'done', 'to do']
const ROW_PATTERN = new RegExp(`^ {0,2}(\\d+|·)  (${ROW_WORDS.join('|')}) {2,}(\\S.*)$`)

// A listing read back from the text /aside printed, so the transcript can draw it in colour.
// Null for any other text, which is drawn as it is.
export const parseListingText = (text: string): ListingSection[] | null => {
  const sections: ListingSection[] = []
  for (const line of text.split('\n')) {
    const found = ROW_PATTERN.exec(line)
    const section = sections.at(-1)
    const row = section?.rows.at(-1)
    if (line.trim() === '') continue
    if (found) {
      if (section === undefined) return null
      section.rows.push({ label: found[1]!, word: found[2]!, lines: [found[3]!], about: [] })
    } else if (!line.startsWith(' ')) {
      sections.push({ title: line, rows: [] })
    } else if (row === undefined) {
      return null
    } else if (line.trim().startsWith('↳ ')) {
      row.about.push(line.trim().slice(2))
    } else {
      row.lines.push(line.trim())
    }
  }

  return sections.some(section => section.rows.length > 0) ? sections : null
}
