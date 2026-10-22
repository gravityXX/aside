import type { EngineInterface as Engine } from 'claude-code'

import type { Entry, Plan, Step } from '../../types'
import type { Asker, Context, PlanModel } from '../context'
import { describeCount, leftOutSection, listingText, planSection } from '../core/listing'
import { PLANNER_SYSTEM, TITLE_SYSTEM, planningRequest, readPlanReply, readTitleReply, tidyPrompt } from '../core/prompts'
import { isSameEntry } from '../core/entries'
import { describeError, formatCount } from '../core/text'
import { changePlan } from '../io/plan'
import { readQueue, takePlanned } from '../io/queue'
import { loadPlan, loadTagIds, projectKeys, refreshBand, tagId } from '../io/store'
import type { Keys } from '../io/store'
import { parseSteps, parseUnclear, savePlanSteps } from './plantool'
import { openListPane, tagsInFiles } from './queue'
import { runningHere } from './steps'

// Organizing the queue without asking Claude in this conversation: one call to a model of its
// own, and the small model that names a step made of a long entry. Both answer outside any turn,
// so both check that what they were given is still there before anything is saved (3.16).

// A title for each of `named`, from the small model reading the text typed alone, never what
// was copied, as tidying does. A step keeps the one it has when no reply comes in time, or when
// the plan no longer holds it, under that title, by then.
async function nameSteps($: Engine, ctx: Context, named: readonly { step: Step; text: string }[]): Promise<void> {
  for (const { step, text } of named) {
    const reply = await $.model
      .complete({ model: 'haiku', system: TITLE_SYSTEM, prompt: tidyPrompt(text), maxTokens: 100, timeoutMs: 10_000 })
      .catch(() => undefined)
    const title = reply?.isAnswered ? readTitleReply(reply.text) : undefined
    if (title === undefined) continue
    await changePlan($, plan => {
      const now = plan.steps.findIndex(one => one.prompt === step.prompt && one.title === step.title)
      if (now >= 0) plan.steps[now] = { ...plan.steps[now]!, title }
    })
    await refreshBand($)
  }
}

// Names them in the background, where /aside idle waits for tidying too.
function nameLater($: Engine, ctx: Context, named: readonly { step: Step; text: string }[]) {
  if (!ctx.settings.tidy || named.length === 0) return
  const work = nameSteps($, ctx, named).catch(() => undefined)
  ctx.session.tidies.add(work)
  void work.then(() => ctx.session.tidies.delete(work))
}

// The steps made of an entry whose text is long, once the run has started.
export function nameStepsLater($: Engine, ctx: Context, steps: readonly Step[], entries: readonly Entry[]) {
  nameLater(
    $,
    ctx,
    steps.flatMap((step, i) => (step.title.length > 60 && entries[i]?.text.trim() ? [{ step, text: entries[i].text }] : [])),
  )
}

// A step made of an idea whose title is its text cut short, as an earlier release cut it at 50
// characters, or one no reply named when it ran: its prompt starts with the idea's text, and only
// that first paragraph, without where it was typed, goes to the model. Each is asked about once
// in this process, whatever the model answers.
const OLD_CUT = / \((?:while you worked on .*|branch [^)]*)\)$/

export async function nameOldSteps($: Engine, ctx: Context): Promise<void> {
  const plan = await loadPlan($, (await projectKeys($)).plan)
  const named = plan.steps.flatMap(step => {
    const start = step.title.slice(0, -1).trimEnd()
    const isCut = step.title.endsWith('…') && step.prompt.startsWith(start) && !ctx.session.namedOld.has(step.prompt)
    return isCut ? [{ step, text: step.prompt.split('\n\n')[0]!.replace(OLD_CUT, '') }] : []
  })
  if (ctx.settings.tidy) for (const { step } of named) ctx.session.namedOld.add(step.prompt)
  nameLater($, ctx, named)
}

const PLANNER_NAMES: Record<Exclude<PlanModel, 'session'>, string> = { sonnet: 'Sonnet', haiku: 'Haiku', opus: 'Opus' }

// Why a planner's call gave no plan, in a few words.
const describeNoPlan = (reply: Awaited<ReturnType<Engine['model']['complete']>> | string): string => {
  if (typeof reply === 'string') {
    return reply
  }
  if (reply.isAnswered) {
    return 'its answer held no plan'
  }
  switch (reply.reason) {
    case 'aborted':
      return 'it took too long'
    case 'empty-reply':
      return 'it answered nothing'
    default:
      return `the call failed${reply.status ? ` (${reply.status})` : ''}`
  }
}

// Whether the queue still holds what a planner was given: every entry in it as it was, and no
// tag handed over since. The plan is checked as it is saved (savePlanSteps).
async function isAsGiven($: Engine, keys: Keys, items: readonly Entry[]): Promise<boolean> {
  // In the order the store keeps: only whether each entry is there counts.
  const queue = await readQueue($, 'oldest')
  const handed = new Set(await loadTagIds($, keys.handed))
  const isThere = (item: Entry) =>
    item.isTag ? !handed.has(tagId(item)) : queue.some(entry => isSameEntry(entry, item))

  return items.every(isThere)
}

// /aside plan on a model of its own: one call outside the conversation organizes the queue
// and the new tags, and the plugin saves the plan it answers with. The queue stays as it is
// until then. Commands may run while it thinks, so the plan is saved only over the queue and
// the plan it was given; anything changed, nothing is saved. While a step runs here, the
// planner adds to the plan, which may then go on meanwhile: a step ending, the next one
// starting, a pause or a stop change nothing it was given. One planner at a time, set before
// anything is awaited, so two quick asks never both run.
export async function planOutside($: Engine, ctx: Context, model: Exclude<PlanModel, 'session'>, asker: Asker): Promise<string> {
  const name = PLANNER_NAMES[model]
  if (ctx.session.planner) {
    return `${PLANNER_NAMES[ctx.session.planner]} is still organizing the queue.`
  }
  ctx.session.planner = model
  try {
    // An entry tidied while the planner thinks would not be found again as it was given.
    await Promise.allSettled([...ctx.session.tidies])
    const keys = await projectKeys($)
    const before = await loadPlan($, keys.plan)
    const isAdding = (await runningHere($, before)) !== undefined
    const items = [...(await readQueue($, ctx.settings.order)), ...(await tagsInFiles($, true))]
    if (items.length === 0) {
      return 'The queue is empty. Start a message with "+" to add an idea, or "+?" to comment on a copied fragment.'
    }
    if (asker !== 'command') $.ui.toast(`${name} is organizing ${describeCount(items)}.`)
    // What the person sees of an answer outside a command goes into the transcript too, so the
    // planner's questions stay there.
    const answerWith = (line: string, text: string) => {
      if (asker === 'command') return text
      $.ui.log(text)
      return line
    }

    const ask = { model, system: PLANNER_SYSTEM, prompt: planningRequest(items, keys.root, before, isAdding), maxTokens: 16_000, effort: 'medium' as const, timeoutMs: 180_000 }
    const reply = await $.model.complete(ask).catch((error: unknown) => describeError(error))
    const answer = typeof reply !== 'string' && reply.isAnswered ? readPlanReply(reply.text) : undefined
    const unclear = answer ? parseUnclear(answer.unclear, items.length) : null
    const left = (unclear ?? []).map(({ item, question }) => ({ entry: items[item - 1]!, question }))
    if (answer && unclear && left.length > 0 && Array.isArray(answer.steps) && answer.steps.length === 0) {
      const asks = `${name} made no plan, and asks about ${formatCount(left.length, 'entry')}; the queue is as it was.`
      return answerWith(asks, `${asks}\n\n${listingText([leftOutSection(left, keys.root)])}`)
    }
    const steps = parseSteps(answer?.steps)
    if (steps === null || unclear === null) {
      const why = answer && steps !== null ? 'the items it left out were named wrong' : describeNoPlan(reply)
      return `${name} gave no plan (${why}); the queue is as it was.`
    }
    const changed = `The queue or the plan changed while ${name} planned; nothing was saved. /aside plan tries again.`
    if (!(await isAsGiven($, keys, items))) {
      return changed
    }

    // The plan first: should the queue's write fail after it, the entries are in both, not lost.
    let plan: Plan | undefined
    try {
      plan = await savePlanSteps($, ctx, steps, isAdding ? 'add' : 'replan', before)
    } catch (error) {
      return `Could not save ${name}'s plan (${describeError(error)}); the queue is as it was.`
    }
    if (!plan) {
      return changed
    }
    const kept = await takePlanned($, items.filter(item => !left.some(one => one.entry === item))).then(
      () => '',
      (error: unknown) => ` Its entries stay in the queue too (${describeError(error)}).`,
    )
    await refreshBand($, (await tagsInFiles($, true)).length)
    const sections = [planSection(plan, await $.clock.now())!, ...(left.length > 0 ? [leftOutSection(left, keys.root)] : [])]
    const text = listingText(sections)
    // While Claude works, the command's own text shows only after the turn: the pane, or else
    // the transcript, shows the plan now.
    if (asker === 'command' && ctx.session.isRunning) {
      const opened = await openListPane($, ctx, { kind: 'queue' }).catch((error: unknown) => ({ isPlaced: false, reason: describeError(error) }))
      if (!opened.isPlaced) $.ui.log(text)
    }
    const line = left.length > 0 ? `${sections[0]!.title}; ${formatCount(left.length, 'entry')} left in the queue, with a question.` : sections[0]!.title

    return kept ? answerWith(`${line.replace(/\.?$/, '.')}${kept}`, `${text}\n\n${kept.trim()}`) : answerWith(line, text)
  } finally {
    delete ctx.session.planner
  }
}
