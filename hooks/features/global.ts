import type { EngineInterface as Engine } from 'claude-code'

import type { Entry } from '../../types'
import type { Context } from '../context'
import { inOrder } from '../core/entries'
import { globalSection, listingText } from '../core/listing'
import { formatCount, shortenText } from '../core/text'
import {
  addGlobalIdeas,
  forgetGlobalIdeas,
  loadEntries,
  loadGlobalIdeas,
  projectKeys,
  rankOf,
  refreshBand,
  saveEntries,
  saveGlobalEditing,
  saveGlobalIdea,
} from '../io/store'
import type { GlobalIdea } from '../io/store'
import { addEntries } from './capture'

const EMPTY = 'The global list is empty. Start a message with "+g" to add an idea to it.'

const isPlace = (n: number, length: number) => Number.isInteger(n) && n >= 1 && n <= length

const askPlaces = (length: number, count: number) => `Give ${count === 1 ? 'a number' : 'numbers'} from 1 to ${length}, as /aside g shows them.`

// The same idea in two places: an idea moved half-way, by a command that failed after its
// first write, is not moved a second time when the command runs again.
const isSame = (a: Entry, b: Entry) => a.at === b.at && a.text === b.text

// The global list as /aside g numbers it, in the order setting.
async function shownGlobal($: Engine, ctx: Context): Promise<GlobalIdea[]> {
  const ideas = await loadGlobalIdeas($)

  return ctx.settings.order === 'newest' ? ideas.reverse() : ideas
}

// What a command says it did to several ideas, or to one, by their text.
const sayIdeas = (done: string, entries: readonly Entry[]) =>
  entries.length === 1 ? `${done}: ${shortenText(entries[0]!.text, 60)}` : `${done} ${formatCount(entries.length, 'idea')}: ${entries.map(entry => shortenText(entry.text, 40)).join('; ')}`

// While Claude works, a command's text shows only after the turn: the list goes into the
// transcript at once instead.
export async function showGlobal($: Engine, ctx: Context): Promise<string> {
  const ideas = await shownGlobal($, ctx)
  const text = ideas.length === 0 ? EMPTY : listingText([globalSection(ideas.map(idea => idea.entry))])
  if (!ctx.session.isRunning || ideas.length === 0) {
    return text
  }
  $.ui.log(text)

  return 'Wrote the global list above while Claude was working.'
}

// /aside here N ...: ideas from the global list to the end of this project's queue, into the
// queue first, so a failure between the writes leaves an idea in both, never in neither.
export async function moveHere($: Engine, ctx: Context, numbers: readonly number[]): Promise<string> {
  const ideas = await shownGlobal($, ctx)
  if (ideas.length === 0) {
    return EMPTY
  }
  if (!numbers.every(n => isPlace(n, ideas.length))) {
    return askPlaces(ideas.length, numbers.length)
  }
  const chosen = [...new Set(numbers)].map(n => ideas[n - 1]!)
  const keys = await projectKeys($)
  const stored = await loadEntries($, keys.queue)
  // Typed as "+g idea", it is "+ idea" in the queue, so /aside edit keeps it here.
  const moved = chosen.map(({ entry }) => ({ text: entry.text, at: entry.at, kind: entry.kind, ...(entry.raw ? { raw: entry.raw.replace(/^\+g(?=\s)/, '+') } : {}) }))
  const fresh = moved.filter(entry => !stored.some(one => isSame(one, entry)))
  await saveEntries($, keys.queue, [...stored, ...fresh])
  await forgetGlobalIdeas($, chosen.map(idea => idea.key))
  await refreshBand($)

  return `${sayIdeas('Moved here', moved)} (${stored.length + fresh.length} waiting)`
}

// /aside global N ...: ideas from this project's queue to the end of the global list, onto
// the list first, for the same reason. A comment stays in the queue.
export async function moveToGlobal($: Engine, ctx: Context, numbers: readonly number[]): Promise<string> {
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
    return `Only ideas go to the global list; ${comments.join(', ')} ${comments.length === 1 ? 'is a comment' : 'are comments'}.`
  }
  const chosen = [...new Set(numbers)].map(n => list[n - 1]!)
  const there = await loadGlobalIdeas($)
  const now = await $.clock.now()
  const fresh = chosen.filter(entry => !there.some(idea => isSame(idea.entry, entry)))
  await addGlobalIdeas($, fresh.map(({ text, at }, i) => ({ text, at, kind: 'idea' as const, order: now + i / 1000 })))
  await saveEntries($, keys.queue, inOrder(list.filter(entry => !chosen.includes(entry)), ctx.settings.order))
  await refreshBand($)

  return sayIdeas('Moved to the global list', chosen)
}

async function removeGlobal($: Engine, ctx: Context, numbers: readonly number[]): Promise<string> {
  const ideas = await shownGlobal($, ctx)
  if (ideas.length === 0) {
    return EMPTY
  }
  if (!numbers.every(n => isPlace(n, ideas.length))) {
    return askPlaces(ideas.length, numbers.length)
  }
  const chosen = [...new Set(numbers)].map(n => ideas[n - 1]!)
  await forgetGlobalIdeas($, chosen.map(idea => idea.key))
  await refreshBand($)

  return sayIdeas('Removed from the global list', chosen.map(idea => idea.entry))
}

// /aside g pop [N]: the idea in the prompt box, ready to send, and off the list once it is
// there; the newest one unless named.
async function popGlobal($: Engine, ctx: Context, n?: number): Promise<string> {
  const ideas = await shownGlobal($, ctx)
  if (ideas.length === 0) {
    return EMPTY
  }
  const at = n ?? (ctx.settings.order === 'newest' ? 1 : ideas.length)
  if (!isPlace(at, ideas.length)) {
    return askPlaces(ideas.length, 1)
  }
  const idea = ideas[at - 1]!
  const filled = await $.prompt.fill({ text: idea.entry.text, mode: 'insert' })
  if (!filled.isFilled) {
    return 'The prompt box cannot take it now; the idea stays on the global list.'
  }
  await forgetGlobalIdeas($, [idea.key])
  await refreshBand($)

  return `In the prompt box, ready to send: ${shortenText(idea.entry.text, 60)}`
}

// /aside g edit N: as /aside edit does for the queue, the idea leaves the list for the prompt
// box as "+g idea", and the next message that is one "+g" idea takes its place again. The
// record is written before the idea leaves, so a failure between keeps it in both.
async function editGlobal($: Engine, ctx: Context, n: number): Promise<string> {
  const ideas = await shownGlobal($, ctx)
  if (ideas.length === 0) {
    return EMPTY
  }
  if (!isPlace(n, ideas.length)) {
    return askPlaces(ideas.length, 1)
  }
  const idea = ideas[n - 1]!
  const filled = await $.prompt.fill({ text: `+g ${idea.entry.text}`, mode: 'insert' })
  if (!filled.isFilled) {
    return 'The prompt box cannot take it now; the idea stays on the global list.'
  }
  await saveGlobalEditing($, idea)
  await forgetGlobalIdeas($, [idea.key])
  await refreshBand($)

  return `Global idea ${n} is in the prompt box: change it and press Enter; it goes back to place ${n}.`
}

// /aside g move N M: one write, to the idea moved, which takes a place between its new
// neighbours, so other sessions adding meanwhile are left alone. Neighbours too close to
// leave room between them are placed again, one after another, so the order shown is the
// order stored.
async function moveGlobal($: Engine, ctx: Context, from: number, to: number): Promise<string> {
  const ideas = await shownGlobal($, ctx)
  if (ideas.length < 2) {
    return 'Nothing to move.'
  }
  if (!isPlace(from, ideas.length) || !isPlace(to, ideas.length)) {
    return `Give two places from 1 to ${ideas.length}: /aside g move 3 1`
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

  return listingText([globalSection(ideas.map(one => one.entry))])
}

const isNumbers = (words: readonly string[]) => words.length > 0 && words.every(word => /^\d+$/.test(word))

// /aside g ...: a command on the global list when the words have its shape, else an idea for
// it, as "+g TEXT" would.
export async function runGlobal($: Engine, ctx: Context, args: readonly string[]): Promise<string> {
  const [first, ...rest] = args
  const verb = first?.toLowerCase()
  const numbers = rest.map(Number)
  if (verb === undefined) {
    return showGlobal($, ctx)
  }
  if ((verb === 'remove' || verb === 'rm') && isNumbers(rest)) {
    return removeGlobal($, ctx, numbers)
  }
  if (verb === 'edit' && rest.length === 1 && isNumbers(rest)) {
    return editGlobal($, ctx, numbers[0]!)
  }
  if (verb === 'pop' && (rest.length === 0 || (rest.length === 1 && isNumbers(rest)))) {
    return popGlobal($, ctx, numbers[0])
  }
  if ((verb === 'move' || verb === 'mv') && rest.length === 2 && isNumbers(rest)) {
    return moveGlobal($, ctx, numbers[0]!, numbers[1]!)
  }

  return (await addEntries($, ctx, `+g ${args.join(' ')}`, undefined, undefined, { report: 'none' })) ?? showGlobal($, ctx)
}
