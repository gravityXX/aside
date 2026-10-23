// /aside import and /aside scan: a markdown file becoming entries or tags, leaving the file as
// it is.

import type { EngineInterface as Engine } from 'claude-code'

import type { Entry, Kind } from '../../types'
import { KINDS, parseEntries } from '../core/entries'
import { describeCount, isExportText } from '../core/listing'
import { listItems } from '../core/markdown'
import { formatCount, newQueueNote, relativePath } from '../core/text'
import { resolveFile, tryReadFile } from '../io/host'
import { changeQueue } from '../io/queue'
import { projectKeys, readTrackedFiles, refreshBand } from '../io/store'
import { GLOBAL, addIdeas, isLocalQueue, loadIdeas, queueName } from '../io/queues'

// How many list items one /aside import takes, so a long file is not queued by mistake.
const MOST_ITEMS = 100

// An entry as it would have been typed, for /aside edit: "+ idea", "+? question", "++ deeper".
const typedMark = (kind: Kind) => (kind === 'idea' || kind === 'deeper' ? KINDS[kind].mark : `+${KINDS[kind].mark}`)

type Item = { kind: Kind; text: string }

// An item whose lines, typed back with /aside edit, would read as something else ("+ a\n-v\n-q"
// as a diff for Claude) has them joined into one line, so it comes back as it went.
const asTyped = ({ kind, text }: Item): Item => {
  const back = parseEntries(`${typedMark(kind)} ${text}`)
  const isSame = back?.length === 1 && back[0]!.kind === kind && back[0]!.text === text && back[0]!.list === undefined

  return isSame || !text.includes('\n') ? { kind, text } : { kind, text: text.split('\n').join('; ') }
}

const isSame = (item: Item) => (one: Item) => one.kind === item.kind && one.text === item.text

// The items of `items` that are not in `there` already, nor earlier in `items`: an import made
// again adds nothing twice.
const freshItems = (items: readonly Item[], there: readonly Item[]) => items.filter((item, i) => !there.some(isSame(item)) && items.findIndex(isSame(item)) === i)

// What an import of `items` left out besides ticked ones: those `there` holds already, and those
// repeated in the file, as a sentence's parts.
const leftOutParts = (items: readonly Item[], there: readonly Item[], fresh: number, where: string) => {
  const inThere = items.filter(item => there.some(isSame(item))).length
  const repeated = items.length - fresh - inThere

  return [inThere > 0 ? `${inThere} already ${where}` : '', repeated > 0 ? `${repeated} repeated in the file` : '']
}

// What an import left out, as a sentence's end: items already there, ticked ones, comments.
const leftOut = (parts: readonly string[]) => (parts.some(Boolean) ? ` Left out: ${parts.filter(Boolean).join(', ')}.` : '')

// /aside import FILE, or /aside g import FILE and /aside q NAME import FILE with `queue`: the items
// of a markdown list in the file become entries at the end of that queue, the file as it was.
export async function importFile($: Engine, name: string, queue?: string): Promise<string> {
  const { root } = await projectKeys($)
  const file = await resolveFile($, name, root, await readTrackedFiles($))
  const shown = relativePath(file, root)
  const source = await tryReadFile($, file)
  if (source === undefined) {
    return `Cannot read ${name}.`
  }
  if (isExportText(source)) {
    return `${shown} is an aside export; /aside import takes a list of your own.`
  }
  const listed = listItems(source)
  const items = listed.items.map(asTyped)
  const checked = listed.checked
  const ticked = checked > 0 ? `${checked} ticked` : ''
  if (items.length === 0) {
    return `${shown} holds no list items to import.${leftOut([ticked])}`
  }
  if (items.length > MOST_ITEMS) {
    return `${shown} holds ${items.length} list items; /aside import takes ${MOST_ITEMS} at most.`
  }

  return queue === undefined ? importHere($, shown, items, ticked) : importInto($, queue, shown, items, ticked)
}

// Into this project's queue, as one change on it, as typed entries are, so neither writes over
// the other; read and written in one go, so a failure leaves the queue as it was.
async function importHere($: Engine, shown: string, items: readonly Item[], ticked: string): Promise<string> {
  const { added, waiting, parts } = await changeQueue($, async stored => {
    const now = await $.clock.now()
    const added: Entry[] = freshItems(items, stored).map(({ kind, text }) => ({ text, raw: `${typedMark(kind)} ${text}`, at: now, kind }))

    return {
      ...(added.length > 0 ? { list: [...stored, ...added] } : {}),
      value: { added, waiting: stored.length + added.length, parts: leftOutParts(items, stored, added.length, 'in the queue') },
    }
  })
  await refreshBand($)

  return added.length === 0
    ? `Nothing new in ${shown}: its items are in the queue already.${leftOut([...parts.slice(1), ticked])}`
    : `Imported ${describeCount(added)} from ${shown}, ${waiting} waiting.${leftOut([...parts, ticked])}`
}

// Into a queue of no project, which holds ideas only: each a key of its own, all of them or none.
async function importInto($: Engine, queue: string, shown: string, items: readonly Item[], ticked: string): Promise<string> {
  const ideas = items.filter(item => item.kind === 'idea')
  const comments = items.length - ideas.length
  const there = (await loadIdeas($, queue)).map(idea => ({ kind: 'idea' as const, text: idea.entry.text }))
  const fresh = freshItems(ideas, there)
  const now = await $.clock.now()
  await addIdeas($, queue, fresh.map(({ text }) => ({ text, at: now, kind: 'idea' as const })))
  await refreshBand($)
  const where = queue === GLOBAL ? 'the global list' : `@${queueName(queue)}`
  const count = there.length + fresh.length
  const parts = leftOutParts(ideas, there, fresh.length, 'there')
  const notIdeas = comments > 0 ? `${formatCount(comments, 'comment')}, as ${where} holds ideas only` : ''
  if (fresh.length === 0) {
    return `Nothing new in ${shown} for ${where}.${leftOut([...parts, notIdeas, ticked])}`
  }

  const tally = queue === GLOBAL ? `${count} global` : there.length === 0 ? newQueueNote(queueName(queue), isLocalQueue(queue)) : `${count} in @${queueName(queue)}`

  return `Imported ${formatCount(fresh.length, 'idea')} from ${shown} to ${where} (${tally}).${leftOut([...parts, notIdeas, ticked])}`
}
