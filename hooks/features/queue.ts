import type { EngineInterface as Engine } from 'claude-code'

import type { Entry } from '../../types'
import type { Context } from '../context'
import { findTags, inOrder } from '../core/entries'
import { listingText, planSection, queueSection, tagsSection } from '../core/listing'
import type { ListingSection } from '../core/listing'
import { popPrompt } from '../core/prompts'
import { formatCount, relativePath, shortenText } from '../core/text'
import { resolveFile, tryReadFile } from '../io/host'
import {
  bringBackTake,
  loadEntries,
  loadHanded,
  loadPlan,
  projectKeys,
  readTrackedFiles,
  refreshBand,
  saveEditing,
  saveEntries,
  saveTake,
  tagId,
  trackFile,
} from '../io/store'
import type { Keys } from '../io/store'

// The <!-- ? --> tags in the session's markdown files, as entries of their own; `onlyNew`
// leaves out those an earlier /aside already handed over.
export async function tagsInFiles($: Engine, onlyNew = false): Promise<Entry[]> {
  const { handed } = await projectKeys($)
  const old = new Set(onlyNew ? await loadHanded($, handed) : [])
  const found: Entry[] = []
  for (const file of await readTrackedFiles($)) {
    const source = await tryReadFile($, file)
    for (const tag of source === undefined ? [] : findTags(source)) {
      const entry: Entry = { text: tag.text, at: 0, kind: tag.kind, file, line: tag.line, isTag: true, ...(tag.quote ? { quote: tag.quote } : {}) }
      if (!old.has(tagId(entry))) found.push(entry)
    }
  }

  return found
}

// What /aside shows: the queue, the tags in files and the plan.
export async function currentListing($: Engine, ctx: Context): Promise<ListingSection[]> {
  const { root, queue, plan: planKey, handed } = await projectKeys($)
  const list = inOrder(await loadEntries($, queue), ctx.settings.order)
  const tags = await tagsInFiles($)
  const handedOver = new Set(await loadHanded($, handed))
  const plan = planSection(await loadPlan($, planKey))

  return [
    queueSection(list, root),
    ...(tags.length > 0 ? [tagsSection(tags, root, tag => handedOver.has(tagId(tag)))] : []),
    ...(plan ? [plan] : []),
  ]
}

// The pane the band's list button opens; register.tsx names the same id in its matcher.
export const LIST_PANE = 'aside'

async function isListPaneOpen($: Engine): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === LIST_PANE)
}

// Opens the list pane unless it is open already; false when the terminal has no room for it.
async function openListPane($: Engine): Promise<boolean> {
  if (await isListPaneOpen($)) {
    return true
  }

  return (await $.ui.open({ id: LIST_PANE, title: 'aside', focus: true, closeOnEscape: true })).isPlaced
}

// Opens the list pane, or closes it when it is open: the band's list button.
export async function toggleListPane($: Engine) {
  if (await isListPaneOpen($)) {
    await $.ui.close({ id: LIST_PANE })
    return
  }
  if (!(await openListPane($))) $.ui.toast('/aside shows the list')
}

// /aside alone. While Claude works, what a command prints shows only once the turn ends, so
// the list opens in the pane, which shows at once and keeps up to date; where the terminal has
// no room for it, the list goes into the transcript as a line, which shows at once too.
export async function showListing($: Engine, ctx: Context): Promise<string> {
  const text = listingText(await currentListing($, ctx))
  if (!ctx.session.isRunning) {
    return text
  }
  if (await openListPane($)) {
    return 'Opened the list in the pane while Claude was working.'
  }
  $.ui.log(text)

  return 'Wrote the list above while Claude was working.'
}

// The queue as /aside shows it: every number a command takes is a place in this list.
async function shownQueue($: Engine, ctx: Context) {
  const keys = await projectKeys($)

  return { keys, list: inOrder(await loadEntries($, keys.queue), ctx.settings.order) }
}

// Stores a list taken from shownQueue back in the order the store keeps, oldest first.
async function saveShownQueue($: Engine, ctx: Context, keys: Keys, list: readonly Entry[]) {
  await saveEntries($, keys.queue, inOrder(list, ctx.settings.order))
}

const isPlace = (n: number, length: number) => Number.isInteger(n) && n >= 1 && n <= length

export async function editEntry($: Engine, ctx: Context, n: number): Promise<string> {
  const { keys, list } = await shownQueue($, ctx)
  if (list.length === 0) {
    return 'The queue is empty.'
  }
  if (!isPlace(n, list.length)) {
    return `Give a number from 1 to ${list.length}, as /aside list shows them.`
  }
  const entry = list[n - 1]!
  const filled = await $.prompt.fill({ text: entry.raw ?? `+ ${entry.text}`, mode: 'insert' })
  if (!filled.isFilled) {
    return 'The prompt box cannot take it now; the entry stays in the queue.'
  }
  list.splice(n - 1, 1)
  await saveShownQueue($, ctx, keys, list)
  await saveEditing($, keys.editing, { index: n - 1, idea: entry })
  await refreshBand($)

  return `Entry ${n} is in the prompt box: change it and press Enter; it goes back to place ${n}, still pointing where it did.`
}

export async function moveEntry($: Engine, ctx: Context, from: number, to: number): Promise<string> {
  const { keys, list } = await shownQueue($, ctx)
  if (list.length < 2) {
    return 'Nothing to move.'
  }
  if (!isPlace(from, list.length) || !isPlace(to, list.length)) {
    return `Give two places from 1 to ${list.length}: /aside move 3 1`
  }
  const [entry] = list.splice(from - 1, 1)
  list.splice(to - 1, 0, entry!)
  await saveShownQueue($, ctx, keys, list)

  return listingText([queueSection(list, keys.root)])
}

// The newest entry, or entry `n`, taken out of the queue into the box, ready to send: no
// "+" in front, a comment with what it is about.
export async function popEntry($: Engine, ctx: Context, n?: number): Promise<string> {
  const { keys, list } = await shownQueue($, ctx)
  if (list.length === 0) {
    return 'The queue is empty.'
  }
  const at = n ?? (ctx.settings.order === 'newest' ? 1 : list.length)
  if (!isPlace(at, list.length)) {
    return `Give a number from 1 to ${list.length}, as /aside shows them.`
  }
  const entry = list[at - 1]!
  const filled = await $.prompt.fill({ text: popPrompt(entry, keys.root), mode: 'insert' })
  if (!filled.isFilled) {
    return 'The prompt box cannot take it now; the entry stays in the queue.'
  }
  list.splice(at - 1, 1)
  await saveShownQueue($, ctx, keys, list)
  await refreshBand($)

  return `In the prompt box, ready to send: ${shortenText(entry.text, 60)}`
}

// Removes the entries at places `numbers`, all of them or none when one is out of range.
export async function removeEntries($: Engine, ctx: Context, numbers: readonly number[]): Promise<string> {
  const { keys, list } = await shownQueue($, ctx)
  if (list.length === 0) {
    return 'The queue is empty.'
  }
  if (!numbers.every(n => isPlace(n, list.length))) {
    return `Give ${numbers.length === 1 ? 'a number' : 'numbers'} from 1 to ${list.length}, as /aside list shows them.`
  }
  const places = new Set(numbers)
  const gone = list.filter((_entry, i) => places.has(i + 1))
  await saveShownQueue($, ctx, keys, list.filter((_entry, i) => !places.has(i + 1)))
  await refreshBand($)

  return gone.length === 1 ? `Removed: ${gone[0]!.text}` : `Removed ${formatCount(gone.length, 'entry')}: ${gone.map(entry => shortenText(entry.text, 40)).join('; ')}`
}

export async function clearQueue($: Engine): Promise<string> {
  const keys = await projectKeys($)
  const stored = await loadEntries($, keys.queue)
  if (stored.length === 0) {
    return 'The queue is already empty.'
  }
  await saveTake($, keys, { entries: stored, tagIds: [], by: 'clear' })
  await saveEntries($, keys.queue, [])
  await refreshBand($)

  return `Cleared ${stored.length} entries. /aside undo brings them back.`
}

// Brings back what plan, run or clear took, unless a step of the plan is running in this
// session, so nothing is done twice.
export async function restoreTaken($: Engine): Promise<string> {
  const keys = await projectKeys($)
  const running = (await loadPlan($, keys.plan)).active
  if (running && running.sessionId === (await $.session.id())) {
    return `Step ${running.step + 1} of the plan is running; /aside stop first, so nothing is done twice.`
  }
  const { entries, tagIds } = await bringBackTake($, keys)
  if (entries.length === 0 && tagIds.length === 0) {
    return 'Nothing to bring back.'
  }
  const now = await refreshBand($, (await tagsInFiles($, true)).length)
  const back = [entries.length > 0 ? formatCount(entries.length, 'entry') : '', tagIds.length > 0 ? formatCount(tagIds.length, 'tag') : '']

  return `Brought back ${back.filter(Boolean).join(' and ')}, ${now.ideas + now.comments + now.tags} waiting.`
}

// Adds a file Claude did not write in this session to the files whose tags /aside reads.
export async function scanFile($: Engine, name: string): Promise<string> {
  if (name === '') {
    return 'Name a file: /aside scan docs/report.md'
  }
  const { root } = await projectKeys($)
  const file = await resolveFile($, name, root, await readTrackedFiles($))
  const source = await tryReadFile($, file)
  if (source === undefined) {
    return `Cannot read ${name}.`
  }
  await trackFile($, file)
  const found = findTags(source).length
  await refreshBand($, (await tagsInFiles($, true)).length)

  return `${relativePath(file, root)}: ${formatCount(found, 'tag')}; /aside includes the file from now on.`
}
