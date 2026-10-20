import type { Entry, PastRun, Plan } from '../../types'
import { KINDS } from './entries'
import { formatAge, formatCount, formatDuration, relativePath, shortenText } from './text'

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

// A queue of no project, as /aside q NAME shows it: the global list (/aside g), or a named
// queue, for every project or, with isLocal, for this one.
export const namedSection = (name: string, entries: readonly Entry[], isLocal = false): ListingSection => ({
  title: `${formatCount(entries.length, 'idea')} ${name === 'global' ? 'on the global list' : `in @${name}${isLocal ? ", this project's" : ''}`}`,
  rows: entries.map((entry, i) => entryRow(entry, '', String(i + 1))),
})

// How many ideas of each queue /aside q shows; /aside q NAME lists them all.
export const QUEUE_PEEK = 3

// Every queue of no project that holds an idea, as /aside q shows them: a line saying how many,
// then each queue as a section of its own, its name, how many ideas and whom it is for when that
// is worth a word over its first ideas, numbered as /aside q NAME numbers them.
export const queuesSections = (queues: readonly { name: string; ideas: readonly Entry[]; note?: string }[]): ListingSection[] => [
  { title: `${formatCount(queues.length, 'queue')} beside this project's queue`, rows: [] },
  ...queues.map(one => ({
    title: [`${one.name === 'global' ? 'global' : `@${one.name}`} · ${formatCount(one.ideas.length, 'idea')}`, one.note].filter(Boolean).join(', '),
    rows: one.ideas.slice(0, QUEUE_PEEK).map((entry, i) => entryRow(entry, '', String(i + 1))),
  })),
]

// What /aside find found in one list: each entry under the number its list shows it at.
export const foundSection = (title: string, found: readonly { entry: Entry; label: string }[], root: string): ListingSection => ({
  title,
  rows: found.map(({ entry, label }) => entryRow(entry, root, label)),
})

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

// A time as the plan shows it; under a second it is left out, as no step takes so little.
const timeOf = (ms: number | undefined) => (ms !== undefined && ms >= 1000 ? formatDuration(ms) : '')

// What a command lists: its sections and a line under them, or a sentence when there is
// nothing to list.
export type Listed = { sections: ListingSection[]; note?: string } | string

export const listedText = (listed: Listed): string =>
  typeof listed === 'string' ? listed : `${listingText(listed.sections)}${listed.note ? `\n\n${listed.note}` : ''}`

// Whether the step goes on in the background, with no turn of it running: work a turn of it
// started is still going, and the turn its end brings ends the step.
export const isAway = (active: NonNullable<Plan['active']>) => active.isAway === true && active.turnId === undefined

// What a step that goes on in the background waits for, by name.
export const awayWork = (active: NonNullable<Plan['active']>) => [...new Set((active.background ?? []).map(one => one.what))].join(', ')

// Whether the step running is waiting for the person's answer, with no turn of it running:
// Claude asked with the wait tool, and the turn of the person's answer, /aside continue or
// /aside stop ends it.
export const isWaiting = (active: NonNullable<Plan['active']>) => active.pausedFor !== undefined && active.turnId === undefined

// The plan, with what each step done took and said under it, and how long the step running
// or waiting has gone on by `now`, with what the one running does now (`doing`, its turn's
// last tool) or waits for; null with no plan. A plan run to its end stays in the listing until
// the next one takes its place.
export const planSection = (plan: Plan, now: number, doing?: string): ListingSection | null => {
  if (plan.steps.length === 0) {
    return null
  }
  const left = plan.steps.filter(step => !step.isDone).length
  const waiting = plan.active && isWaiting(plan.active) ? plan.active : undefined
  const stateOf = (i: number) => (plan.active?.step === i ? (waiting ? 'waiting' : 'running') : plan.steps[i]!.isDone ? 'done' : 'to do')

  const paused = plan.paused && !plan.active ? plan.paused : undefined
  const toDo = `${left} of ${formatCount(plan.steps.length, 'step')} to do`
  // How long each step done took; the plan's time is theirs together, with how long the step
  // running has gone on: by the clock since it started, or for a step of an earlier release
  // that started with no time kept, the turns it has run so far.
  const active = plan.active
  const sinceStart = active === undefined ? 0 : Math.max(active.ms ?? 0, active.startedAt === undefined ? 0 : now - active.startedAt)
  const ms = plan.steps.reduce((sum, step) => sum + (step.isDone && step.ms ? step.ms : 0), sinceStart)
  const soFar = timeOf(ms) && ` · ${timeOf(ms)} so far`
  // What the step waits for: Claude's question, until a turn took the person's answer to it.
  const waitsFor = waiting && (waiting.isAnswered ? 'answered' : waiting.pausedFor)

  return {
    title:
      left === 0
        ? `Plan done: ${formatCount(plan.steps.length, 'step')}${timeOf(ms) && ` in ${timeOf(ms)}`}`
        : waiting
          ? `Plan waits at step ${waiting.step + 1} (${waitsFor}), ${toDo} (/aside continue)${soFar}`
          : paused
            ? `Plan paused after step ${paused.step + 1} (${paused.reason}), ${toDo} (/aside continue)${soFar}`
            : `Plan: ${toDo} (/aside run)${soFar}`,
    rows: plan.steps.map((step, i) => {
      const going = timeOf(sinceStart)
      // Its time first, then what it did, waits for or does now: the mark and the word beside
      // the title say its state.
      const said = step.isDone
        ? [timeOf(step.ms), step.result ?? '']
        : waiting?.step === i
          ? [going, waiting.result ?? '']
          : active?.step === i && isAway(active)
            ? [going, `in the background${awayWork(active) && `: ${awayWork(active)}`}`]
            : active?.step === i
              ? [going, doing ? `now: ${doing}` : '']
              : []
      const about = said.filter(Boolean).join(' · ')

      return { label: String(i + 1), word: stateOf(i), lines: [step.title], about: about ? [about] : [] }
    }),
  }
}

// A plan in the log, as /aside log numbers it from the one that ended last: how long ago it
// ended, by `now`, and each step done with its time and result, as the plan showed them.
export const runSection = (run: PastRun, n: number, now: number): ListingSection => {
  const ms = run.steps.reduce((sum, step) => sum + (step.ms ?? 0), 0)

  return {
    title: `Run ${n}, ${formatAge(now - run.at)}: ${formatCount(run.steps.length, 'step')}${timeOf(ms) && ` in ${timeOf(ms)}`}`,
    rows: run.steps.map((step, i) => {
      const about = [timeOf(step.ms), step.result ?? ''].filter(Boolean).join(' · ')

      return { label: String(i + 1), word: 'done', lines: [step.title], about: about ? [about] : [] }
    }),
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

// A section's rows in columns, the words as wide as the longest.
const sectionRows = (section: ListingSection): string => {
  const width = Math.max(0, ...section.rows.map(row => row.word.length))

  return section.rows.map(row => formatRow(row, width)).join('\n')
}

export const listingText = (sections: readonly ListingSection[]): string =>
  sections.map(section => (section.rows.length === 0 ? section.title : `${section.title}\n\n${sectionRows(section)}`)).join('\n\n')

// The first line of every file /aside export writes. An earlier export may be written over,
// and a copied fragment is never pinned to one, as what it quotes are copies.
export const EXPORT_MARKER = '<!-- aside export -->'

export const isExportText = (text: string) => text.startsWith(EXPORT_MARKER)

// The listing as /aside export writes it: the marker and when it was made, then each section
// as a heading over its rows in a code block, exactly as /aside shows them. In a code block
// nothing in an entry (HTML, backticks, a tag) is read as Markdown; the fence is longer than
// any run of backticks the rows hold, so none of them closes it.
export const listingMarkdown = (sections: readonly ListingSection[], made: string): string => {
  const heading = (title: string) => `## ${title.replace(/&(?=#?\w+;)/g, '&amp;').replace(/</g, '&lt;')}`
  const block = (section: ListingSection) => {
    const rows = sectionRows(section)
    const fence = '`'.repeat(Math.max(3, ...[...rows.matchAll(/`+/g)].map(run => run[0].length + 1)))

    return ['', `${fence}text`, rows, fence]
  }

  return [
    EXPORT_MARKER,
    '',
    '# aside',
    '',
    `Exported ${made}.`,
    ...sections.flatMap(section => ['', heading(section.title), ...(section.rows.length > 0 ? block(section) : [])]),
    '',
  ].join('\n')
}

const ROW_WORDS = [...Object.values(KINDS).map(kind => kind.label), 'running', 'waiting', 'done', 'to do']
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
