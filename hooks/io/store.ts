import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { Band, Entry, Plan } from '../../types'

const EMPTY_BAND: Band = { ideas: 0, comments: 0, tags: 0, steps: 0, done: 0 }

// What the line above the prompt shows, kept up to date by refreshBand.
const band = atom({ plugin: 'aside', key: 'band' } as const, EMPTY_BAND)

// The markdown files /aside reads tags from, newest last: those written or edited in this
// session, agents' included, and those /aside scan added.
const trackedFiles = atom({ plugin: 'aside', key: 'files' } as const, [])

// The atoms are read here, where they are made: the engine reads only an atom of the reading file.
// A drawing that reads one through these is drawn again when it changes.
export function readBand($: Engine): Promise<Band> {
  return read($, band)
}

export function readTrackedFiles($: Engine): Promise<string[]> {
  return read($, trackedFiles)
}

export function trackFile($: Engine, path: string) {
  return update($, trackedFiles, list => [...list.filter(file => file !== path), path].slice(-100))
}

// Everything belongs to the project: each root keeps its own queue and plan.
export type Keys = {
  root: string
  queue: string
  taken: string
  takenTags: string
  takenBy: string
  plan: string
  handed: string
  editing: string
}

export async function projectKeys($: Engine): Promise<Keys> {
  const root = await $.session.root()

  return {
    root,
    queue: `queue:${root}`,
    taken: `taken:${root}`,
    takenTags: `takenTags:${root}`,
    takenBy: `takenBy:${root}`,
    plan: `plan:${root}`,
    handed: `handed:${root}`,
    editing: `editing:${root}`,
  }
}

export async function loadEntries($: Engine, key: string): Promise<Entry[]> {
  const value = await $.store.get(key)

  return Array.isArray(value) ? (value as Entry[]).map(entry => ({ ...entry, kind: entry.kind ?? 'idea' })) : []
}

export async function saveEntries($: Engine, key: string, list: readonly Entry[]) {
  if (list.length === 0) {
    await $.store.delete(key)
  } else {
    await $.store.set(key, list)
  }
}

export async function loadPlan($: Engine, key: string): Promise<Plan> {
  const value = (await $.store.get(key)) as Plan | undefined

  return value && Array.isArray(value.steps) ? value : { steps: [] }
}

export async function savePlan($: Engine, key: string, plan: Plan) {
  if (plan.steps.length === 0) {
    await $.store.delete(key)
  } else {
    await $.store.set(key, plan)
  }
}

// A tag is known by its file and text: lines move as the file is edited.
export const tagId = (tag: Entry) => `${tag.file}\u0000${tag.text}`

// The tags an earlier /aside already handed over, by tagId.
export async function loadHanded($: Engine, key: string): Promise<string[]> {
  return ((await $.store.get(key)) as string[] | undefined) ?? []
}

// An entry taken out with /aside edit, and the place it goes back to. The field keeps the
// name `idea` that stored records already have.
export type Editing = { index: number; idea: Entry }

export function saveEditing($: Engine, key: string, editing: Editing) {
  return $.store.set(key, editing)
}

// The entry being edited, if any. The next message that is stored takes it (forgetEditing),
// so a message that fails to store leaves it for the one after.
export async function loadEditing($: Engine, key: string): Promise<Editing | undefined> {
  return (await $.store.get(key)) as Editing | undefined
}

export function forgetEditing($: Engine, key: string) {
  return $.store.delete(key)
}

// What /aside undo brings back: the entries and the tags the last plan, run or clear took.
// Each take replaces the one before it. A hand-over's take lasts until Claude has answered
// it (forgetAnsweredTake); a clear's lasts until the next take.
export type Take = { entries: Entry[]; tagIds: string[]; by: 'hand-over' | 'clear' }

export async function saveTake($: Engine, keys: Keys, take: Take) {
  await saveEntries($, keys.taken, take.entries)
  if (take.tagIds.length === 0) {
    await $.store.delete(keys.takenTags)
  } else {
    await $.store.set(keys.takenTags, take.tagIds)
  }
  await $.store.set(keys.takenBy, take.by)
}

// A take stored before takenBy existed counts as a clear's: it stays until the next take.
export async function loadTake($: Engine, keys: Keys): Promise<Take> {
  const tagIds = ((await $.store.get(keys.takenTags)) as string[] | undefined) ?? []
  const by = (await $.store.get(keys.takenBy)) === 'hand-over' ? 'hand-over' : 'clear'

  return { entries: await loadEntries($, keys.taken), tagIds, by }
}

export async function forgetTake($: Engine, keys: Keys) {
  await saveEntries($, keys.taken, [])
  await $.store.delete(keys.takenTags)
  await $.store.delete(keys.takenBy)
}

// Once Claude has answered what was handed over, it is done: undo must not bring it back.
export async function forgetAnsweredTake($: Engine, keys: Keys) {
  if ((await $.store.get(keys.takenBy)) === 'hand-over') {
    await forgetTake($, keys)
  }
}

// Puts back all the last take took: its entries at the head of the queue, its tags in their
// files for the next hand-over. Returns what it put back.
export async function bringBackTake($: Engine, keys: Keys): Promise<Take> {
  const take = await loadTake($, keys)
  await saveEntries($, keys.queue, [...take.entries, ...(await loadEntries($, keys.queue))])
  await unhandTags($, keys, take.tagIds)
  await forgetTake($, keys)

  return take
}

// Puts back some of what a hand-over took (`items`, entries and tags alike) and leaves them
// out of the take, so /aside undo never brings them back a second time.
export async function giveBackItems($: Engine, keys: Keys, items: readonly Entry[]) {
  const isItem = (entry: Entry) => items.some(item => item.at === entry.at && item.text === entry.text)
  const tagIds = items.filter(item => item.isTag).map(tagId)
  const take = await loadTake($, keys)
  const queue = await loadEntries($, keys.queue)
  // A call made again after one that failed half-way finds some already back.
  const back = take.entries.filter(entry => isItem(entry) && !queue.some(one => one.at === entry.at && one.text === entry.text))
  await saveEntries($, keys.queue, [...back, ...queue])
  await unhandTags($, keys, tagIds)
  await saveTake($, keys, { ...take, entries: take.entries.filter(entry => !isItem(entry)), tagIds: take.tagIds.filter(id => !tagIds.includes(id)) })
}

// Unmarks tags handed over, so the next hand-over takes them again.
export async function unhandTags($: Engine, keys: Keys, tagIds: readonly string[]) {
  const handed = await loadHanded($, keys.handed)
  await $.store.set(keys.handed, handed.filter(id => !tagIds.includes(id)))
}

// Takes the entries `chosen` out of the queue to hand them over; the rest stay. /aside undo
// brings the chosen back until Claude has answered them.
export async function takeChosen($: Engine, keys: Keys, stored: readonly Entry[], chosen: readonly Entry[]) {
  const previous = await loadTake($, keys)
  try {
    await saveTake($, keys, { entries: [...chosen], tagIds: [], by: 'hand-over' })
    await saveEntries($, keys.queue, stored.filter(entry => !chosen.includes(entry)))
  } catch (error) {
    // The chosen entries are still in the queue: undo brings back what it did before, not them.
    await saveTake($, keys, previous).catch(() => undefined)
    throw error
  }
}

// Takes the queue (`stored`, oldest first) and the new tags out to hand them over: both go
// where /aside undo finds them, and the tags are marked so they are not handed over again.
// `giveBack` undoes all of it when the hand-over fails. A take that fails half-way is undone
// at once, before its error goes on: the queue as it was, and the take undo had before, so
// nothing is left both in the queue and in the take, and nothing undo had is lost.
export async function takeForHandOver($: Engine, keys: Keys, stored: readonly Entry[], tags: readonly Entry[]) {
  const before = await loadHanded($, keys.handed)
  const previous = await loadTake($, keys)
  let isQueueTaken = false
  const giveBack = async () => {
    if (isQueueTaken) await saveEntries($, keys.queue, [...stored, ...(await loadEntries($, keys.queue))])
    await $.store.set(keys.handed, before)
    await forgetTake($, keys)
  }
  try {
    await saveTake($, keys, { entries: [...stored], tagIds: tags.map(tagId), by: 'hand-over' })
    if (stored.length > 0) {
      await saveEntries($, keys.queue, [])
      isQueueTaken = true
    }
    await $.store.set(keys.handed, [...new Set([...before, ...tags.map(tagId)])].slice(-500))
  } catch (error) {
    // The handed write comes last: when anything failed, it was never made.
    if (isQueueTaken) await saveEntries($, keys.queue, [...stored, ...(await loadEntries($, keys.queue))]).catch(() => undefined)
    await saveTake($, keys, previous).catch(() => undefined)
    throw error
  }

  return { giveBack }
}

// Counts what waits and where the plan is, for the line above the prompt. The tags are
// counted only when `tagCount` is given, since that takes reading the files.
export async function refreshBand($: Engine, tagCount?: number): Promise<Band> {
  const keys = await projectKeys($)
  const list = await loadEntries($, keys.queue)
  const plan = await loadPlan($, keys.plan)
  const ideas = list.filter(entry => entry.kind === 'idea').length
  const next: Band = {
    ideas,
    comments: list.length - ideas,
    tags: tagCount ?? (await read($, band)).tags,
    steps: plan.steps.length,
    done: plan.steps.filter(step => step.isDone).length,
    ...(plan.active ? { running: plan.active.step + 1 } : {}),
    ...(plan.paused && !plan.active ? { paused: plan.paused.step + 1 } : {}),
  }
  await update($, band, () => next)

  return next
}
