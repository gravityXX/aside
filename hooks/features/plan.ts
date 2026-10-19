import type { Args, CatchHandler, EngineInterface as Engine, Hook, MatchedHook } from 'claude-code'

import type { Entry, Plan, Step } from '../../types'
import type { Context, PlanModel } from '../context'
import { inOrder, KINDS } from '../core/entries'
import { describeCount, formatPlace, leftOutSection, listingText, planSection } from '../core/listing'
import {
  entryPrompt,
  isOwnPrompt,
  isPlanningPrompt,
  PLAN_SAVED_NOTE,
  PLANNER_SYSTEM,
  planningPrompt,
  planningRequest,
  readPlanReply,
  readStepResult,
  sendPrompt,
  STEP_MARKER,
  stepPrompt,
} from '../core/prompts'
import type { StepMode } from '../core/prompts'
import { describeError, describeFailure, formatCount, formatDuration, shortenText } from '../core/text'
import {
  bringBackTake,
  forgetAnsweredTake,
  giveBackItems,
  loadEntries,
  loadHanded,
  loadPlan,
  projectKeys,
  refreshBand,
  savePlan,
  takeChosen,
  takeForHandOver,
  takePlanned,
  tagId,
} from '../io/store'
import type { Keys } from '../io/store'
import { openListPane, tagsInFiles } from './queue'

// Submits the prompt `compose` gives as the person's own, or nothing when it gives none. It
// goes out from a timer, since neither a command's hook nor a turn's end may submit one while
// it holds the turn; `onFail` hears why, once, when a hook beneath drops it, the engine
// refuses it or composing it fails. Nothing here is left to throw unheard in the timer.
function submitLater($: Engine, compose: () => Promise<string | undefined>, onFail: (why: string) => Promise<void>) {
  $.clock.after(50, async () => {
    let why: string | undefined
    try {
      const prompt = await compose()
      if (prompt === undefined) {
        return
      }
      const sent = await $.prompt.submit({ text: prompt, asUser: true })
      if ('drop' in sent && sent.drop !== undefined) why = sent.drop
    } catch (error) {
      why = describeError(error)
    }
    if (why !== undefined) {
      await onFail(why).catch(error => $.ui.toast(`Could not send its prompt (${why}), nor set things back: ${describeError(error)}`))
    }
  })
}

// Who asked for a hand-over: a command answers with the whole text, while the pane's button
// and the end of Claude's answer say one line in a toast.
export type Asker = 'command' | 'pane' | 'answer'

// Hands the queue and the new file tags over: as one planning prompt ('plan'), or as it
// is, to be done now ('send'). A prompt dropped beneath gives everything back. Nothing goes
// while a step of the plan runs here, since the prompt would land in the middle of it. With
// planModel on a model, 'plan' goes to that model instead (planOutside).
export async function handOverQueue($: Engine, ctx: Context, mode: 'plan' | 'send', asker: Asker = 'command'): Promise<string> {
  if (mode === 'plan' && ctx.settings.planModel !== 'session') {
    return planOutside($, ctx, ctx.settings.planModel, asker)
  }
  const keys = await projectKeys($)
  const running = await runningHere($, await loadPlan($, keys.plan))
  if (running) {
    return running
  }
  const stored = await loadEntries($, keys.queue)
  // Tags already handed over stay in their files until a step removes them; they are
  // not handed over again.
  const tags = await tagsInFiles($, true)
  const all = [...inOrder(stored, ctx.settings.order), ...tags]
  if (all.length === 0) {
    return 'The queue is empty. Start a message with "+" to add an idea, or "+?" to comment on a copied fragment.'
  }

  // The entries leave the queue as they are handed over; /aside undo brings them back.
  const { giveBack } = await takeForHandOver($, keys, stored, tags)
  await refreshBand($, 0)
  const pending = (await loadPlan($, keys.plan)).steps.filter(step => !step.isDone)
  const text = mode === 'plan' ? planningPrompt(all, keys.root, pending, ctx.session.planTool) : sendPrompt(all, keys.root)
  const planning = mode === 'plan' ? { items: all, isSaved: false } : undefined
  if (planning) ctx.session.planning = planning
  submitLater($, async () => text, async why => {
    if (planning && ctx.session.planning === planning) delete ctx.session.planning
    await giveBack()
    await refreshBand($, tags.length)
    $.ui.toast(`Could not hand the queue over (${why}); the entries are back in it`)
  })

  return `${mode === 'plan' ? 'Organizing' : 'Sending'} ${describeCount(all)}.`
}

// Lets go of the step `index` that never started (its prompt was dropped or refused),
// unless something else took its place meanwhile.
async function releaseStep($: Engine, index: number, why: string) {
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  if (plan.active?.step === index && plan.active.turnId === undefined) {
    delete plan.active
    await savePlan($, keys.plan, plan)
    await refreshBand($)
  }
  $.ui.toast(`Could not send step ${index + 1} of the plan: ${why}`)
}

// The step that follows `index` in its run: the first of `then` when /aside run named the
// steps, the next one not done in a chain, none for a step run on its own.
function nextInRun(steps: readonly Step[], index: number, isChain: boolean, then: readonly number[] | undefined): number {
  if (then !== undefined) {
    return then[0] ?? -1
  }

  return isChain ? steps.findIndex((step, i) => i > index && !step.isDone) : -1
}

function stepMode(steps: readonly Step[], index: number, isChain: boolean, then: readonly number[] | undefined): StepMode {
  if (!isChain && then === undefined) {
    return 'alone'
  }

  return nextInRun(steps, index, isChain, then) >= 0 ? 'more' : 'last'
}

// Runs step `index` of the plan; with `isChain`, the next one not done follows when it ends,
// with `then`, those steps in that order. A stop that lands before its prompt goes out keeps
// it from going out at all.
async function startStep($: Engine, ctx: Context, index: number, isChain: boolean, then?: readonly number[]) {
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  // A step that starts, the run going on or a new one, ends any pause.
  delete plan.paused
  plan.active = { step: index, isChain, sessionId: await $.session.id(), ...(then ? { then: [...then] } : {}) }
  await savePlan($, keys.plan, plan)
  await refreshBand($)
  submitLater(
    $,
    async () => {
      const now = await loadPlan($, keys.plan)
      const isStillDue = now.active?.step === index && now.active.turnId === undefined

      return isStillDue ? stepPrompt(plan.steps, index, stepMode(plan.steps, index, isChain, then), ctx.session.waitTool) : undefined
    },
    why => releaseStep($, index, why),
  )
}

// What /aside run adds when another session's step was running: this one takes it over.
const takeOverNote = (plan: Plan) => (plan.active ? ` (another session had step ${plan.active.step + 1} running; this one takes over)` : '')

// Why nothing new starts while a step of the plan runs in this session, if one does.
async function runningHere($: Engine, plan: Plan): Promise<string | undefined> {
  return plan.active && plan.active.sessionId === (await $.session.id())
    ? `Step ${plan.active.step + 1} is running. /aside stop stops after it.`
    : undefined
}

// Where a paused run goes on: the next of its own steps still to do, or -1 with none left.
function pausedNext(plan: Plan): { index: number; then: number[] | undefined } {
  const paused = plan.paused!
  const then = paused.then?.filter(i => plan.steps[i] !== undefined && !plan.steps[i].isDone)
  if (then !== undefined) {
    return { index: then[0] ?? -1, then: then.slice(1) }
  }

  return { index: paused.isChain ? plan.steps.findIndex((step, i) => i > paused.step && !step.isDone) : -1, then: undefined }
}

// /aside run on the saved plan: a paused run goes on as it was to, any other run starts from
// the first step not done. Undefined when every step is done, so the queue runs entry by
// entry instead.
export async function runPlan($: Engine, ctx: Context): Promise<string | undefined> {
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  const running = await runningHere($, plan)
  if (running) {
    return running
  }
  const note = takeOverNote(plan)
  if (plan.paused) {
    const { isChain } = plan.paused
    const { index, then } = pausedNext(plan)
    if (index >= 0) {
      await startStep($, ctx, index, isChain, then)
      const steps = then === undefined ? '' : `: steps ${[index, ...then].map(i => i + 1).join(', ')}`

      return `Going on with the plan from step ${index + 1}${steps}. /aside stop stops after the current one.${note}`
    }
  }
  const first = plan.steps.findIndex(step => !step.isDone)
  if (first < 0) {
    return undefined
  }
  await startStep($, ctx, first, true)
  const left = plan.steps.filter(step => !step.isDone).length

  return `Running the plan: ${formatCount(left, 'step')}, from step ${first + 1}. /aside stop stops after the current one.${note}`
}

// An entry as a step of a plan of its own.
const entryStep = (entry: Entry, root: string): Step => ({
  title: shortenText(entry.text || formatPlace(entry, root) || KINDS[entry.kind].label, 50),
  prompt: entryPrompt(entry, root),
})

async function runChosenSteps($: Engine, ctx: Context, plan: Plan, chosen: readonly number[]): Promise<string> {
  if (!chosen.every(n => n >= 1 && n <= plan.steps.length)) {
    return `Give ${chosen.length === 1 ? 'a step' : 'steps'} from 1 to ${plan.steps.length}, as /aside shows them.`
  }
  const note = takeOverNote(plan)
  const [first, ...rest] = chosen.map(n => n - 1)
  await startStep($, ctx, first!, false, rest.length > 0 ? rest : undefined)

  return chosen.length === 1
    ? `Running step ${chosen[0]}: ${plan.steps[first!]!.title}${note}`
    : `Running steps ${chosen.join(', ')} one by one. /aside stop stops after the current one.${note}`
}

async function runChosenEntries($: Engine, ctx: Context, keys: Keys, plan: Plan, chosen: readonly number[]): Promise<string> {
  const stored = await loadEntries($, keys.queue)
  const list = inOrder(stored, ctx.settings.order)
  if (list.length === 0) {
    return 'The queue is empty.'
  }
  if (!chosen.every(n => n >= 1 && n <= list.length)) {
    return `Give ${chosen.length === 1 ? 'an entry' : 'entries'} from 1 to ${list.length}, as /aside shows them.`
  }
  const note = takeOverNote(plan)
  const entries = chosen.map(n => list[n - 1]!)
  const steps = entries.map(entry => entryStep(entry, keys.root))
  await takeChosen($, keys, stored, entries)
  await savePlan($, keys.plan, { steps })
  await refreshBand($)
  await startStep($, ctx, 0, true)

  return entries.length === 1
    ? `Running entry ${chosen[0]}: ${steps[0]!.title}${note}`
    : `Running entries ${chosen.join(', ')} one by one. /aside stop stops after the current one.${note}`
}

// /aside run N [M ...]: the steps with those numbers while the plan has steps to do, else the
// entries with those numbers, one after another in the order given. A number means what
// /aside shows.
export async function runChosen($: Engine, ctx: Context, numbers: readonly number[]): Promise<string> {
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  const running = await runningHere($, plan)
  if (running) {
    return running
  }
  const chosen = [...new Set(numbers)]

  return plan.steps.some(step => !step.isDone) ? runChosenSteps($, ctx, plan, chosen) : runChosenEntries($, ctx, keys, plan, chosen)
}

// /aside run with no plan to run: every entry, and every new tag, becomes a step of its own.
export async function runEntries($: Engine, ctx: Context): Promise<string> {
  const keys = await projectKeys($)
  const note = takeOverNote(await loadPlan($, keys.plan))
  const stored = await loadEntries($, keys.queue)
  const tags = await tagsInFiles($, true)
  const all = [...inOrder(stored, ctx.settings.order), ...tags]
  if (all.length === 0) {
    return 'Nothing to run: the queue is empty and the plan is done.'
  }
  const steps = all.map(entry => entryStep(entry, keys.root))
  await takeForHandOver($, keys, stored, tags)
  await savePlan($, keys.plan, { steps })
  await refreshBand($, 0)
  await startStep($, ctx, 0, true)

  return `Running ${formatCount(steps.length, 'entry')} one by one. /aside stop stops after the current one.${note}`
}

// Stops the plan: a step that has not started yet does not start; a running one finishes
// and is the last. A step another session left behind is let go here.
export async function stopPlan($: Engine): Promise<string> {
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  const active = plan.active
  if (!active && plan.paused) {
    delete plan.paused
    await savePlan($, keys.plan, plan)
    await refreshBand($)

    return 'Dropped the paused run. /aside run starts the plan again from its first step to do.'
  }
  if (!active) {
    return 'Nothing is running.'
  }
  const n = active.step + 1
  let text: string
  if (active.turnId === undefined || active.sessionId !== (await $.session.id())) {
    delete plan.active
    text = `The plan stopped before step ${n}.`
  } else {
    active.isChain = false
    delete active.then
    text = `The plan stops after step ${n}.`
  }
  await savePlan($, keys.plan, plan)
  await refreshBand($)

  return text
}

const parseSteps = (value: unknown): Step[] | null => {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }
  const steps = value.map(one => {
    const step = one as { title?: unknown; prompt?: unknown }

    return typeof step.title === 'string' && typeof step.prompt === 'string' && step.prompt.trim() !== ''
      ? { title: step.title.trim() || 'Step', prompt: step.prompt.trim() }
      : null
  })

  return steps.every(step => step !== null) ? (steps as Step[]) : null
}

type Unclear = { item: number; question: string }

// The items Claude left out of the steps, by their number in the planning prompt (1 to
// `count`), each with its question; an item named twice counts once. Null when malformed.
const parseUnclear = (value: unknown, count: number): Unclear[] | null => {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    return null
  }
  const unclear = value.map(one => {
    const { item, question } = one as { item?: unknown; question?: unknown }

    return Number.isInteger(item) && (item as number) >= 1 && (item as number) <= count && typeof question === 'string' && question.trim() !== ''
      ? { item: item as number, question: question.trim() }
      : null
  })
  if (!unclear.every(one => one !== null)) {
    return null
  }

  return (unclear as Unclear[]).filter((one, i, all) => all.findIndex(other => other.item === one.item) === i)
}

// The tool the model saves a plan with; returns its full name as the engine registered it.
export async function registerPlanTool($: Engine): Promise<string> {
  const registered = await $.tool.register({
    name: 'plan',
    description:
      "Saves the step plan you just proposed for the user's queue (the aside plugin), so the user can run it with /aside run. " +
      'Call it only when the aside plugin asked you to organize the queue. Each step: a short title and a prompt that stands on its own. ' +
      'Items you left out of the steps go in unclear, and back to the queue.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, prompt: { type: 'string' } },
            required: ['title', 'prompt'],
          },
        },
        unclear: {
          type: 'array',
          description: 'the items that look done, contradictory or unclear: each by its number in the queue, with your question',
          items: {
            type: 'object',
            properties: { item: { type: 'integer' }, question: { type: 'string' } },
            required: ['item', 'question'],
          },
        },
      },
      required: ['steps'],
    },
    isDeferred: false,
  })

  return registered.tool
}

type PlanToolCall = Parameters<MatchedHook<'tool.call', { readonly tool: RegExp }>>

export async function savePlanFromTool(ctx: Context, $: Engine, e: PlanToolCall[1], next: PlanToolCall[2]) {
  if (e.tool !== ctx.session.planTool) {
    return next(e)
  }
  const input = e as unknown as { steps?: unknown; unclear?: unknown }
  const steps = parseSteps(input.steps)
  if (steps === null) {
    return { deny: 'steps must be a non-empty list of { title, prompt }, each prompt non-empty' }
  }
  // The items are known by number only in the turn that organizes them; a plan saved
  // in any other turn has none to leave out.
  const planning = ctx.session.planning?.turnId === ctx.session.turnId ? ctx.session.planning : undefined
  const items = planning?.items ?? []
  const unclear = planning ? parseUnclear(input.unclear, items.length) : []
  if (unclear === null) {
    return { deny: `unclear must list items by their number in the queue, from 1 to ${items.length}, each with a question` }
  }
  const keys = await projectKeys($)
  const old = await loadPlan($, keys.plan)
  if (old.active && old.active.sessionId === (await $.session.id())) {
    return { deny: `step ${old.active.step + 1} of the current plan is running; the user stops it with /aside stop first` }
  }
  // The items left out go back before the plan is saved, so a plan is never saved with items
  // still missing; a call made again after a failure gives back none twice.
  const left = unclear.map(({ item, question }) => ({ entry: items[item - 1]!, question }))
  await giveBackItems($, keys, left.map(one => one.entry))
  const plan = await savePlanSteps($, keys, steps)
  if (planning) planning.isSaved = true
  await refreshBand($, left.some(one => one.entry.isTag) ? (await tagsInFiles($, true)).length : undefined)
  const sections = [planSection(plan)!, ...(left.length > 0 ? [leftOutSection(left, keys.root)] : [])]

  return { result: listingText(sections), context: [PLAN_SAVED_NOTE] }
}

// Saves `steps` as the plan. A plan with steps still to do keeps those done, first, as the
// planning prompt said; a plan run to its end makes way for the new one.
async function savePlanSteps($: Engine, keys: Keys, steps: readonly Step[]): Promise<Plan> {
  const old = await loadPlan($, keys.plan)
  const done = old.steps.some(step => !step.isDone) ? old.steps.filter(step => step.isDone) : []
  const plan: Plan = { steps: [...done, ...steps] }
  await savePlan($, keys.plan, plan)

  return plan
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

// Whether the queue and the plan are still what a planner was given: every entry in the
// queue as it was, no tag handed over since, and the plan the same, a step run or a plan saved
// meanwhile included.
async function isAsGiven($: Engine, keys: Keys, before: Plan, items: readonly Entry[]): Promise<boolean> {
  const queue = await loadEntries($, keys.queue)
  const handed = new Set(await loadHanded($, keys.handed))
  const isThere = (item: Entry) =>
    item.isTag ? !handed.has(tagId(item)) : queue.some(entry => entry.at === item.at && entry.kind === item.kind && entry.text === item.text)

  return items.every(isThere) && JSON.stringify(await loadPlan($, keys.plan)) === JSON.stringify(before)
}

// /aside plan on a model of its own: one call outside the conversation organizes the queue
// and the new tags, and the plugin saves the plan it answers with. The queue stays as it is
// until then. Commands may run while it thinks, so the plan is saved only over the queue and
// the plan it was given; anything changed, nothing is saved. One planner at a time, set
// before anything is awaited, so two quick asks never both run.
async function planOutside($: Engine, ctx: Context, model: Exclude<PlanModel, 'session'>, asker: Asker): Promise<string> {
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
    const running = await runningHere($, before)
    if (running) {
      return running
    }
    const items = [...inOrder(await loadEntries($, keys.queue), ctx.settings.order), ...(await tagsInFiles($, true))]
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

    const pending = before.steps.filter(step => !step.isDone)
    const ask = { model, system: PLANNER_SYSTEM, prompt: planningRequest(items, keys.root, pending), maxTokens: 16_000, effort: 'medium' as const, timeoutMs: 180_000 }
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
    if (!(await isAsGiven($, keys, before, items))) {
      return `The queue or the plan changed while ${name} planned; nothing was saved. /aside plan tries again.`
    }

    // The plan first: should the queue's write fail after it, the entries are in both, not lost.
    let plan: Plan
    try {
      plan = await savePlanSteps($, keys, steps)
    } catch (error) {
      return `Could not save ${name}'s plan (${describeError(error)}); the queue is as it was.`
    }
    const kept = await takePlanned($, keys, items.filter(item => !left.some(one => one.entry === item))).then(
      () => '',
      (error: unknown) => ` Its entries stay in the queue too (${describeError(error)}).`,
    )
    await refreshBand($, (await tagsInFiles($, true)).length)
    const sections = [planSection(plan)!, ...(left.length > 0 ? [leftOutSection(left, keys.root)] : [])]
    const text = listingText(sections)
    // While Claude works, the command's own text shows only after the turn: the pane, or else
    // the transcript, shows the plan now.
    if (asker === 'command' && ctx.session.isRunning) {
      const opened = await openListPane($).catch((error: unknown) => ({ isPlaced: false, reason: describeError(error) }))
      if (!opened.isPlaced) $.ui.log(text)
    }
    const line = left.length > 0 ? `${sections[0]!.title}; ${formatCount(left.length, 'entry')} left in the queue, with a question.` : sections[0]!.title

    return kept ? answerWith(`${line.replace(/\.?$/, '.')}${kept}`, `${text}\n\n${kept.trim()}`) : answerWith(line, text)
  } finally {
    delete ctx.session.planner
  }
}

// The tool a step pauses the plan with when it needs the person's answer before the next one.
export async function registerWaitTool($: Engine): Promise<string> {
  const registered = await $.tool.register({
    name: 'wait',
    description:
      "Pauses the user's aside plan after the step you are working on, so the user can answer you before the next step is sent. " +
      "Call it only from a step of the aside plan that needs the user's answer or decision, then end your reply with the question.",
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'what you need from the user, in a few words' } },
      required: ['reason'],
    },
    isDeferred: false,
  })

  return registered.tool
}

// The step finishes as usual; the next one waits for /aside run.
export async function pausePlanFromTool(ctx: Context, $: Engine, e: PlanToolCall[1], next: PlanToolCall[2]) {
  if (e.tool !== ctx.session.waitTool) {
    return next(e)
  }
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  const active = plan.active
  if (!active || active.turnId === undefined || active.sessionId !== (await $.session.id())) {
    return { deny: 'no step of the aside plan is running; call this tool only from a step of the plan' }
  }
  const reason = (e as unknown as { reason?: unknown }).reason
  active.pausedFor = typeof reason === 'string' && reason.trim() !== '' ? shortenText(reason, 120) : 'it needs your answer'
  await savePlan($, keys.plan, plan)

  return { result: 'The plan pauses after this step. End your reply with your question; the user continues with /aside run.' }
}

// The turn of a plan step: remember which, so its end runs the next one.
async function bindStepTurn($: Engine, turnId: string) {
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  if (plan.active && plan.active.turnId === undefined && plan.active.sessionId === (await $.session.id())) {
    plan.active.turnId = turnId
    await savePlan($, keys.plan, plan)
  }
}

type TurnStart = Parameters<Hook<'turn.start'>>

export async function onTurnStart(ctx: Context, $: Engine, e: TurnStart[1], next: TurnStart[2]) {
  if (e.agentId === undefined) {
    ctx.session.turnId = e.turnId
    ctx.session.isRunning = true
    ctx.session.isOwnTurn = isOwnPrompt(e.text)
    if (e.text.includes(STEP_MARKER)) await bindStepTurn($, e.turnId)
    const { planning } = ctx.session
    if (planning && planning.turnId === undefined && isPlanningPrompt(e.text)) planning.turnId = e.turnId
  }

  return next(e)
}

type TurnEndReason = Args<'turn.complete'>['reason']

// The step that ran in this turn ends: after an answer it is done, keeping what the answer
// said it did and how long it ran, and the next one starts when the plan runs as a chain;
// otherwise the plan stops there.
async function finishStep($: Engine, ctx: Context, keys: Keys, plan: Plan, e: TurnComplete[1]) {
  const active = plan.active!
  delete plan.active
  if (e.reason === 'answer') {
    const step = plan.steps[active.step]!
    const result = readStepResult(e.answer)
    plan.steps[active.step] = { ...step, isDone: true, ms: e.durationMs, ...(result ? { result } : {}) }
    const after = nextInRun(plan.steps, active.step, active.isChain, active.then)
    if (after >= 0 && active.pausedFor !== undefined) {
      plan.paused = { step: active.step, reason: active.pausedFor, isChain: active.isChain, ...(active.then ? { then: active.then } : {}) }
    }
    await savePlan($, keys.plan, plan)
    if (after >= 0 && active.pausedFor === undefined) {
      await startStep($, ctx, after, active.isChain, active.then?.slice(1))
    } else if (after >= 0) {
      $.ui.toast(`Plan paused after step ${active.step + 1}: ${active.pausedFor}. /aside continue goes on.`)
    } else if (plan.steps.every(one => one.isDone)) {
      const ms = plan.steps.reduce((sum, one) => sum + (one.ms ?? 0), 0)
      $.ui.toast(`Plan done: ${formatCount(plan.steps.length, 'step')}${ms > 0 ? ` in ${formatDuration(ms)}` : ''}`)
    } else {
      $.ui.toast(`Step ${active.step + 1} done`)
    }
  } else {
    await savePlan($, keys.plan, plan)
    $.ui.toast(`Plan stopped: step ${active.step + 1} ${e.reason === 'aborted' ? 'was interrupted' : 'did not finish'}`)
  }
  await refreshBand($)
}

// The turn that was to organize the queue ended with no plan saved, answered or cut short:
// what it was handed goes back to the queue, so nothing is lost.
async function giveBackUnplanned($: Engine, keys: Keys) {
  const { entries, tagIds } = await bringBackTake($, keys)
  if (entries.length === 0 && tagIds.length === 0) {
    return
  }
  await refreshBand($, (await tagsInFiles($, true)).length)
  const back = [entries.length > 0 ? formatCount(entries.length, 'entry') : '', tagIds.length > 0 ? formatCount(tagIds.length, 'tag') : '']
  $.ui.toast(`No plan was saved: ${back.filter(Boolean).join(' and ')} back in the queue.`)
}

// Files the agents wrote may hold new tags; then the queue goes out by itself when the
// setting says so, never after the plugin's own turn. A plan running elsewhere, or a saved
// plan with steps still to do, is the person's to finish first: the queue waits.
async function handOverAfterAnswer($: Engine, ctx: Context, plan: Plan, reason: TurnEndReason) {
  const now = await refreshBand($, (await tagsInFiles($, true)).length)
  const waiting = now.ideas + now.comments + now.tags
  const isPending = plan.steps.some(step => !step.isDone)
  const { afterAnswer } = ctx.settings
  if (!plan.active && waiting > 0 && afterAnswer !== 'wait' && reason === 'answer' && !ctx.session.isOwnTurn && !isPending) {
    if (afterAnswer === 'plan' && ctx.settings.planModel !== 'session') {
      // A planner's call may take a while, and the turn's end does not wait for it: the plan's
      // title, or why there is none, comes as a toast once it is saved.
      $.clock.after(0, async () => {
        $.ui.toast(await handOverQueue($, ctx, 'plan', 'answer').catch((error: unknown) => `Could not organize the queue: ${describeError(error)}`))
      })
      return
    }
    $.ui.toast(await handOverQueue($, ctx, afterAnswer))
  }
}

type TurnComplete = Parameters<Hook<'turn.complete'>>

export async function onTurnEnd(ctx: Context, $: Engine, e: TurnComplete[1], next: TurnComplete[2]) {
  const done = await next(e)
  if (e.agentId !== undefined) {
    return done
  }
  ctx.session.isRunning = false

  const keys = await projectKeys($)
  const { planning } = ctx.session
  if (planning?.turnId === e.turnId) {
    delete ctx.session.planning
    if (!planning.isSaved) await giveBackUnplanned($, keys)
  }
  // Claude has answered what the plugin handed over, so undo has nothing to bring back.
  if (ctx.session.isOwnTurn && e.reason === 'answer') {
    await forgetAnsweredTake($, keys)
  }
  const plan = await loadPlan($, keys.plan)
  const isThisStep = plan.active?.turnId === e.turnId && plan.active.sessionId === (await $.session.id())
  if (isThisStep) {
    await finishStep($, ctx, keys, plan, e)
  } else {
    await handOverAfterAnswer($, ctx, plan, e.reason)
  }

  return done
}

// What the person hears when one of the plan's hooks fails, in place of the engine's own
// words: the reason, and what still stands.
type PlanToolFailed = Parameters<CatchHandler<MatchedHook<'tool.call', { readonly tool: RegExp }>>>

export function planToolFailed($: Engine, e: PlanToolFailed[1], next: PlanToolFailed[2]) {
  return next.called ? next(e) : { deny: `aside could not save the plan (${describeFailure(next.error)}); the plan was not saved, so call the tool again` }
}

export function waitToolFailed($: Engine, e: PlanToolFailed[1], next: PlanToolFailed[2]) {
  return next.called ? next(e) : { deny: `aside could not pause the plan (${describeFailure(next.error)}); call the tool again` }
}

type TurnStartFailed = Parameters<CatchHandler<Hook<'turn.start'>>>

export function turnStartFailed($: Engine, e: TurnStartFailed[1], next: TurnStartFailed[2]) {
  $.ui.toast(`Could not note the start of this turn (${describeFailure(next.error)}); a running plan may not go on by itself`)

  return next(e)
}

type TurnEndFailed = Parameters<CatchHandler<Hook<'turn.complete'>>>

export async function turnEndFailed($: Engine, e: TurnEndFailed[1], next: TurnEndFailed[2]) {
  const done = await next(e)
  $.ui.toast(`Could not finish its work at the end of this turn (${describeFailure(next.error)}); /aside shows where the queue and the plan stand`)

  return done
}
