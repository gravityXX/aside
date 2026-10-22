import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { Band, Entry, PastRun, Plan, StoredPlan } from '../../types'
import { isAway, isWaiting, readActive, storedActive } from '../core/step'
import { canonicalPath, pathKey } from '../core/text'
import { countQueues, GLOBAL, isHiddenHere, queueName } from './queues'

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
