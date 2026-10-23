// Every change to the project's queue, one after another, and the take /aside undo brings back.
// Features read the queue to list, count or check it and store it nowhere: only this file writes
// it (2.9).

import type { EngineInterface as Engine } from 'claude-code'

import type { Entry } from '../../types'
import { inOrder, isSameEntry, onlyEntries, withoutEntries } from '../core/entries'
import type { Order } from '../core/entries'
import { serial } from '../core/serial'
import { loadEntries, loadTagIds, projectKeys, tagId } from './store'
import type { Keys } from './store'

// A `list` left out keeps the queue as it is. `afterSave` writes what goes with the
// queue once it is stored, before the next change reads anything: the record of an entry out for
// /aside edit, saved or forgotten, so a message sent right after finds it as the queue now stands.
export type QueueChange<T> = { list?: readonly Entry[]; value: T; afterSave?: () => Promise<unknown> }

// The changes to this project's queue, one after another, so two that overlap never store over
// each other (2.9): typed entries, their tidied text, imports, and the takes undo brings back.
const inTurn = serial()

// The slow first steps of changeQueueAfter, one after another, beside the chain rather than on
// it: each change joins the chain once its first step is done, in the order they were asked
// for, and a change asked for meanwhile without one, such as a hand-over, never waits on them.
const inPrepared = serial()

// On the chain (core/serial.ts), so what is read next holds the change.
export function changeQueue<T>($: Engine, change: (stored: readonly Entry[]) => QueueChange<T> | Promise<QueueChange<T>>): Promise<T> {
  return inTurn(() => applyChange($, change))
}

// Changes the queue as changeQueue does, after `prepare`: slow work, such as a process or the
// clipboard, that must keep the order the changes were asked in. It runs before the change
// joins the chain and before the queue is read. Read before it, the stored list would be held
// across its waits, and a command that writes the queue outside the chain meanwhile (rm) would
// be stored over; on the chain, a hand-over would wait on a slow git. What it makes is handed to
// the change.
export function changeQueueAfter<P, T>(
  $: Engine,
  prepare: () => Promise<P>,
  change: (stored: readonly Entry[], prepared: P) => QueueChange<T> | Promise<QueueChange<T>>,
): Promise<T> {
  return inPrepared(async () => {
    const prepared = await prepare()

    return inTurn(() => applyChange($, stored => change(stored, prepared)))
  })
}

// The queue as /aside shows it, in the order setting, read as it is stored now: for what is
// only listed, counted or checked. What is read here and written back would store over a change
// made meanwhile; that goes through changeQueue.
export async function readQueue($: Engine, order: Order): Promise<Entry[]> {
  return inOrder(await loadEntries($, (await projectKeys($)).queue), order)
}

// Stores a list of entries under `key`, the queue or the take, and an empty one as no key at
// all. Only the changes here write them, so nothing else can store over one on its way.
async function saveEntries($: Engine, key: string, list: readonly Entry[]) {
  if (list.length === 0) {
    await $.store.delete(key)
  } else {
    await $.store.set(key, list)
  }
}

async function applyChange<T>($: Engine, change: (stored: readonly Entry[]) => QueueChange<T> | Promise<QueueChange<T>>): Promise<T> {
  const { queue } = await projectKeys($)
  const { list, value, afterSave } = await change(await loadEntries($, queue))
  if (list !== undefined) await saveEntries($, queue, list)
  await afterSave?.()

  return value
}

// What /aside undo brings back: the entries and the tags the last plan, run or clear took.
// Each take replaces the one before it. A hand-over's take lasts until Claude has answered
// it (forgetAnsweredTake); a clear's lasts until the next take.
export type Take = { entries: Entry[]; tagIds: string[]; by: 'hand-over' | 'clear' }

async function saveTake($: Engine, keys: Keys, take: Take) {
  await saveEntries($, keys.taken, take.entries)
  if (take.tagIds.length === 0) {
    await $.store.delete(keys.takenTags)
  } else {
    await $.store.set(keys.takenTags, take.tagIds)
  }
  await $.store.set(keys.takenBy, take.by)
}

// A take stored before takenBy existed counts as a clear's: it stays until the next take.
async function loadTake($: Engine, keys: Keys): Promise<Take> {
  const tagIds = await loadTagIds($, keys.takenTags)
  const by = (await $.store.get(keys.takenBy)) === 'hand-over' ? 'hand-over' : 'clear'

  return { entries: await loadEntries($, keys.taken), tagIds, by }
}

const isSameTake = (one: Take, other: Take): boolean =>
  one.by === other.by &&
  one.entries.length === other.entries.length &&
  one.entries.every((entry, i) => other.entries[i] !== undefined && isSameEntry(entry, other.entries[i])) &&
  one.tagIds.length === other.tagIds.length &&
  one.tagIds.every((id, i) => id === other.tagIds[i])

// Gives undo back the take it had before `take`, while `take` is still the one stored. A
// give-back runs in a later turn than its take, once the hand-over has failed, so a clear may
// have made a newer take meanwhile, and that one stays.
async function restoreTake($: Engine, keys: Keys, take: Take, previous: Take) {
  if (isSameTake(await loadTake($, keys), take)) await saveTake($, keys, previous)
}

async function forgetTake($: Engine, keys: Keys) {
  await saveEntries($, keys.taken, [])
  await $.store.delete(keys.takenTags)
  await $.store.delete(keys.takenBy)
}

// Unmarks tags handed over, so the next hand-over takes them again.
async function unhandTags($: Engine, keys: Keys, tagIds: readonly string[]) {
  const handed = await loadTagIds($, keys.handed)
  await $.store.set(keys.handed, handed.filter(id => !tagIds.includes(id)))
}

// Once Claude has answered what was handed over, it is done: undo must not bring it back. On
// the chain, as every write of the take is, so a take on its way is not forgotten half-way.
export function forgetAnsweredTake($: Engine): Promise<void> {
  return inTurn(async () => {
    const keys = await projectKeys($)
    if ((await $.store.get(keys.takenBy)) === 'hand-over') {
      await forgetTake($, keys)
    }
  })
}

// Takes the whole queue out for /aside clear, where undo finds it, and answers what it took;
// an empty queue leaves the take undo had.
export function takeCleared($: Engine): Promise<readonly Entry[]> {
  return inTurn(async () => {
    const keys = await projectKeys($)
    const stored = await loadEntries($, keys.queue)
    if (stored.length > 0) {
      await saveTake($, keys, { entries: stored, tagIds: [], by: 'clear' })
      await saveEntries($, keys.queue, [])
    }

    return stored
  })
}

// Takes what a plan saved outside the conversation holds out of the queue: its entries, and
// its tags as handed over, the tags first, so a failed write leaves the entries in the queue.
// No take is kept: the plan answers for them at once, as Claude's answer does for a planning
// turn, so undo has nothing of it, nor of a take before it, to bring back.
export function takePlanned($: Engine, items: readonly Entry[]): Promise<void> {
  return inTurn(async () => {
    const keys = await projectKeys($)
    const tagIds = items.filter(item => item.isTag).map(tagId)
    if (tagIds.length > 0) {
      await $.store.set(keys.handed, [...new Set([...(await loadTagIds($, keys.handed)), ...tagIds])].slice(-500))
    }
    await saveEntries($, keys.queue, withoutEntries(await loadEntries($, keys.queue), items))
    await forgetTake($, keys).catch(() => undefined)
  })
}

// Its entries go back at the head of the queue, once each, its tags into their files for the
// next hand-over.
export function bringBackTake($: Engine): Promise<Take> {
  return inTurn(async () => {
    const keys = await projectKeys($)
    const take = await loadTake($, keys)
    // A call made again after one that failed half-way finds the entries back already.
    const queue = await loadEntries($, keys.queue)
    await saveEntries($, keys.queue, [...take.entries, ...withoutEntries(queue, take.entries)])
    await unhandTags($, keys, take.tagIds)
    await forgetTake($, keys)

    return take
  })
}

// Puts back some of what a hand-over took (`items`, entries and tags alike) and leaves them
// out of the take, so /aside undo never brings them back a second time.
export function giveBackItems($: Engine, items: readonly Entry[]): Promise<void> {
  return inTurn(async () => {
    const keys = await projectKeys($)
    const tagIds = items.filter(item => item.isTag).map(tagId)
    const take = await loadTake($, keys)
    const queue = await loadEntries($, keys.queue)
    // A call made again after one that failed half-way finds some already back.
    const back = withoutEntries(onlyEntries(take.entries, items), queue)
    await saveEntries($, keys.queue, [...back, ...queue])
    await unhandTags($, keys, tagIds)
    await saveTake($, keys, { ...take, entries: withoutEntries(take.entries, items), tagIds: take.tagIds.filter(id => !tagIds.includes(id)) })
  })
}

// Takes the entries `choose` picks from the queue, read in the take's turn on the chain, to
// hand them over; the rest stay, entries typed meanwhile among them. /aside undo brings the
// chosen back until Claude has answered them. What `choose` answers instead of entries, why
// none can be chosen, comes back as it is, and nothing is taken.
export function takeChosen(
  $: Engine,
  choose: (stored: readonly Entry[]) => readonly Entry[] | string,
): Promise<{ chosen: readonly Entry[]; giveBack: () => Promise<void> } | string> {
  return inTurn(async () => {
    const keys = await projectKeys($)
    const stored = await loadEntries($, keys.queue)
    const chosen = choose(stored)
    if (typeof chosen === 'string') {
      return chosen
    }
    const previous = await loadTake($, keys)
    const take: Take = { entries: [...chosen], tagIds: [], by: 'hand-over' }
    // Puts the chosen entries back where they stood among those still in the queue, before what
    // came since, and gives undo back what it had.
    const giveBack = () =>
      inTurn(async () => {
        const now = await loadEntries($, keys.queue)
        const kept = onlyEntries(stored, [...chosen, ...now])
        await saveEntries($, keys.queue, [...kept, ...withoutEntries(now, kept)])
        await restoreTake($, keys, take, previous)
      })
    try {
      await saveTake($, keys, take)
      await saveEntries($, keys.queue, withoutEntries(stored, chosen))
    } catch (error) {
      // The chosen entries are still in the queue: undo brings back what it did before, not them.
      await saveTake($, keys, previous).catch(() => undefined)
      throw error
    }

    return { chosen, giveBack }
  })
}

// Takes the queue and the new tags (`tags`, read from their files before) out to hand them
// over: both go where /aside undo finds them, and the tags are marked so they are not handed
// over again. The queue is read in the take's turn on the chain, so an entry typed meanwhile is
// either taken with it or stored after it, never written over. It answers the entries taken,
// oldest first, and `giveBack`, which undoes all of it when the hand-over fails: the entries
// back in the queue, its tags no longer marked, and the take undo had before. With nothing
// to take, nothing is written, and the take undo had stays. A take that fails half-way is undone
// at once, before its error goes on: the queue as it was, and the take undo had before, so
// nothing is left both in the queue and in the take, and nothing undo had is lost.
export function takeForHandOver($: Engine, tags: readonly Entry[]): Promise<{ stored: readonly Entry[]; giveBack: () => Promise<void> }> {
  return inTurn(async () => {
    const keys = await projectKeys($)
    const stored = await loadEntries($, keys.queue)
    if (stored.length === 0 && tags.length === 0) {
      return { stored, giveBack: async () => undefined }
    }
    const before = await loadTagIds($, keys.handed)
    const previous = await loadTake($, keys)
    const take: Take = { entries: [...stored], tagIds: tags.map(tagId), by: 'hand-over' }
    // Only the tags this take marks: others marked between the take and its give-back stay so.
    const marked = take.tagIds.filter(id => !before.includes(id))
    let isQueueTaken = false
    // The entries go back at the head of the queue, before what came since, once each.
    const putBack = async () => {
      const now = await loadEntries($, keys.queue)
      await saveEntries($, keys.queue, [...stored, ...withoutEntries(now, stored)])
    }
    const giveBack = () =>
      inTurn(async () => {
        if (isQueueTaken) await putBack()
        await unhandTags($, keys, marked)
        await restoreTake($, keys, take, previous)
      })
    try {
      await saveTake($, keys, take)
      if (stored.length > 0) {
        await saveEntries($, keys.queue, [])
        isQueueTaken = true
      }
      await $.store.set(keys.handed, [...new Set([...before, ...take.tagIds])].slice(-500))
    } catch (error) {
      // The handed write comes last: when anything failed, it was never made.
      if (isQueueTaken) await putBack().catch(() => undefined)
      await saveTake($, keys, previous).catch(() => undefined)
      throw error
    }

    return { stored, giveBack }
  })
}
