import type { EngineInterface as Engine } from 'claude-code'

import type { Entry } from '../../types'
import type { Context } from '../context'
import { inOrder } from '../core/entries'
import { QUEUE_PEEK, listingText, namedSection, queuesSections } from '../core/listing'
import type { Listed } from '../core/listing'
import { MARKDOWN_PATH } from '../core/markdown'
import { formatCount, newQueueNote, shortenText } from '../core/text'
import {
  addIdeas,
  countQueues,
  forgetCleared,
  forgetGlobalIdeas,
  GLOBAL,
  isHiddenHere,
  isLocalQueue,
  loadCleared,
  loadEntries,
  loadIdeas,
  moveSessionRecords,
  NAME_PATTERN,
  projectKeys,
  queueName,
  rankOf,
  refreshBand,
  resolveQueue,
  restoreIdea,
  saveCleared,
  saveEntries,
  saveGlobalEditing,
  saveGlobalIdea,
} from '../io/store'
import type { GlobalIdea } from '../io/store'
import { addEntries } from './capture'
import { importFile } from './importing'
import { showWhileWorking } from './queue'

// How the commands name a queue: the global list in the words it always had, and any other queue
// by the name it is typed under, for this project's queues too.
const nameOf = (name: string) => (name === GLOBAL ? 'the global list' : `@${queueName(name)}`)
const inName = (name: string) => (name === GLOBAL ? 'on the global list' : `in @${queueName(name)}`)
const commandOf = (name: string) => (name === GLOBAL ? '/aside g' : `/aside q ${queueName(name)}`)
const markOf = (name: string) => (name === GLOBAL ? '+g' : `+@${queueName(name)}`)

const emptyOf = (name: string) =>
  name === GLOBAL ? 'The global list is empty. Start a message with "+g" to add an idea to it.' : `${nameOf(name)} is empty. Start a message with "${markOf(name)}" to add an idea to it.`

const isPlace = (n: number, length: number) => Number.isInteger(n) && n >= 1 && n <= length

const askPlaces = (name: string, length: number, count: number) =>
  `Give ${count === 1 ? 'a number' : 'numbers'} from 1 to ${length}, as ${commandOf(name)} shows them.`

// The same idea in two places: an idea moved half-way, by a command that failed after its
// first write, is not moved a second time when the command runs again.
const isSame = (a: Entry, b: Entry) => a.at === b.at && a.text === b.text

// A queue as /aside q NAME numbers it, in the order setting.
async function shownIdeas($: Engine, ctx: Context, name: string): Promise<GlobalIdea[]> {
  const ideas = await loadIdeas($, name)

  return ctx.settings.order === 'newest' ? ideas.reverse() : ideas
}

// What a command says it did to several ideas, or to one, by their text.
const sayIdeas = (done: string, entries: readonly Entry[]) =>
  entries.length === 1 ? `${done}: ${shortenText(entries[0]!.text, 60)}` : `${done} ${formatCount(entries.length, 'idea')}: ${entries.map(entry => shortenText(entry.text, 40)).join('; ')}`

// The ideas of queue `name`, as /aside g or /aside q NAME lists them, and the list pane too.
export async function queueListed($: Engine, ctx: Context, name: string): Promise<Listed> {
  const ideas = await shownIdeas($, ctx, name)
  if (ideas.length === 0) {
    return emptyOf(name)
  }

  return { sections: [namedSection(queueName(name), ideas.map(idea => idea.entry), isLocalQueue(name))] }
}

async function showQueue($: Engine, ctx: Context, name: string): Promise<string> {
  return showWhileWorking($, ctx, { kind: 'named', typed: queueName(name) }, await queueListed($, ctx, name), nameOf(name))
}

export async function showGlobal($: Engine, ctx: Context): Promise<string> {
  return showQueue($, ctx, GLOBAL)
}

// /aside q: every queue of no project that holds an idea, in the order countQueues gives.
async function showQueues($: Engine, ctx: Context): Promise<string> {
  return showWhileWorking($, ctx, { kind: 'queues' }, await queuesListed($), 'the queues')
}

// The queues as /aside q lists them, and the list pane too.
export async function queuesListed($: Engine): Promise<Listed> {
  const queues = await countQueues($)
  if (queues.length === 0) {
    return 'The global list and the named queues are empty. Start a message with "+@work" to add an idea to the queue work, or with "+g" to the global list.'
  }
  const rows = []
  for (const one of queues) {
    const ideas = await loadIdeas($, one.name)
    // One every project sees but this project's own of its name hides here.
    const isHidden = await isHiddenHere($, one.name)
    const note = isLocalQueue(one.name) ? "this project's" : isHidden ? `for every project; hidden here by this project's @${one.name}` : ''
    rows.push({ name: queueName(one.name), ideas: ideas.map(idea => idea.entry), note })
  }
  const isCut = rows.some(one => one.ideas.length > QUEUE_PEEK)

  return { sections: queuesSections(rows), ...(isCut ? { note: '/aside q NAME lists all the ideas of a queue.' } : {}) }
}

// /aside q NAME here N ...: ideas from a queue to the end of this project's queue, into the
// project's queue first, so a failure between the writes leaves an idea in both, never in neither.
async function moveHere($: Engine, ctx: Context, name: string, numbers: readonly number[]): Promise<string> {
  const ideas = await shownIdeas($, ctx, name)
  if (ideas.length === 0) {
    return emptyOf(name)
  }
  if (!numbers.every(n => isPlace(n, ideas.length))) {
    return askPlaces(name, ideas.length, numbers.length)
  }
  const chosen = [...new Set(numbers)].map(n => ideas[n - 1]!)
  const keys = await projectKeys($)
  const stored = await loadEntries($, keys.queue)
  // Typed as "+g idea" or "+@work idea", it is "+ idea" in the queue, so /aside edit keeps it here.
  const moved = chosen.map(({ entry }) => ({ text: entry.text, at: entry.at, kind: entry.kind, ...(entry.raw ? { raw: entry.raw.replace(/^\+(?:g|@[A-Za-z0-9_-]{1,20})(?=\s)/, '+') } : {}) }))
  const fresh = moved.filter(entry => !stored.some(one => isSame(one, entry)))
  await saveEntries($, keys.queue, [...stored, ...fresh])
  await forgetGlobalIdeas($, chosen.map(idea => idea.key))
  await refreshBand($)

  return `${sayIdeas('Moved here', moved)} (${stored.length + fresh.length} waiting)`
}

// /aside q NAME add N ...: ideas from this project's queue to the end of a queue of no project,
// onto it first, for the same reason. A comment stays in the queue.
async function moveToQueue($: Engine, ctx: Context, name: string, numbers: readonly number[]): Promise<string> {
  const keys = await projectKeys($)
  const list = inOrder(await loadEntries($, keys.queue), ctx.settings.order)
  if (list.length === 0) {
    return 'The queue is empty.'
  }
  if (!numbers.every(n => isPlace(n, list.length))) {
    return `Give ${numbers.length === 1 ? 'a number' : 'numbers'} from 1 to ${list.length}, as /aside shows them.`
  }
  const comments = [...new Set(numbers)].filter(n => list[n - 1]!.kind !== 'idea')
  if (comments.length > 0) {
    return `Only ideas go to ${nameOf(name)}; ${comments.join(', ')} ${comments.length === 1 ? 'is a comment' : 'are comments'}.`
  }
  const chosen = [...new Set(numbers)].map(n => list[n - 1]!)
  const there = await loadIdeas($, name)
  const now = await $.clock.now()
  const fresh = chosen.filter(entry => !there.some(idea => isSame(idea.entry, entry)))
  await addIdeas($, name, fresh.map(({ text, at }, i) => ({ text, at, kind: 'idea' as const, order: now + i / 1000 })))
  await saveEntries($, keys.queue, inOrder(list.filter(entry => !chosen.includes(entry)), ctx.settings.order))
  await refreshBand($)

  const said = sayIdeas(`Moved to ${nameOf(name)}`, chosen)

  return name !== GLOBAL && there.length === 0 ? `${said}. ${nameOf(name)} is ${newQueueNote(queueName(name), isLocalQueue(name))}.` : said
}

async function removeIdeas($: Engine, ctx: Context, name: string, numbers: readonly number[]): Promise<string> {
  const ideas = await shownIdeas($, ctx, name)
  if (ideas.length === 0) {
    return emptyOf(name)
  }
  if (!numbers.every(n => isPlace(n, ideas.length))) {
    return askPlaces(name, ideas.length, numbers.length)
  }
  const chosen = [...new Set(numbers)].map(n => ideas[n - 1]!)
  await forgetGlobalIdeas($, chosen.map(idea => idea.key))
  await refreshBand($)

  return sayIdeas(`Removed from ${nameOf(name)}`, chosen.map(idea => idea.entry))
}

// /aside q NAME pop [N]: the idea in the prompt box, ready to send, and off its queue once it
// is there; the first one unless named.
async function popIdea($: Engine, ctx: Context, name: string, n?: number): Promise<string> {
  const ideas = await shownIdeas($, ctx, name)
  if (ideas.length === 0) {
    return emptyOf(name)
  }
  const at = n ?? 1
  if (!isPlace(at, ideas.length)) {
    return askPlaces(name, ideas.length, 1)
  }
  const idea = ideas[at - 1]!
  const filled = await $.prompt.fill({ text: idea.entry.text, mode: 'insert' })
  if (!filled.isFilled) {
    return `The prompt box cannot take it now; the idea stays ${inName(name)}.`
  }
  await forgetGlobalIdeas($, [idea.key])
  await refreshBand($)

  return `In the prompt box, ready to send: ${shortenText(idea.entry.text, 60)}`
}

// /aside q NAME edit N: as /aside edit does for the queue, the idea leaves its queue for the
// prompt box with its mark, "+@work idea", and the next message that is one such idea takes its
// place again, or moves it to the queue it names. The record is written before the idea leaves,
// so a failure between keeps it in both.
async function editIdea($: Engine, ctx: Context, name: string, n: number): Promise<string> {
  const ideas = await shownIdeas($, ctx, name)
  if (ideas.length === 0) {
    return emptyOf(name)
  }
  if (!isPlace(n, ideas.length)) {
    return askPlaces(name, ideas.length, 1)
  }
  const idea = ideas[n - 1]!
  const filled = await $.prompt.fill({ text: `${markOf(name)} ${idea.entry.text}`, mode: 'insert' })
  if (!filled.isFilled) {
    return `The prompt box cannot take it now; the idea stays ${inName(name)}.`
  }
  await saveGlobalEditing($, idea)
  await forgetGlobalIdeas($, [idea.key])
  await refreshBand($)
  const which = name === GLOBAL ? `Global idea ${n}` : `Idea ${n} of ${nameOf(name)}`

  return `${which} is in the prompt box: change it and press Enter; it goes back to place ${n}.`
}

// /aside q NAME move N M: one write, to the idea moved, which takes a place between its new
// neighbours, so other sessions adding meanwhile are left alone. Neighbours too close to
// leave room between them are placed again, one after another, so the order shown is the
// order stored.
async function moveIdea($: Engine, ctx: Context, name: string, from: number, to: number): Promise<string> {
  const ideas = await shownIdeas($, ctx, name)
  if (ideas.length < 2) {
    return 'Nothing to move.'
  }
  if (!isPlace(from, ideas.length) || !isPlace(to, ideas.length)) {
    return `Give two places from 1 to ${ideas.length}: ${commandOf(name)} move 3 1`
  }
  const [idea] = ideas.splice(from - 1, 1)
  ideas.splice(to - 1, 0, idea!)
  const stored = ctx.settings.order === 'newest' ? [...ideas].reverse() : ideas
  const i = stored.indexOf(idea!)
  const before = i > 0 ? rankOf(stored[i - 1]!) : undefined
  const after = i < stored.length - 1 ? rankOf(stored[i + 1]!) : undefined
  const order = before !== undefined && after !== undefined ? (before + after) / 2 : before !== undefined ? before + 1 : after! - 1
  const fits = (before === undefined || before < order) && (after === undefined || order < after)
  if (fits) {
    await saveGlobalIdea($, { key: idea!.key, entry: { ...idea!.entry, order } })
  } else {
    const start = rankOf(stored[0]!)
    for (const [k, one] of stored.entries()) {
      if (rankOf(one) !== start + k) await saveGlobalIdea($, { key: one.key, entry: { ...one.entry, order: start + k } })
    }
  }

  return listingText([namedSection(queueName(name), ideas.map(one => one.entry), isLocalQueue(name))])
}

// /aside q NAME clear: what the queue holds is kept for /aside q NAME undo first, and its ideas
// deleted after, so a failure between the writes loses nothing.
async function clearQueue($: Engine, name: string): Promise<string> {
  const ideas = await loadIdeas($, name)
  if (ideas.length === 0) {
    return emptyOf(name)
  }
  await saveCleared($, name, ideas)
  await forgetGlobalIdeas($, ideas.map(idea => idea.key))
  await refreshBand($)

  return `Cleared ${formatCount(ideas.length, 'idea')} from ${nameOf(name)}. ${commandOf(name)} undo brings ${ideas.length === 1 ? 'it' : 'them'} back.`
}

// /aside q NAME undo: what this session's last clear of that queue took, back under the keys it
// had while they are free; each idea's record goes as soon as it is back, so an undo cut short,
// run again, brings each idea back once.
async function undoClear($: Engine, name: string): Promise<string> {
  const cleared = await loadCleared($, name)
  if (cleared.length === 0) {
    return `Nothing to bring back to ${nameOf(name)}.`
  }
  for (const { record, idea } of cleared) {
    await restoreIdea($, idea)
    await forgetCleared($, record)
  }
  const band = await refreshBand($)
  const count = name === GLOBAL ? `${band.global ?? 0} global` : `${band.named?.find(one => one.name === queueName(name))?.count ?? 0} ${inName(name)}`

  return `Brought back ${formatCount(cleared.length, 'idea')} to ${nameOf(name)} (${count}).`
}

// /aside q NAME rename NEW: every idea to the queue NEW, which may hold ideas already and then
// holds both, in the order their places give. Each is written there first and taken from here
// after, so a failure between leaves an idea in both, and running it again moves the rest.
async function renameQueue($: Engine, name: string, to: string): Promise<string> {
  if (name === GLOBAL) {
    return `The global list keeps its name; /aside g here N ... moves its ideas into this queue.`
  }
  if (!NAME_PATTERN.test(to)) {
    return `A queue's name has letters, digits, "-" and "_", at most 20 of them: ${commandOf(name)} rename ${queueName(name) === 'office' ? 'work' : 'office'}`
  }
  // A queue keeps whom it is for: this project's stays this project's.
  const target = isLocalQueue(name) ? `.${to.toLowerCase()}` : to.toLowerCase()
  if (target === name) {
    return `${nameOf(name)} has that name already.`
  }
  const ideas = await loadIdeas($, name)
  if (ideas.length === 0) {
    return emptyOf(name)
  }
  // The new name has to mean this queue here after: under a name this project reads as a queue
  // of the other scope, the ideas would hide that queue, or be hidden by it.
  const seen = await resolveQueue($, to.toLowerCase(), isLocalQueue(name))
  if (seen !== target) {
    return isLocalQueue(seen)
      ? `@${queueName(seen)} is this project's, and ${nameOf(name)} is for every project: /aside q ${queueName(name)} local moves it here first, or pick another name.`
      : `@${queueName(seen)} is for every project, and ${nameOf(name)} is this project's: /aside q ${queueName(name)} global shares it first, or pick another name.`
  }
  const there = await loadIdeas($, target)
  const fresh = ideas.filter(idea => !there.some(one => isSame(one.entry, idea.entry)))
  await addIdeas($, target, fresh.map(idea => idea.entry))
  await moveSessionRecords($, name, target)
  await forgetGlobalIdeas($, ideas.map(idea => idea.key))
  await refreshBand($)
  const moved = formatCount(ideas.length, 'idea')

  return there.length === 0
    ? `${nameOf(name)} is now ${nameOf(target)}: ${moved}.`
    : `Moved ${moved} from ${nameOf(name)} to ${nameOf(target)}, which now has ${there.length + fresh.length}.`
}

const isNumbers = (words: readonly string[]) => words.length > 0 && words.every(word => /^\d+$/.test(word))

// /aside q NAME local | global: the queue of that name for every project goes to this project
// alone, or this project's goes to every project, joining the queue of its name there; so a
// queue this project's own hides here is taken in too. Each idea is written there first and taken
// from here after, so a failure between leaves it in both, and running it again moves the rest.
async function setScope($: Engine, name: string, isLocal: boolean): Promise<string> {
  const typed = queueName(name)
  if (name === GLOBAL) {
    return 'The global list is for every project; /aside q NAME local keeps a named queue for this one.'
  }
  const source = isLocal ? typed : `.${typed}`
  const target = isLocal ? `.${typed}` : typed
  const ideas = await loadIdeas($, source)
  const there = await loadIdeas($, target)
  if (ideas.length === 0) {
    if (there.length > 0) {
      return isLocal ? `@${typed} is this project's already.` : `@${typed} is for every project already.`
    }
    return `@${typed} holds no ideas yet: "+@${typed}" starts it, for every project or, with the newQueues setting on local, for this one.`
  }
  const fresh = ideas.filter(idea => !there.some(one => isSame(one.entry, idea.entry)))
  await addIdeas($, target, fresh.map(idea => idea.entry))
  // What undo and an edit hold of the queue go with it, so neither brings back the one it left.
  await moveSessionRecords($, source, target)
  await forgetGlobalIdeas($, ideas.map(idea => idea.key))
  await refreshBand($)
  const moved = formatCount(ideas.length, 'idea')
  if (there.length > 0) {
    return `Moved ${moved} into ${isLocal ? `this project's @${typed}` : `@${typed} for every project`}, which now has ${there.length + fresh.length}.`
  }

  return isLocal ? `@${typed} is now this project's, with ${moved}; other projects no longer see it.` : `@${typed} is now for every project, with ${moved}.`
}

// /aside q NAME ...: a command on that queue when the words have its shape, else an idea for it,
// as "+@NAME TEXT" would.
async function runQueue($: Engine, ctx: Context, name: string, args: readonly string[]): Promise<string> {
  const [first, ...rest] = args
  const verb = first?.toLowerCase()
  const numbers = rest.map(Number)
  if (verb === undefined) {
    return showQueue($, ctx, name)
  }
  if (verb === 'here' && isNumbers(rest)) {
    return moveHere($, ctx, name, numbers)
  }
  if (verb === 'add' && isNumbers(rest)) {
    return moveToQueue($, ctx, name, numbers)
  }
  if ((verb === 'remove' || verb === 'rm') && isNumbers(rest)) {
    return removeIdeas($, ctx, name, numbers)
  }
  if (verb === 'edit' && rest.length === 1 && isNumbers(rest)) {
    return editIdea($, ctx, name, numbers[0]!)
  }
  if (verb === 'pop' && (rest.length === 0 || (rest.length === 1 && isNumbers(rest)))) {
    return popIdea($, ctx, name, numbers[0])
  }
  if ((verb === 'move' || verb === 'mv') && rest.length === 2 && isNumbers(rest)) {
    return moveIdea($, ctx, name, numbers[0]!, numbers[1]!)
  }
  if (verb === 'clear' && rest.length === 0) {
    return clearQueue($, name)
  }
  if (verb === 'undo' && rest.length === 0) {
    return undoClear($, name)
  }
  if (verb === 'import' && rest.length > 0 && MARKDOWN_PATH.test(rest.join(' '))) {
    return importFile($, rest.join(' '), name)
  }
  if ((verb === 'local' || verb === 'global') && rest.length === 0) {
    return setScope($, name, verb === 'local')
  }
  if (verb === 'rename' && rest.length === 1) {
    return renameQueue($, name, rest[0]!.replace(/^@/, ''))
  }

  return (await addEntries($, ctx, `${markOf(name)} ${args.join(' ')}`, undefined, undefined, { report: 'none' })) ?? showQueue($, ctx, name)
}

// /aside g ...: the same commands on the global list.
export async function runGlobal($: Engine, ctx: Context, args: readonly string[]): Promise<string> {
  return runQueue($, ctx, GLOBAL, args)
}

// /aside q [NAME ...]: the queues for no project, or one of them, by its name with or without
// its "@", in any letter case.
export async function runNamed($: Engine, ctx: Context, args: readonly string[]): Promise<string> {
  const [first, ...rest] = args
  if (first === undefined) {
    return showQueues($, ctx)
  }
  const name = first.replace(/^@/, '')
  if (!NAME_PATTERN.test(name)) {
    return 'A queue\'s name has letters, digits, "-" and "_", at most 20 of them: /aside q work'
  }

  return runQueue($, ctx, await resolveQueue($, name.toLowerCase(), ctx.settings.newQueues === 'local'), rest)
}
