import type { Args, CatchHandler, EngineInterface as Engine, Hook, MatchedHook } from 'claude-code'

import type { Entry, Plan, Step } from '../../types'
import type { Context, PlanModel } from '../context'
import { inOrder, KINDS } from '../core/entries'
import { describeCount, formatPlace, leftOutSection, listingText, planSection } from '../core/listing'
import {
  entryPrompt,
  isAddingPrompt,
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

const EMPTY_QUEUE = 'The queue is empty. Start a message with "+" to add an idea, or "+?" to comment on a copied fragment.'

// Changes the plan as it is stored now, once every change this session asked for before is
// saved, so a step that ends and a planner adding steps meanwhile never save over each other
// (2.9). `change` edits the plan it is given and answers what the caller needs; the plan is
// saved only when it changed. A change never waits for another one, which would wait for it.
async function changePlan<T>($: Engine, ctx: Context, change: (plan: Plan) => T | Promise<T>): Promise<T> {
  const done = ctx.session.planWrites.then(async () => {
    const keys = await projectKeys($)
    const plan = await loadPlan($, keys.plan)
    const before = JSON.stringify(plan)
    const value = await change(plan)
    if (JSON.stringify(plan) !== before) await savePlan($, keys.plan, plan)

    return value
  })
  ctx.session.planWrites = done.catch(() => undefined)

  return done
}

// Hands the queue and the new file tags over: as one planning prompt ('plan'), or as it
// is, to be done now ('send'). A prompt dropped beneath gives everything back. Nothing goes
// while a step of the plan runs here, since the prompt would land in the middle of it: a plan
// is organized once the step ends (planAfterStep). With planModel on a model, 'plan' goes to
// that model instead, at once (planOutside).
export async function handOverQueue($: Engine, ctx: Context, mode: 'plan' | 'send', asker: Asker = 'command'): Promise<string> {
  if (mode === 'plan' && ctx.settings.planModel !== 'session') {
    return planOutside($, ctx, ctx.settings.planModel, asker)
  }
  // A second planning prompt, sent before the turn that adds to the plan has ended, would be
  // organized against the plan as it was, and save over the steps the first one adds.
  if (mode === 'plan' && ctx.session.planning?.isAdding) {
    return 'Claude has yet to organize what the last /aside plan handed over; /aside plan works again once it has.'
  }
  const keys = await projectKeys($)
  const running = await runningHere($, await loadPlan($, keys.plan))
  if (running && mode === 'plan') {
    return planAfterStep($, ctx, asker)
  }
  if (running) {
    return running
  }

  return (await handOver($, ctx, mode, false)).text
}

// Whether there is anything to hand over: an entry, or a tag not handed over yet.
async function hasItems($: Engine): Promise<boolean> {
  const keys = await projectKeys($)

  return (await loadEntries($, keys.queue)).length > 0 || (await tagsInFiles($, true)).length > 0
}

// /aside plan while a step runs here, for Claude in this conversation, who cannot be asked in
// the middle of the step: its end hands the queue over to be added to the plan, and the run
// waits for /aside continue. A step that ended meanwhile leaves the queue to go at once.
async function planAfterStep($: Engine, ctx: Context, asker: Asker): Promise<string> {
  if (!(await hasItems($))) {
    return EMPTY_QUEUE
  }
  const me = await $.session.id()
  const step = await changePlan($, ctx, plan => {
    if (plan.active?.sessionId !== me) return undefined
    plan.active.isPlanningAfter = true
    return plan.active.step + 1
  })
  if (step === undefined) {
    return handOverQueue($, ctx, 'plan', asker)
  }
  const text = `Step ${step} is running; once it ends, Claude organizes the queue into steps after the plan's own, and /aside continue goes on.`
  // While Claude works, the command's own text shows only after the turn.
  if (asker === 'command' && ctx.session.isRunning) $.ui.log(text)

  return text
}

// The hand-over itself, and whether its prompt is on its way; with isAdding, a planning prompt
// that adds the queue to the plan as it stands, every step kept. The plan keeps that mark
// (adding), bound to the prompt's turn by its text as it starts, so the plan tool adds the steps
// it saves after the plan's own even when a reload has lost what this session knew.
async function handOver($: Engine, ctx: Context, mode: 'plan' | 'send', isAdding: boolean): Promise<{ text: string; isHanded: boolean }> {
  const keys = await projectKeys($)
  const stored = await loadEntries($, keys.queue)
  // Tags already handed over stay in their files until a step removes them; they are
  // not handed over again.
  const tags = await tagsInFiles($, true)
  const all = [...inOrder(stored, ctx.settings.order), ...tags]
  if (all.length === 0) {
    return { text: EMPTY_QUEUE, isHanded: false }
  }

  // The entries leave the queue as they are handed over; /aside undo brings them back.
  const { giveBack } = await takeForHandOver($, keys, stored, tags)
  await refreshBand($, 0)
  const me = await $.session.id()
  const plan = await changePlan($, ctx, plan => {
    if (mode === 'plan' && isAdding) plan.adding = { after: plan.steps.length, sessionId: me }
    return structuredClone(plan)
  })
  const text = mode === 'plan' ? planningPrompt(all, keys.root, plan, isAdding, ctx.session.planTool) : sendPrompt(all, keys.root)
  const planning = mode === 'plan' ? { items: all, isSaved: false, isAdding } : undefined
  if (planning) ctx.session.planning = planning
  submitLater($, async () => text, async why => {
    if (planning && ctx.session.planning === planning) delete ctx.session.planning
    await giveBack()
    await refreshBand($, tags.length)
    $.ui.toast(`Could not hand the queue over (${why}); the entries are back in it`)
  })

  return { text: `${mode === 'plan' ? 'Organizing' : 'Sending'} ${describeCount(all)}.`, isHanded: true }
}

// Lets go of the step `index` that never started (its prompt was dropped or refused),
// unless something else took its place meanwhile.
async function releaseStep($: Engine, ctx: Context, index: number, why: string) {
  const gone = await changePlan($, ctx, plan => {
    const active = plan.active
    if (active?.step !== index || active.turnId !== undefined) return undefined
    delete plan.active
    return active
  })
  if (gone) await refreshBand($)
  $.ui.toast(`Could not send step ${index + 1} of the plan: ${why}${await organizeHint($, gone)}`)
}

// What a step that never ran, or was cut short, adds to its message when /aside plan was to
// organize the queue once it ended: that /aside plan does it now, if there is anything to.
async function organizeHint($: Engine, active: Plan['active'] | undefined): Promise<string> {
  return active?.isPlanningAfter && (await hasItems($)) ? '; /aside plan organizes the queue' : ''
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
  const sessionId = await $.session.id()
  const steps = await changePlan($, ctx, plan => {
    // A step that starts, the run going on or a new one, ends any pause.
    delete plan.paused
    plan.active = { step: index, isChain, sessionId, ...(then ? { then: [...then] } : {}) }
    return structuredClone(plan.steps)
  })
  await refreshBand($)
  sendStep($, ctx, steps, index, isChain, then)
}

// Sends the prompt of step `index`, which the plan holds as running, unless a stop or another
// run took its place before it goes out.
function sendStep($: Engine, ctx: Context, steps: readonly Step[], index: number, isChain: boolean, then: readonly number[] | undefined) {
  submitLater(
    $,
    async () => {
      const now = await loadPlan($, (await projectKeys($)).plan)
      const isStillDue = now.active?.step === index && now.active.turnId === undefined

      return isStillDue ? stepPrompt(steps, index, stepMode(steps, index, isChain, then), ctx.session.waitTool) : undefined
    },
    why => releaseStep($, ctx, index, why),
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
  await changePlan($, ctx, plan => replaceSteps(plan, steps))
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
  await changePlan($, ctx, plan => replaceSteps(plan, steps))
  await refreshBand($, 0)
  await startStep($, ctx, 0, true)

  return `Running ${formatCount(steps.length, 'entry')} one by one. /aside stop stops after the current one.${note}`
}

// Stops the plan: a step that has not started yet does not start; a running one finishes
// and is the last. A step another session left behind is let go here.
export async function stopPlan($: Engine, ctx: Context): Promise<string> {
  const me = await $.session.id()
  const text = await changePlan($, ctx, async plan => {
    const active = plan.active
    if (!active && plan.paused) {
      delete plan.paused
      return 'Dropped the paused run. /aside run starts the plan again from its first step to do.'
    }
    if (!active) {
      return undefined
    }
    const n = active.step + 1
    if (active.turnId === undefined || active.sessionId !== me) {
      delete plan.active
      return `The plan stopped before step ${n}${await organizeHint($, active)}.`
    }
    active.isChain = false
    delete active.then
    return `The plan stops after step ${n}.`
  })
  if (text === undefined) {
    return 'Nothing is running.'
  }
  await refreshBand($)

  return text
}

// The plan made of `steps` alone, in place of the one it was.
function replaceSteps(plan: Plan, steps: readonly Step[]) {
  plan.steps = [...steps]
  delete plan.active
  delete plan.paused
  delete plan.adding
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
  const me = await $.session.id()
  // Steps added after the plan's own leave a step that runs as it is.
  if (old.active && old.active.sessionId === me && !isAddingTurn(old, me, ctx.session.turnId)) {
    return { deny: `step ${old.active.step + 1} of the current plan is running; the user stops it with /aside stop first` }
  }
  // The items left out go back before the plan is saved, so a plan is never saved with items
  // still missing; a call made again after a failure gives back none twice.
  const left = unclear.map(({ item, question }) => ({ entry: items[item - 1]!, question }))
  await giveBackItems($, keys, left.map(one => one.entry))
  // Given no plan to check against, the steps are always saved.
  const plan = (await savePlanSteps($, ctx, steps, isAddingTurn(old, me, ctx.session.turnId) ? 'tool' : 'replan'))!
  if (planning) planning.isSaved = true
  await refreshBand($, left.some(one => one.entry.isTag) ? (await tagsInFiles($, true)).length : undefined)
  const sections = [planSection(plan)!, ...(left.length > 0 ? [leftOutSection(left, keys.root)] : [])]

  return { result: listingText(sections), context: [PLAN_SAVED_NOTE] }
}

// Whether `now` is still the plan `given` was, only further on: the same steps, while what is
// done, running or paused may have moved.
const isSamePlan = (given: Plan, now: Plan) =>
  now.steps.length === given.steps.length && now.steps.every((step, i) => step.title === given.steps[i]!.title && step.prompt === given.steps[i]!.prompt)

// Whether `turnId` is the turn of this session's prompt that adds to the plan.
const isAddingTurn = (plan: Plan, me: string, turnId: string | undefined) =>
  plan.adding?.sessionId === me && plan.adding.turnId !== undefined && plan.adding.turnId === turnId

// How steps saved now meet the plan there: 'add', a planner's answer while a step ran, goes
// after every step; 'tool', the plan tool's save in the turn that adds, goes after the steps
// its hand-over marked (adding.after); 'replan' merges with the steps to do.
type SaveMode = 'add' | 'tool' | 'replan'

// Saves `steps` as the plan. Added, they go after the plan's own steps, which stay as they
// stood, a run going on or paused included; saved again in the same planning turn, they take
// the place of those the first save added. A replan keeps the steps done, first, as the planning
// prompt said. Either way, a plan run to its end makes way for the new one. With `given`, the
// plan a planner was given, nothing is saved, and undefined comes back, unless the plan is still
// that one: only further on while adding to it, else just as it was.
async function savePlanSteps($: Engine, ctx: Context, steps: readonly Step[], mode: SaveMode, given?: Plan): Promise<Plan | undefined> {
  return changePlan($, ctx, plan => {
    if (given && !(mode === 'add' ? isSamePlan(given, plan) : JSON.stringify(plan) === JSON.stringify(given))) {
      return undefined
    }
    const base = mode === 'add' ? plan.steps.length : mode === 'tool' ? plan.adding?.after : undefined
    const kept = plan.steps.slice(0, base ?? plan.steps.length)
    const isLeft = plan.active !== undefined || kept.some(step => !step.isDone)
    if (base !== undefined && isLeft) {
      plan.steps = [...kept, ...steps]
    } else {
      replaceSteps(plan, [...(isLeft ? kept.filter(step => step.isDone) : []), ...steps])
    }

    return structuredClone(plan)
  })
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
  const queue = await loadEntries($, keys.queue)
  const handed = new Set(await loadHanded($, keys.handed))
  const isThere = (item: Entry) =>
    item.isTag ? !handed.has(tagId(item)) : queue.some(entry => entry.at === item.at && entry.kind === item.kind && entry.text === item.text)

  return items.every(isThere)
}

// /aside plan on a model of its own: one call outside the conversation organizes the queue
// and the new tags, and the plugin saves the plan it answers with. The queue stays as it is
// until then. Commands may run while it thinks, so the plan is saved only over the queue and
// the plan it was given; anything changed, nothing is saved. While a step runs here, the
// planner adds to the plan, which may then go on meanwhile: a step ending, the next one
// starting, a pause or a stop change nothing it was given. One planner at a time, set before
// anything is awaited, so two quick asks never both run.
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
    const isAdding = (await runningHere($, before)) !== undefined
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
  const me = await $.session.id()
  const reason = (e as unknown as { reason?: unknown }).reason
  const isPaused = await changePlan($, ctx, plan => {
    const active = plan.active
    if (!active || active.turnId === undefined || active.sessionId !== me) return false
    active.pausedFor = typeof reason === 'string' && reason.trim() !== '' ? shortenText(reason, 120) : 'it needs your answer'
    return true
  })

  return isPaused
    ? { result: 'The plan pauses after this step. End your reply with your question; the user continues with /aside run.' }
    : { deny: 'no step of the aside plan is running; call this tool only from a step of the plan' }
}

// The turn of a plan step: remember which, so its end runs the next one.
async function bindStepTurn($: Engine, ctx: Context, turnId: string) {
  const me = await $.session.id()
  await changePlan($, ctx, plan => {
    if (plan.active && plan.active.turnId === undefined && plan.active.sessionId === me) plan.active.turnId = turnId
  })
}

// The turn of this session's prompt that adds to the plan, known by its text, so a reload
// since the hand-over still finds it.
async function bindAddingTurn($: Engine, ctx: Context, turnId: string) {
  const me = await $.session.id()
  await changePlan($, ctx, plan => {
    if (plan.adding?.sessionId === me && plan.adding.turnId === undefined) plan.adding.turnId = turnId
  })
}

type TurnStart = Parameters<Hook<'turn.start'>>

export async function onTurnStart(ctx: Context, $: Engine, e: TurnStart[1], next: TurnStart[2]) {
  if (e.agentId === undefined) {
    ctx.session.turnId = e.turnId
    ctx.session.isRunning = true
    ctx.session.isOwnTurn = isOwnPrompt(e.text)
    if (e.text.includes(STEP_MARKER)) await bindStepTurn($, ctx, e.turnId)
    if (isAddingPrompt(e.text)) await bindAddingTurn($, ctx, e.turnId)
    const { planning } = ctx.session
    if (planning && planning.turnId === undefined && isPlanningPrompt(e.text)) planning.turnId = e.turnId
  }

  return next(e)
}

type TurnEndReason = Args<'turn.complete'>['reason']

// Why a run waits after a step that /aside plan asked to organize the queue after.
const PLANNING_PAUSE = 'to organize the queue'

// The step that ran in this turn ends: after an answer it is done, keeping what the answer
// said it did and how long it ran, and the next one starts when the plan runs as a chain;
// otherwise the plan stops there. The plan is read again as it is changed, since a planner may
// have added steps since the turn's end read it, and the next step is marked running in that
// same change, so nothing in between finds the run with no step. When /aside plan asked during
// the step, and there is something to organize, the queue goes to Claude now, and a run with
// steps left waits for it.
async function finishStep($: Engine, ctx: Context, e: TurnComplete[1]) {
  const me = await $.session.id()
  const end = await changePlan($, ctx, async plan => {
    const active = plan.active
    if (active?.turnId !== e.turnId || active.sessionId !== me) {
      return undefined
    }
    delete plan.active
    if (e.reason !== 'answer') {
      return { active, after: -1, reason: undefined, isPlanning: false, hint: await organizeHint($, active), steps: plan.steps }
    }
    const step = plan.steps[active.step]!
    const result = readStepResult(e.answer)
    plan.steps[active.step] = { ...step, isDone: true, ms: e.durationMs, ...(result ? { result } : {}) }
    const after = nextInRun(plan.steps, active.step, active.isChain, active.then)
    const isPlanning = active.isPlanningAfter === true && (await hasItems($))
    const reason = active.pausedFor ?? (isPlanning ? PLANNING_PAUSE : undefined)
    if (after >= 0 && reason !== undefined) {
      plan.paused = { step: active.step, reason, isChain: active.isChain, ...(active.then ? { then: active.then } : {}) }
    } else if (after >= 0) {
      const then = active.then?.slice(1)
      delete plan.paused
      plan.active = { step: after, isChain: active.isChain, sessionId: me, ...(then ? { then } : {}) }
    }

    return { active, after, reason, isPlanning, hint: '', steps: structuredClone(plan.steps) }
  })
  if (end === undefined) {
    return
  }
  const { active, after, reason, isPlanning, hint, steps } = end
  const n = active.step + 1
  if (e.reason !== 'answer') {
    $.ui.toast(`Plan stopped: step ${n} ${e.reason === 'aborted' ? 'was interrupted' : 'did not finish'}${hint}`)
  } else if (after >= 0 && reason === undefined) {
    sendStep($, ctx, steps, after, active.isChain, active.then?.slice(1))
  } else if (after >= 0) {
    $.ui.toast(`Plan paused after step ${n}: ${reason}. /aside continue goes on.`)
  } else if (steps.every(one => one.isDone)) {
    const ms = steps.reduce((sum, one) => sum + (one.ms ?? 0), 0)
    $.ui.toast(`Plan done: ${formatCount(steps.length, 'step')}${ms > 0 ? ` in ${formatDuration(ms)}` : ''}`)
  } else {
    $.ui.toast(`Step ${n} done`)
  }
  await refreshBand($)
  if (isPlanning) {
    // A plan with no step left to add after is organized afresh, as /aside plan would.
    const isAdding = steps.some(one => !one.isDone)
    const said = await handOver($, ctx, 'plan', isAdding).catch((error: unknown) => ({ text: `Could not organize the queue (${describeError(error)}).`, isHanded: false }))
    // Only a hand-over that did not go out has more to say than the toast above.
    if (!said.isHanded) $.ui.toast(said.text)
  }
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
  // The plan tool may save again within the turn that adds, each time in place of its last
  // steps; once that turn is over, the steps it added are the plan's own. Read from the plan,
  // so a reload since does not keep the mark.
  const me = await $.session.id()
  await changePlan($, ctx, plan => {
    if (plan.adding?.sessionId === me && plan.adding.turnId === e.turnId) delete plan.adding
  })
  // Claude has answered what the plugin handed over, so undo has nothing to bring back; but
  // a step that ran ahead of a planning prompt still out leaves that prompt's take.
  if (ctx.session.isOwnTurn && e.reason === 'answer' && !ctx.session.planning) {
    await forgetAnsweredTake($, keys)
  }
  const plan = await loadPlan($, keys.plan)
  const isThisStep = plan.active?.turnId === e.turnId && plan.active.sessionId === (await $.session.id())
  if (isThisStep) {
    await finishStep($, ctx, e)
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
