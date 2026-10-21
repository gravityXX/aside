import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { Band, Entry, PastRun, Plan, StoredPlan } from '../../types'
import { isAway, isWaiting, readActive, storedActive } from '../core/step'
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
  // The start of the keys of the plans in the log, one key each (saveRun).
  history: string
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
    history: `history:${root}:`,
  }
}

// The entries stored under `key`, as earlier releases stored them too, an entry with no kind
// being an idea. Features read the project queue through readQueue in io/queue.ts and change it
// only there, which alone stores lists of entries.
export async function loadEntries($: Engine, key: string): Promise<Entry[]> {
  const value = await $.store.get(key)

  return Array.isArray(value) ? (value as Entry[]).map(entry => ({ ...entry, kind: entry.kind ?? 'idea' })) : []
}

// The plan as the features read it: the step running as a state (readActive), not as the flags
// the store holds. The record itself is left as it is, so a session of an earlier release on
// this machine reads it unchanged (2.7).
export async function loadPlan($: Engine, key: string): Promise<Plan> {
  const value = (await $.store.get(key)) as StoredPlan | undefined
  if (!value || !Array.isArray(value.steps)) {
    return { steps: [] }
  }
  const { active, ...rest } = value

  return active ? { ...rest, active: readActive(active) } : rest
}

export async function savePlan($: Engine, key: string, plan: Plan) {
  if (plan.steps.length === 0) {
    await $.store.delete(key)
  } else {
    const { active, ...rest } = plan
    await $.store.set(key, active ? { ...rest, active: storedActive(active) } : rest)
  }
}

// How many plans the log keeps, the newest.
const RUNS_KEPT = 20

// The steps' titles as a short hash, so one plan's key is the same each time it is saved.
const fingerprint = (run: PastRun) => {
  let hash = 5381
  for (const char of run.steps.map(step => step.title).join('\u0000')) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0

  return hash.toString(36)
}

// A plan run to its end, into the log under a key of its own: `stamp`, when it ended, and what
// it held, so sessions that end plans at once never write over each other's, and saving the same
// plan again, as a save that failed half-way and is made again, keeps one. The oldest beyond the
// last RUNS_KEPT go.
export async function saveRun($: Engine, prefix: string, run: PastRun, stamp = run.at) {
  await $.store.set(`${prefix}${stamp}:${fingerprint(run)}`, run)
  const keys = (await $.store.keys()).filter(key => key.startsWith(prefix))
  const oldest = keys.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).slice(RUNS_KEPT)
  for (const key of oldest) await $.store.delete(key)
}

const isPastRun = (value: unknown): value is PastRun =>
  typeof value === 'object' && value !== null && typeof (value as PastRun).at === 'number' && Array.isArray((value as PastRun).steps)

// The plans in the log, the one that ended last first.
export async function loadRuns($: Engine, prefix: string): Promise<PastRun[]> {
  const runs: { key: string; run: PastRun }[] = []
  for (const key of (await $.store.keys()).filter(one => one.startsWith(prefix))) {
    const value = await $.store.get(key)
    if (isPastRun(value)) runs.push({ key, run: value })
  }

  return runs.sort((a, b) => b.run.at - a.run.at || b.key.localeCompare(a.key)).map(one => one.run)
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

// The tagIds stored under `key`, as tagId makes them now: the tags an earlier /aside already
// handed over, or those a take holds.
export async function loadTagIds($: Engine, key: string): Promise<string[]> {
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

// Counts what waits and where the plan is, for the line above the prompt. The tags are
// counted only when `tagCount` is given, since that takes reading the files.
export async function refreshBand($: Engine, tagCount?: number): Promise<Band> {
  const keys = await projectKeys($)
  const list = await loadEntries($, keys.queue)
  const plan = await loadPlan($, keys.plan)
  const ideas = list.filter(entry => entry.kind === 'idea').length
  const queues = await countQueues($)
  const global = queues.find(one => one.name === GLOBAL)?.count ?? 0
  // By the name typed after "+@": a queue of this project's hides one every project sees here.
  const named: { name: string; count: number }[] = []
  for (const { name, count } of queues) {
    if (name !== GLOBAL && !(await isHiddenHere($, name))) named.push({ name: queueName(name), count })
  }
  const next: Band = {
    ideas,
    comments: list.length - ideas,
    tags: tagCount ?? (await read($, band)).tags,
    steps: plan.steps.length,
    done: plan.steps.filter(step => step.isDone).length,
    ...(plan.active && !isWaiting(plan.active) ? { running: plan.active.step + 1 } : {}),
    ...(plan.active && isAway(plan.active) ? { isBackground: true as const } : {}),
    ...(plan.active && isWaiting(plan.active) ? { waiting: plan.active.step + 1 } : {}),
    ...(plan.paused && !plan.active ? { paused: plan.paused.step + 1 } : {}),
    ...(global > 0 ? { global } : {}),
    ...(named.length > 0 ? { named } : {}),
  }
  await update($, band, () => next)

  return next
}

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
const GLOBAL_IDEA = 'global:idea:'

export const GLOBAL = 'global'

// A queue's name as typed after "+@" or /aside q: letters, digits, "-" and "_", any case.
export const NAME_PATTERN = /^[A-Za-z0-9_-]{1,20}$/

// Whether a queue's id names one of this project's queues, and the name it is typed under.
export const isLocalQueue = (id: string) => id.startsWith('.')
export const queueName = (id: string) => (isLocalQueue(id) ? id.slice(1) : id)

// This project's scope in the keys of its own queues: a hash of its root, so a key holds no path,
// whose colons would break it up.
async function localScope($: Engine): Promise<string> {
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
export async function queueOf($: Engine, idea: GlobalIdea): Promise<string | undefined> {
  return queueOfKey(idea.key, await localScope($))
}

// The queue a name typed after "+@" or /aside q means here: this project's own of that name when
// it holds ideas, this session's last clear of it can bring them back, or an idea of it is out for
// editing in any session; else the one every project sees, when that is there; else, for a queue
// made now, the one `isLocal` asks for. Another session's clear of a queue left empty is not seen
// here, so its "+@name" may go to the queue every project sees until that session's undo.
export async function resolveQueue($: Engine, name: string, isLocal: boolean): Promise<string> {
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
export async function isHiddenHere($: Engine, id: string): Promise<boolean> {
  return id !== GLOBAL && !isLocalQueue(id) && (await resolveQueue($, id, false)) === `.${id}`
}

// This session's records of queue `from`, what its last clear took and an idea out for editing,
// moved to queue `to`, each idea's key under `to`'s, so undo and Enter bring them back there and
// no record keeps `from` there to hide the queue moved. Written there before they go from here.
export async function moveSessionRecords($: Engine, from: string, to: string) {
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
export async function countQueues($: Engine): Promise<{ name: string; count: number; last: number }[]> {
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
export async function loadIdeas($: Engine, name: string): Promise<GlobalIdea[]> {
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
export async function addIdeas($: Engine, name: string, entries: readonly GlobalIdea['entry'][]): Promise<GlobalIdea[]> {
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
  const [added] = await addIdeas($, (await queueOf($, idea)) ?? GLOBAL, [idea.entry])

  return added!
}

export async function forgetGlobalIdeas($: Engine, keys: readonly string[]) {
  for (const key of keys) await $.store.delete(key)
}

// An idea taken out with /aside q NAME edit (or /aside g edit), kept for the session until the
// reworked one is stored in its place, across a reload too. Its key names its queue.
const EDITING_PREFIX = 'global:editing:'

async function globalEditingKey($: Engine): Promise<string> {
  return `${EDITING_PREFIX}${await $.session.id()}`
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
// A queue of this project's has its scope in them, as its ideas' keys do.
const clearedPrefix = (name: string, scope: string) => (isLocalQueue(name) ? `cleared:local:${scope}:${queueName(name)}:` : `cleared:${name}:`)

async function clearedKeys($: Engine, name: string): Promise<string[]> {
  const session = await $.session.id()
  const prefix = clearedPrefix(name, await localScope($))

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
      const record = `${clearedPrefix(name, await localScope($))}${n}:${session}`
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
  const name = queueOfKey(key, await localScope($))

  return name !== undefined && (await loadCleared($, name)).some(one => one.idea.key === key)
}
