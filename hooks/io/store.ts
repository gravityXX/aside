import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { Band, Entry, Plan } from '../../types'
import { isWaiting } from '../core/listing'
import { canonicalPath, pathKey } from '../core/text'

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

// The list holds each file once, by pathKey, in the spelling it was last tracked under. One
// kept before it did may hold a Windows file twice, and comes back with the newest of the two.
export async function readTrackedFiles($: Engine): Promise<string[]> {
  const files = (await read($, trackedFiles)).map(file => canonicalPath(file))
  const keys = files.map(file => pathKey(file))

  return files.filter((file, i) => keys.indexOf(keys[i]!, i + 1) === -1)
}

export function trackFile($: Engine, path: string) {
  const own = canonicalPath(path)

  return update($, trackedFiles, list => [...list.filter(file => pathKey(file) !== pathKey(own)), own].slice(-100))
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

// `root` is spelled as canonicalPath spells files, to compare them with; the keys keep the
// engine's own spelling, under which earlier releases stored the queue.
export async function projectKeys($: Engine): Promise<Keys> {
  const root = await $.session.root()

  return {
    root: canonicalPath(root),
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
export const tagId = (tag: Entry) => `${pathKey(tag.file ?? '')}\u0000${tag.text}`

// Stored tagIds as tagId makes them now. Ids stored before files had one spelling may name
// one tag under two spellings of its Windows file: those are one. A repeat of one stored id
// stays, as it is a second tag of the same text in the same file.
const respellTagIds = (stored: unknown): string[] => {
  const ids = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
  const respelled = ids.map(id => {
    const end = id.indexOf('\u0000')
    return end === -1 ? id : `${pathKey(id.slice(0, end))}${id.slice(end)}`
  })

  return respelled.filter((id, i) => {
    const first = respelled.indexOf(id)
    return first === i || ids[first] === ids[i]
  })
}

// The tags an earlier /aside already handed over, by tagId.
export async function loadHanded($: Engine, key: string): Promise<string[]> {
  return respellTagIds(await $.store.get(key))
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
  const tagIds = respellTagIds(await $.store.get(keys.takenTags))
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
  const isItem = (entry: Entry) => items.some(item => item.at === entry.at && item.text === entry.text)
  await saveEntries($, keys.queue, (await loadEntries($, keys.queue)).filter(entry => !isItem(entry)))
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
  const queues = await countQueues($)
  const global = queues.find(one => one.name === GLOBAL)?.count ?? 0
  const named = queues.filter(one => one.name !== GLOBAL).map(({ name, count }) => ({ name, count }))
  const next: Band = {
    ideas,
    comments: list.length - ideas,
    tags: tagCount ?? (await read($, band)).tags,
    steps: plan.steps.length,
    done: plan.steps.filter(step => step.isDone).length,
    ...(plan.active && !isWaiting(plan.active) ? { running: plan.active.step + 1 } : {}),
    ...(plan.active && isWaiting(plan.active) ? { waiting: plan.active.step + 1 } : {}),
    ...(plan.paused && !plan.active ? { paused: plan.paused.step + 1 } : {}),
    ...(global > 0 ? { global } : {}),
    ...(named.length > 0 ? { named } : {}),
  }
  await update($, band, () => next)

  return next
}

// The global list and the named queues: ideas that belong to no project, one store key each,
// so that sessions in different projects add and take them at the same time without writing
// over each other's. The global list is the queue named "global", under the keys it has always
// had; any other queue's are under named:<name>:idea:. A key holds when the idea was added to
// its queue, the session that added it and a number free for that pair, so ideas of one message
// keep the order typed. Within a queue an idea is placed by its own `at`, or by `order`: set when
// it comes from a queue with /aside q add, and when it is moved. A queue is there while it holds
// an idea.
const GLOBAL_IDEA = 'global:idea:'

export const GLOBAL = 'global'

// A queue's name as typed after "+@" or /aside q: letters, digits, "-" and "_", any case.
export const NAME_PATTERN = /^[A-Za-z0-9_-]{1,20}$/

const prefixOf = (name: string) => (name === GLOBAL ? GLOBAL_IDEA : `named:${name}:idea:`)

// The queue a store key holds an idea of, if any.
const queueOfKey = (key: string): string | undefined => (key.startsWith(GLOBAL_IDEA) ? GLOBAL : /^named:([a-z0-9_-]{1,20}):idea:/.exec(key)?.[1])

export type GlobalIdea = { key: string; entry: Entry & { order?: number } }

// The queue an idea is in, by its key.
export const queueOf = (idea: GlobalIdea) => queueOfKey(idea.key) ?? GLOBAL

const isEntry = (value: unknown): value is Entry =>
  typeof value === 'object' && value !== null && typeof (value as Entry).text === 'string' && typeof (value as Entry).at === 'number'

export const rankOf = (idea: GlobalIdea) => idea.entry.order ?? idea.entry.at

// Every queue that holds an idea, with how many and when it was last added to, by its keys
// alone: the global list first, then the one added to last.
export async function countQueues($: Engine): Promise<{ name: string; count: number; last: number }[]> {
  const queues = new Map<string, { count: number; last: number }>()
  for (const key of await $.store.keys()) {
    const name = queueOfKey(key)
    if (name === undefined) continue
    const at = Number(key.slice(prefixOf(name).length).split(':')[0])
    const one = queues.get(name) ?? { count: 0, last: 0 }
    queues.set(name, { count: one.count + 1, last: Math.max(one.last, Number.isFinite(at) ? at : 0) })
  }

  return [...queues]
    .map(([name, one]) => ({ name, ...one }))
    .sort((a, b) => Number(b.name === GLOBAL) - Number(a.name === GLOBAL) || b.last - a.last || a.name.localeCompare(b.name))
}

// A queue's ideas, first to last.
export async function loadIdeas($: Engine, name: string): Promise<GlobalIdea[]> {
  const prefix = prefixOf(name)
  const ideas: GlobalIdea[] = []
  for (const key of (await $.store.keys()).filter(one => one.startsWith(prefix))) {
    const value = await $.store.get(key)
    if (isEntry(value)) ideas.push({ key, entry: { ...value, kind: 'idea' } })
  }

  return ideas.sort((a, b) => rankOf(a) - rankOf(b) || a.key.localeCompare(b.key, undefined, { numeric: true }))
}

export async function loadGlobalIdeas($: Engine): Promise<GlobalIdea[]> {
  return loadIdeas($, GLOBAL)
}

// Each idea under a key of its own in queue `name`, stamped with the time it is added. All of
// them or none: should a write fail, those already written are taken back before the error goes on.
export async function addIdeas($: Engine, name: string, entries: readonly GlobalIdea['entry'][]): Promise<GlobalIdea[]> {
  const prefix = prefixOf(name)
  const session = await $.session.id()
  const stamp = await $.clock.now()
  const taken = new Set(await $.store.keys())
  const added: GlobalIdea[] = []
  try {
    for (const entry of entries) {
      let n = 0
      while (taken.has(`${prefix}${stamp}:${session}:${n}`)) n += 1
      const key = `${prefix}${stamp}:${session}:${n}`
      taken.add(key)
      await $.store.set(key, entry)
      added.push({ key, entry })
    }
  } catch (error) {
    await forgetGlobalIdeas($, added.map(idea => idea.key)).catch(() => undefined)
    throw error
  }

  return added
}

export async function addGlobalIdeas($: Engine, entries: readonly GlobalIdea['entry'][]): Promise<GlobalIdea[]> {
  return addIdeas($, GLOBAL, entries)
}

export async function saveGlobalIdea($: Engine, idea: GlobalIdea) {
  await $.store.set(idea.key, idea.entry)
}

// An idea that left its key, back in its queue: under that key while it is free or still holds
// `was`, the idea as it left, else under a new one, since this session may have added another
// idea there since. Only this session writes keys that name it.
export async function restoreIdea($: Engine, idea: GlobalIdea, was: Entry = idea.entry): Promise<GlobalIdea> {
  const there = await $.store.get(idea.key)
  if (there === undefined || (isEntry(there) && there.at === was.at && there.text === was.text)) {
    await saveGlobalIdea($, idea)
    return idea
  }
  const [added] = await addIdeas($, queueOf(idea), [idea.entry])

  return added!
}

export async function forgetGlobalIdeas($: Engine, keys: readonly string[]) {
  for (const key of keys) await $.store.delete(key)
}

// An idea taken out with /aside q NAME edit (or /aside g edit), kept for the session until the
// reworked one is stored in its place, across a reload too. Its key names its queue.
async function globalEditingKey($: Engine): Promise<string> {
  return `global:editing:${await $.session.id()}`
}

export async function loadGlobalEditing($: Engine): Promise<GlobalIdea | undefined> {
  const value = await $.store.get(await globalEditingKey($))
  const one = value as { key?: unknown; entry?: unknown } | undefined

  return typeof one?.key === 'string' && isEntry(one.entry) ? { key: one.key, entry: one.entry } : undefined
}

export async function saveGlobalEditing($: Engine, idea: GlobalIdea) {
  await $.store.set(await globalEditingKey($), idea)
}

export async function forgetGlobalEditing($: Engine) {
  await $.store.delete(await globalEditingKey($))
}

// What this session's last /aside q NAME clear of each queue took, for /aside q NAME undo: one
// record per idea, the idea under the key it had, so an undo takes each record away as its idea
// is back, and one cut short, run again, brings back only the rest. The keys sit outside the
// named: ones, so no record reads as a queue, and end with the session's id, which may hold colons.
const clearedPrefix = (name: string) => `cleared:${name}:`

async function clearedKeys($: Engine, name: string): Promise<string[]> {
  const session = await $.session.id()
  const prefix = clearedPrefix(name)

  return (await $.store.keys())
    .filter(key => key.startsWith(prefix) && key.endsWith(`:${session}`) && /^\d+$/.test(key.slice(prefix.length, key.length - session.length - 1)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

export async function loadCleared($: Engine, name: string): Promise<{ record: string; idea: GlobalIdea }[]> {
  const cleared: { record: string; idea: GlobalIdea }[] = []
  for (const record of await clearedKeys($, name)) {
    const one = (await $.store.get(record)) as { key?: unknown; entry?: unknown } | undefined
    if (typeof one?.key === 'string' && isEntry(one.entry)) cleared.push({ record, idea: { key: one.key, entry: one.entry } })
  }

  return cleared
}

// The ideas a clear takes, in place of what an earlier clear of that queue kept. All of them or
// none: should a write fail, those already written are taken back before the error goes on.
export async function saveCleared($: Engine, name: string, ideas: readonly GlobalIdea[]) {
  for (const record of await clearedKeys($, name)) await $.store.delete(record)
  const session = await $.session.id()
  const written: string[] = []
  try {
    for (const [n, idea] of ideas.entries()) {
      const record = `${clearedPrefix(name)}${n}:${session}`
      await $.store.set(record, idea)
      written.push(record)
    }
  } catch (error) {
    for (const record of written) await $.store.delete(record).catch(() => undefined)
    throw error
  }
}

export async function forgetCleared($: Engine, record: string) {
  await $.store.delete(record)
}

// Whether an idea's key is out of its queue for this session: taken out with /aside q edit, or
// kept by a clear for undo. A write that brings such a key back would make a second copy.
export async function isOut($: Engine, key: string): Promise<boolean> {
  if ((await loadGlobalEditing($))?.key === key) {
    return true
  }
  const name = queueOfKey(key)

  return name !== undefined && (await loadCleared($, name)).some(one => one.idea.key === key)
}
