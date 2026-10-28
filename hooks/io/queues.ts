// The global list and the named queues: ideas outside a project's own queue, one store key each,
// so that sessions in different projects add and take them at the same time without writing
// over each other's. The global list is the queue named "global", under the keys it has always
// had; a named queue every project sees is under named:<name>:idea:, and one of a single project
// under local:<scope>:<name>:idea:, its scope a hash of the project's root. A key holds when the
// idea was added to its queue, the session that added it and a number free for that pair, so
// ideas of one message keep the order typed. Within a queue an idea is placed by its own `at`, or
// by `order`: set when it comes from a queue with /aside q add, and when it is moved. A queue is
// there while it holds an idea.
//
// The code knows a queue by an id: "global", a name for a named queue every project sees, and
// "." before the name for one of this project's, as a typed name never holds a dot.

import type { Entry } from '../../types'
import type { Kit } from '../kit'

const GLOBAL_IDEA = 'global:idea:'

export const GLOBAL = 'global'

// A queue's name as typed after "+@" or /aside q: letters, digits, "-" and "_", any case.
export const NAME_PATTERN = /^[A-Za-z0-9_-]{1,20}$/

// Whether a queue's id names one of this project's queues, and the name it is typed under.
export const isLocalQueue = (id: string) => id.startsWith('.')
export const queueName = (id: string) => (isLocalQueue(id) ? id.slice(1) : id)

// This project's scope in the keys of its own queues: a hash of its root, so a key holds no path,
// whose colons would break it up.
async function localScope($: Kit): Promise<string> {
  let hash = 5381
  for (const char of await $.session.root()) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0

  return hash.toString(36)
}

const prefixOf = (id: string, scope: string) =>
  id === GLOBAL ? GLOBAL_IDEA : isLocalQueue(id) ? `local:${scope}:${queueName(id)}:idea:` : `named:${id}:idea:`

// The queue a store key holds an idea of, if any: another project's own queues are none here.
const queueOfKey = (key: string, scope: string): string | undefined => {
  if (key.startsWith(GLOBAL_IDEA)) {
    return GLOBAL
  }
  const local = /^local:([a-z0-9]+):([a-z0-9_-]{1,20}):idea:/.exec(key)

  return local ? (local[1] === scope ? `.${local[2]}` : undefined) : /^named:([a-z0-9_-]{1,20}):idea:/.exec(key)?.[1]
}

export type GlobalIdea = { key: string; entry: Entry & { order?: number } }

// The queue an idea is in, by its key; none here for another project's own, as after /cd.
export async function queueOf($: Kit, idea: GlobalIdea): Promise<string | undefined> {
  return queueOfKey(idea.key, await localScope($))
}

// The queue a name typed after "+@" or /aside q means here: this project's own of that name when
// it holds ideas, this session's last clear of it can bring them back, or an idea of it is out for
// editing in any session; else the one every project sees, when that is there; else, for a queue
// made now, the one `isLocal` asks for. Another session's clear of a queue left empty is not seen
// here, so its "+@name" may go to the queue every project sees until that session's undo.
export async function resolveQueue($: Kit, name: string, isLocal: boolean): Promise<string> {
  if (name === GLOBAL) {
    return GLOBAL
  }
  const scope = await localScope($)
  const keys = await $.store.keys()
  const outs: string[] = []
  for (const key of keys.filter(one => one.startsWith(EDITING_PREFIX))) {
    const out = (await $.store.get(key)) as { key?: unknown } | undefined
    if (typeof out?.key === 'string') outs.push(out.key)
  }
  const isThere = async (id: string) =>
    keys.some(key => key.startsWith(prefixOf(id, scope))) || (await clearedKeys($, id)).length > 0 || outs.some(key => queueOfKey(key, scope) === id)
  if (await isThere(`.${name}`)) {
    return `.${name}`
  }
  if (await isThere(name)) {
    return name
  }

  return isLocal ? `.${name}` : name
}

// Whether this project's own queue of a name hides the queue every project sees under it here,
// by the rule resolveQueue keeps, so the band, /aside q, find and Tab never name a queue that
// /aside q NAME passes over.
export async function isHiddenHere($: Kit, id: string): Promise<boolean> {
  return id !== GLOBAL && !isLocalQueue(id) && (await resolveQueue($, id, false)) === `.${id}`
}

// This session's records of queue `from`, what its last clear took and an idea out for editing,
// moved to queue `to`, each idea's key under `to`'s, so undo and Enter bring them back there and
// no record keeps `from` there to hide the queue moved. Written there before they go from here.
export async function moveSessionRecords($: Kit, from: string, to: string) {
  const scope = await localScope($)
  const rekey = (idea: GlobalIdea): GlobalIdea => ({ key: prefixOf(to, scope) + idea.key.slice(prefixOf(from, scope).length), entry: idea.entry })
  const cleared = await loadCleared($, from)
  if (cleared.length > 0) {
    await saveCleared($, to, [...(await loadCleared($, to)).map(one => one.idea), ...cleared.map(one => rekey(one.idea))])
    for (const { record } of cleared) await forgetCleared($, record)
  }
  const editing = await loadGlobalEditing($)
  if (editing !== undefined && queueOfKey(editing.key, scope) === from) await saveGlobalEditing($, rekey(editing))
}

const isEntry = (value: unknown): value is Entry =>
  typeof value === 'object' && value !== null && typeof (value as Entry).text === 'string' && typeof (value as Entry).at === 'number'

export const rankOf = (idea: GlobalIdea) => idea.entry.order ?? idea.entry.at

// Every queue that holds an idea, with how many and when it was last added to, by its keys
// alone: the global list first, then the one added to last.
export async function countQueues($: Kit): Promise<{ name: string; count: number; last: number }[]> {
  const scope = await localScope($)
  const queues = new Map<string, { count: number; last: number }>()
  for (const key of await $.store.keys()) {
    const name = queueOfKey(key, scope)
    if (name === undefined) continue
    const at = Number(key.slice(prefixOf(name, scope).length).split(':')[0])
    const one = queues.get(name) ?? { count: 0, last: 0 }
    queues.set(name, { count: one.count + 1, last: Math.max(one.last, Number.isFinite(at) ? at : 0) })
  }

  return [...queues]
    .map(([name, one]) => ({ name, ...one }))
    .sort((a, b) => Number(b.name === GLOBAL) - Number(a.name === GLOBAL) || b.last - a.last || a.name.localeCompare(b.name))
}

// A queue's ideas, first to last.
export async function loadIdeas($: Kit, name: string): Promise<GlobalIdea[]> {
  const prefix = prefixOf(name, await localScope($))
  const ideas: GlobalIdea[] = []
  for (const key of (await $.store.keys()).filter(one => one.startsWith(prefix))) {
    const value = await $.store.get(key)
    if (isEntry(value)) ideas.push({ key, entry: { ...value, kind: 'idea' } })
  }

  return ideas.sort((a, b) => rankOf(a) - rankOf(b) || a.key.localeCompare(b.key, undefined, { numeric: true }))
}

// Each idea under a key of its own in queue `name`, stamped with the time it is added. All of
// them or none: should a write fail, those already written are taken back before the error goes on.
export async function addIdeas($: Kit, name: string, entries: readonly GlobalIdea['entry'][]): Promise<GlobalIdea[]> {
  const prefix = prefixOf(name, await localScope($))
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

export async function saveGlobalIdea($: Kit, idea: GlobalIdea) {
  await $.store.set(idea.key, idea.entry)
}

// An idea that left its key, back in its queue: under that key while it is free or still holds
// `was`, the idea as it left, else under a new one, since this session may have added another
// idea there since. Only this session writes keys that name it.
export async function restoreIdea($: Kit, idea: GlobalIdea, was: Entry = idea.entry): Promise<GlobalIdea> {
  const there = await $.store.get(idea.key)
  if (there === undefined || (isEntry(there) && there.at === was.at && there.text === was.text)) {
    await saveGlobalIdea($, idea)
    return idea
  }
  const [added] = await addIdeas($, (await queueOf($, idea)) ?? GLOBAL, [idea.entry])

  return added!
}

export async function forgetGlobalIdeas($: Kit, keys: readonly string[]) {
  for (const key of keys) await $.store.delete(key)
}

// An idea taken out with /aside q NAME edit (or /aside g edit), kept for the session until the
// reworked one is stored in its place, across a reload too. Its key names its queue.
const EDITING_PREFIX = 'global:editing:'

async function globalEditingKey($: Kit): Promise<string> {
  return `${EDITING_PREFIX}${await $.session.id()}`
}

export async function loadGlobalEditing($: Kit): Promise<GlobalIdea | undefined> {
  const value = await $.store.get(await globalEditingKey($))
  const one = value as { key?: unknown; entry?: unknown } | undefined

  return typeof one?.key === 'string' && isEntry(one.entry) ? { key: one.key, entry: one.entry } : undefined
}

export async function saveGlobalEditing($: Kit, idea: GlobalIdea) {
  await $.store.set(await globalEditingKey($), idea)
}

export async function forgetGlobalEditing($: Kit) {
  await $.store.delete(await globalEditingKey($))
}

// What this session's last /aside q NAME clear of each queue took, for /aside q NAME undo: one
// record per idea, the idea under the key it had, so an undo takes each record away as its idea
// is back, and one cut short, run again, brings back only the rest. The keys sit outside the
// named: ones, so no record reads as a queue, and end with the session's id, which may hold colons.
// A queue of this project's has its scope in them, as its ideas' keys do.
const clearedPrefix = (name: string, scope: string) => (isLocalQueue(name) ? `cleared:local:${scope}:${queueName(name)}:` : `cleared:${name}:`)

async function clearedKeys($: Kit, name: string): Promise<string[]> {
  const session = await $.session.id()
  const prefix = clearedPrefix(name, await localScope($))

  return (await $.store.keys())
    .filter(key => key.startsWith(prefix) && key.endsWith(`:${session}`) && /^\d+$/.test(key.slice(prefix.length, key.length - session.length - 1)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

export async function loadCleared($: Kit, name: string): Promise<{ record: string; idea: GlobalIdea }[]> {
  const cleared: { record: string; idea: GlobalIdea }[] = []
  for (const record of await clearedKeys($, name)) {
    const one = (await $.store.get(record)) as { key?: unknown; entry?: unknown } | undefined
    if (typeof one?.key === 'string' && isEntry(one.entry)) cleared.push({ record, idea: { key: one.key, entry: one.entry } })
  }

  return cleared
}

// The ideas a clear takes, in place of what an earlier clear of that queue kept. All of them or
// none: should a write fail, those already written are taken back before the error goes on.
export async function saveCleared($: Kit, name: string, ideas: readonly GlobalIdea[]) {
  for (const record of await clearedKeys($, name)) await $.store.delete(record)
  const session = await $.session.id()
  const written: string[] = []
  try {
    for (const [n, idea] of ideas.entries()) {
      const record = `${clearedPrefix(name, await localScope($))}${n}:${session}`
      await $.store.set(record, idea)
      written.push(record)
    }
  } catch (error) {
    for (const record of written) await $.store.delete(record).catch(() => undefined)
    throw error
  }
}

export async function forgetCleared($: Kit, record: string) {
  await $.store.delete(record)
}

// Whether an idea's key is out of its queue for this session: taken out with /aside q edit, or
// kept by a clear for undo. A write that brings such a key back would make a second copy.
export async function isOut($: Kit, key: string): Promise<boolean> {
  if ((await loadGlobalEditing($))?.key === key) {
    return true
  }
  const name = queueOfKey(key, await localScope($))

  return name !== undefined && (await loadCleared($, name)).some(one => one.idea.key === key)
}
