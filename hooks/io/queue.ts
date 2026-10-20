import type { EngineInterface as Engine } from 'claude-code'

import type { Entry } from '../../types'
import { isSameEntry, withoutEntries } from '../core/entries'
import { loadEntries, loadHanded, loadTagIds, projectKeys, saveEntries, tagId } from './store'
import type { Keys } from './store'

// What a change makes of the stored queue: the list to store in its place, left out to keep
// the queue as it is, and the value the caller asked for. `afterSave` writes what goes with the
// queue once it is stored, before the next change reads anything: the record of an entry back
// from /aside edit, which a message sent right after must not find there still.
export type QueueChange<T> = { list?: readonly Entry[]; value: T; afterSave?: () => Promise<unknown> }

// The changes to this project's queue, one after another, so two that overlap never store over
// each other (2.9): typed entries, their tidied text, imports. A module variable lives as long as
// `ctx` does, and a reload starts both over (3.7), as it does the work that asked for them.
let changes: Promise<unknown> = Promise.resolve()

// Changes the queue as it is stored once every change asked for before has landed, and
// resolves once this one has too, so what is read next holds it. A failure reaches the caller
// and leaves the changes after it to run. A change never waits for another one, which would
// wait for it.
export function changeQueue<T>($: Engine, change: (stored: readonly Entry[]) => QueueChange<T> | Promise<QueueChange<T>>): Promise<T> {
  return changeQueueAfter($, async () => undefined, stored => change(stored))
}

// Changes the queue as changeQueue does, after `prepare`, which takes this change's place in
// the chain but runs before the queue is read: slow work, such as a process or the clipboard,
// that must keep the order the changes were asked in. Read before it, the stored list would be
// held across its waits, and a command that writes the queue outside the chain meanwhile (rm,
// a hand-over) would be stored over. What it makes is handed to the change.
export function changeQueueAfter<P, T>(
  $: Engine,
  prepare: () => Promise<P>,
  change: (stored: readonly Entry[], prepared: P) => QueueChange<T> | Promise<QueueChange<T>>,
): Promise<T> {
  const done = changes.then(async () => {
    const { queue } = await projectKeys($)
    const prepared = await prepare()
    const { list, value, afterSave } = await change(await loadEntries($, queue), prepared)
    if (list !== undefined) await saveEntries($, queue, list)
    await afterSave?.()

    return value
  })
  changes = done.catch(() => undefined)

  return done
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
  const tagIds = await loadTagIds($, keys.takenTags)
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

// Takes what a plan saved outside the conversation holds out of the queue: its entries, and
// its tags as handed over, the tags first, so a failed write leaves the entries in the queue.
// No take is kept: the plan answers for them at once, as Claude's answer does for a planning
// turn, so undo has nothing of it, nor of a take before it, to bring back.
export async function takePlanned($: Engine, keys: Keys, items: readonly Entry[]) {
  const tagIds = items.filter(item => item.isTag).map(tagId)
  if (tagIds.length > 0) {
    await $.store.set(keys.handed, [...new Set([...(await loadHanded($, keys.handed)), ...tagIds])].slice(-500))
  }
  await saveEntries($, keys.queue, withoutEntries(await loadEntries($, keys.queue), items))
  await forgetTake($, keys).catch(() => undefined)
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
  const tagIds = items.filter(item => item.isTag).map(tagId)
  const take = await loadTake($, keys)
  const queue = await loadEntries($, keys.queue)
  // A call made again after one that failed half-way finds some already back.
  const back = take.entries.filter(entry => items.some(item => isSameEntry(item, entry)) && !queue.some(one => isSameEntry(one, entry)))
  await saveEntries($, keys.queue, [...back, ...queue])
  await unhandTags($, keys, tagIds)
  await saveTake($, keys, { ...take, entries: withoutEntries(take.entries, items), tagIds: take.tagIds.filter(id => !tagIds.includes(id)) })
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
  // Puts the chosen entries back where they stood among those still in the queue, before what
  // came since, and gives undo back what it had.
  const giveBack = async () => {
    const now = await loadEntries($, keys.queue)
    const kept = stored.filter(entry => [...chosen, ...now].some(one => isSameEntry(one, entry)))
    await saveEntries($, keys.queue, [...kept, ...withoutEntries(now, kept)])
    await saveTake($, keys, previous)
  }
  try {
    await saveTake($, keys, { entries: [...chosen], tagIds: [], by: 'hand-over' })
    await saveEntries($, keys.queue, withoutEntries(stored, chosen))
  } catch (error) {
    // The chosen entries are still in the queue: undo brings back what it did before, not them.
    await saveTake($, keys, previous).catch(() => undefined)
    throw error
  }

  return { giveBack }
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
