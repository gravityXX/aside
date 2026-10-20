import type { Args, CatchHandler, EngineInterface as Engine, Hook, MatchedHook } from 'claude-code'

import type { Entry, Plan, Step } from '../../types'
import type { Context, PlanModel } from '../context'
import { inOrder, KINDS } from '../core/entries'
import { describeCount, formatPlace, isWaiting, leftOutSection, listingText, planSection } from '../core/listing'
import {
  answerContext,
  closingPrompt,
  entryPrompt,
  isAddingPrompt,
  isOwnPrompt,
  isPlanningPrompt,
  isSummingUp,
  PLAN_SAVED_NOTE,
  PLANNER_SYSTEM,
  planningPrompt,
  planningRequest,
  readPlanReply,
  readStepResult,
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
import { archivePlan } from './history'
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

// Hands the queue and the new file tags over as one planning prompt. A prompt dropped beneath
// gives everything back. Nothing goes while a turn of a step runs here, since the prompt would
// land in the middle of it: the plan is organized once that turn ends (planAfterStep). A step
// that waits for the person has no turn running, so the queue is added to the plan at once,
// the step waiting still. With planModel on a model, it goes to that model instead, at once
// (planOutside).
export async function handOverQueue($: Engine, ctx: Context, asker: Asker = 'command'): Promise<string> {
  if (ctx.settings.planModel !== 'session') {
    return planOutside($, ctx, ctx.settings.planModel, asker)
  }
  // A second planning prompt, sent before the turn that adds to the plan has ended, would be
  // organized against the plan as it was, and save over the steps the first one adds.
  if (ctx.session.planning?.isAdding) {
    return 'Claude has yet to organize what the last /aside plan handed over; /aside plan works again once it has.'
  }
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  const running = await runningHere($, plan)
  if (running && isWaiting(plan.active!)) {
    return (await handOver($, ctx, true)).text
  }
  if (running) {
    return planAfterStep($, ctx, asker)
  }

  return (await handOver($, ctx, false)).text
}

// Whether there is anything to hand over: an entry, or a tag not handed over yet.
async function hasItems($: Engine): Promise<boolean> {
  const keys = await projectKeys($)

  return (await loadEntries($, keys.queue)).length > 0 || (await tagsInFiles($, true)).length > 0
}

// /aside plan while a step runs here, for Claude in this conversation, who cannot be asked in
// the middle of the step: its end hands the queue over to be added to the plan, and the run
// waits for /aside continue. In a step that waits for the person, the end of the turn running
// now hands it over, and the step waits on. A step that ended meanwhile, or a turn of it, leaves
// the queue to go at once.
async function planAfterStep($: Engine, ctx: Context, asker: Asker): Promise<string> {
  if (!(await hasItems($))) {
    return EMPTY_QUEUE
  }
  const me = await $.session.id()
  const step = await changePlan($, ctx, plan => {
    if (plan.active?.sessionId !== me || isWaiting(plan.active)) return undefined
    plan.active.isPlanningAfter = true
    return { n: plan.active.step + 1, isAnswer: isAnswerTurn(plan.active) }
  })
  if (step === undefined) {
    return handOverQueue($, ctx, asker)
  }
  const text = step.isAnswer
    ? `Step ${step.n} is running on your answer; once Claude has answered, it organizes the queue into steps after the plan's own.`
    : `Step ${step.n} is running; once it ends, Claude organizes the queue into steps after the plan's own, and /aside continue goes on.`
  // While Claude works, the command's own text shows only after the turn.
  if (asker === 'command' && ctx.session.isRunning) $.ui.log(text)

  return text
}

// The hand-over itself, and whether its prompt is on its way; with isAdding, a planning prompt
// that adds the queue to the plan as it stands, every step kept. The plan keeps that mark
// (adding), bound to the prompt's turn by its text as it starts, so the plan tool adds the steps
// it saves after the plan's own even when a reload has lost what this session knew.
async function handOver($: Engine, ctx: Context, isAdding: boolean): Promise<{ text: string; isHanded: boolean }> {
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
    if (isAdding) plan.adding = { after: plan.steps.length, sessionId: me }
    return structuredClone(plan)
  })
  const text = planningPrompt(all, keys.root, plan, isAdding, ctx.session.planTool)
  const planning = { items: all, isSaved: false, isAdding }
  ctx.session.planning = planning
  submitLater($, async () => text, async why => {
    if (ctx.session.planning === planning) delete ctx.session.planning
    await giveBack()
    await refreshBand($, tags.length)
    $.ui.toast(`Could not hand the queue over (${why}); the entries are back in it`)
  })

  return { text: `Organizing ${describeCount(all)}.`, isHanded: true }
}

// Lets go of the step `index` that never started (its prompt was dropped or refused),
// unless something else took its place meanwhile. A step that continue ended, whose prompt
// was only to sum the run up, is done as it stands.
async function releaseStep($: Engine, ctx: Context, index: number, why: string) {
  const now = await $.clock.now()
  const gone = await changePlan($, ctx, plan => {
    const active = plan.active
    if (active?.step !== index || active.turnId !== undefined) return undefined
    if (active.isEnding) completeStep(plan, active, active.sessionId, false, now)
    else delete plan.active
    return active
  })
  if (gone) await refreshBand($)
  $.ui.toast(
    gone?.isEnding
      ? `Could not ask Claude to sum the run up (${why}); step ${index + 1} is done as it stands.`
      : `Could not send step ${index + 1} of the plan: ${why}${await organizeHint($, gone)}`,
  )
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
// it from going out at all. With `paused`, the step runs alone out of a paused run, which
// stays paused after it for /aside continue.
async function startStep($: Engine, ctx: Context, index: number, isChain: boolean, then?: readonly number[], paused?: Plan['paused']) {
  const sessionId = await $.session.id()
  const steps = await changePlan($, ctx, plan => {
    // A step that starts, the run going on or a new one, ends any pause but its own.
    if (paused) plan.paused = paused
    else delete plan.paused
    plan.active = { step: index, isChain, sessionId, ...(then ? { then: [...then] } : {}) }
    return structuredClone(plan.steps)
  })
  await refreshBand($)
  sendStep($, ctx, steps, index, isChain, then)
}

// Sends the prompt of step `index`, which the plan holds as running, unless a stop or another
// run took its place before it goes out; with isClosing, the turn that ends the last step of a
// run that waited, and sums the run up.
function sendStep($: Engine, ctx: Context, steps: readonly Step[], index: number, isChain: boolean, then: readonly number[] | undefined, isClosing = false) {
  submitLater(
    $,
    async () => {
      const now = await loadPlan($, (await projectKeys($)).plan)
      const isStillDue = now.active?.step === index && now.active.turnId === undefined
      if (!isStillDue) {
        return undefined
      }

      return isClosing ? closingPrompt(steps, index) : stepPrompt(steps, index, stepMode(steps, index, isChain, then), ctx.session.waitTool)
    },
    why => releaseStep($, ctx, index, why),
  )
}

// What /aside run adds when another session's step was running, or waiting for an answer
// there: this one takes it over.
const takeOverNote = (plan: Plan) =>
  plan.active ? ` (another session had step ${plan.active.step + 1} ${isWaiting(plan.active) ? 'waiting for an answer' : 'running'}; this one takes over)` : ''

// Whether the turn of the step running now took up the person's answer after it waited.
const isAnswerTurn = (active: NonNullable<Plan['active']>) => active.pausedFor !== undefined && active.turnId !== undefined && active.ms !== undefined

// Why nothing new starts while a step of the plan runs in this session, or waits for the
// person in any session, if one does: a step that waits runs nowhere, so any session ends it,
// as /clear moves on to a new session.
async function runningHere($: Engine, plan: Plan): Promise<string | undefined> {
  const active = plan.active
  if (!active) {
    return undefined
  }
  const n = active.step + 1
  if (isWaiting(active)) {
    return active.isAnswered
      ? `Step ${n} waits for /aside continue, which ends it and goes on; /aside stop ends it there.`
      : `Step ${n} waits for your answer; /aside continue ends it and goes on, /aside stop ends it there.`
  }
  if (active.sessionId !== (await $.session.id())) {
    return undefined
  }

  return isAnswerTurn(active)
    ? `Step ${n} is running on your answer; once Claude has answered, /aside continue ends it. /aside stop stops after it.`
    : `Step ${n} is running. /aside stop stops after it.`
}

// Marks the step `active` runs done at `now`, with the time it took and what its last turn
// said, and with isGoingOn, the next step of its run running in that same change, so nothing
// in between finds the run with no step. Answers that step, or -1 with none.
function completeStep(plan: Plan, active: NonNullable<Plan['active']>, me: string, isGoingOn: boolean, now: number): number {
  const step = plan.steps[active.step]!
  // The time by the clock, waits for the person included; never less than its turns took.
  const ms = Math.max(active.ms ?? 0, active.startedAt === undefined ? 0 : now - active.startedAt)
  plan.steps[active.step] = { ...step, isDone: true, ms, doneAt: now, ...(active.result ? { result: active.result } : {}) }
  delete plan.active
  const after = isGoingOn ? nextInRun(plan.steps, active.step, active.isChain, active.then) : -1
  if (after >= 0) {
    const then = active.then?.slice(1)
    delete plan.paused
    plan.active = { step: after, isChain: active.isChain, sessionId: me, ...(then ? { then } : {}) }
  }

  return after
}

// /aside continue on a step that waits for the person, in this session or one before it: it
// is done, and its run goes on here. The last step of a run of several takes one more turn
// first, which sums the run up and then ends it, as it stands if that turn is cut short, with
// nothing after it: steps added meanwhile wait for /aside run. Undefined when no step waits.
async function goOnFromWaiting($: Engine, ctx: Context): Promise<string | undefined> {
  const me = await $.session.id()
  const now = await $.clock.now()
  const end = await changePlan($, ctx, plan => {
    const active = plan.active
    if (!active || !isWaiting(active)) return undefined
    const note = active.sessionId === me ? '' : takeOverNote(plan)
    if (isSummingUp(plan.steps, stepMode(plan.steps, active.step, active.isChain, active.then))) {
      delete active.pausedFor
      delete active.isAnswered
      active.isEnding = true
      // The turn that sums up is this session's, so its start binds to the step here.
      active.sessionId = me
      return { active: structuredClone(active), after: -1, isClosing: true, steps: structuredClone(plan.steps), note }
    }
    const after = completeStep(plan, active, me, true, now)
    return { active, after, isClosing: false, steps: structuredClone(plan.steps), note }
  })
  if (end === undefined) {
    return undefined
  }
  const { active, after, isClosing, steps, note } = end
  const n = active.step + 1
  await refreshBand($)
  if (isClosing) {
    sendStep($, ctx, steps, active.step, active.isChain, active.then, true)
    return `Step ${n} ends here; Claude sums the run up.${note}`
  }
  if (after >= 0) {
    const then = active.then?.slice(1)
    sendStep($, ctx, steps, after, active.isChain, then)
    const named = active.then === undefined ? '' : `: steps ${active.then.map(i => i + 1).join(', ')}`
    return `Step ${n} done; going on with the plan from step ${after + 1}${named}. /aside stop stops after the current one.${note}`
  }

  return `${steps.every(one => one.isDone) ? doneText(steps) : `Step ${n} done.`}${note}`
}

// What the person reads once every step of the plan is done.
const doneText = (steps: readonly Step[]) => {
  const ms = steps.reduce((sum, one) => sum + (one.ms ?? 0), 0)

  return `Plan done: ${formatCount(steps.length, 'step')}${ms >= 1000 ? ` in ${formatDuration(ms)}` : ''}`
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

// /aside run all and continue on the saved plan: a step that waits for the person, in any session, ends and its
// run goes on, a paused run goes on as it was to, any other run starts from the first step not
// done.
// Undefined when every step is done, so the queue runs entry by entry instead.
export async function runPlan($: Engine, ctx: Context): Promise<string | undefined> {
  const going = await goOnFromWaiting($, ctx)
  if (going !== undefined) {
    return going
  }
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
  const { giveBack } = await takeChosen($, keys, stored, entries)
  if (!(await replacePlan($, ctx, steps))) {
    await giveBack()
    return PLAN_STARTED
  }
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

// /aside run: the next step of the plan alone, the one after a pause when the run is paused,
// else the first entry of the queue, as /aside run 1 would. A step that waits for the person
// ends and its run goes on, as /aside continue does.
export async function runNext($: Engine, ctx: Context): Promise<string> {
  const going = await goOnFromWaiting($, ctx)
  if (going !== undefined) {
    return going
  }
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  const running = await runningHere($, plan)
  if (running) {
    return running
  }
  const { index: after, then } = plan.paused ? pausedNext(plan) : { index: -1, then: undefined }
  if (after >= 0) {
    await startStep($, ctx, after, false, undefined, { ...plan.paused!, step: after, ...(then ? { then } : {}) })

    return `Running step ${after + 1}: ${plan.steps[after]!.title}; /aside continue then goes on with the paused run.${takeOverNote(plan)}`
  }
  const next = plan.steps.findIndex(step => !step.isDone)
  if (next >= 0) {
    return runChosenSteps($, ctx, plan, [next + 1])
  }
  if ((await loadEntries($, keys.queue)).length === 0) {
    const tags = (await tagsInFiles($, true)).length
    return tags > 0 ? `The queue is empty; /aside run all runs the ${formatCount(tags, 'tag')} in files.` : 'Nothing to run: the queue is empty and the plan is done.'
  }

  return runChosenEntries($, ctx, keys, plan, [1])
}

const PLAN_STARTED = 'Another session started a plan meanwhile; the entries stay in the queue, and /aside shows the plan.'

// The plan done made of `steps` alone, the one it was going to the log; false, and nothing
// changed, when a plan with steps to do took its place since it was read (3.16).
async function replacePlan($: Engine, ctx: Context, steps: readonly Step[]): Promise<boolean> {
  return changePlan($, ctx, async plan => {
    if (plan.steps.some(step => !step.isDone)) return false
    await archivePlan($, plan)
    replaceSteps(plan, steps)
    return true
  })
}

// /aside run all with no plan to run: every entry, and every new tag, becomes a step of its own.
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
  const { giveBack } = await takeForHandOver($, keys, stored, tags)
  if (!(await replacePlan($, ctx, steps))) {
    await giveBack()
    await refreshBand($, tags.length)
    return PLAN_STARTED
  }
  await refreshBand($, 0)
  await startStep($, ctx, 0, true)

  return `Running ${formatCount(steps.length, 'entry')} one by one. /aside stop stops after the current one.${note}`
}

// Stops the plan: a step that has not started yet does not start; a running one finishes
// and is the last; one that waits for the person, in any session, is done as it stands, and so
// is one that continue ended whose last turn has yet to start. A step running in another
// session is let go here. A step that waited ends with the turn running now, whatever ends it.
export async function stopPlan($: Engine, ctx: Context): Promise<string> {
  const me = await $.session.id()
  const now = await $.clock.now()
  const text = await changePlan($, ctx, async plan => {
    const active = plan.active
    if (!active && plan.paused) {
      delete plan.paused
      return 'Dropped the paused run. /aside run all starts the plan again from its first step to do.'
    }
    if (!active) {
      return undefined
    }
    const n = active.step + 1
    if (isWaiting(active) || (active.isEnding && active.turnId === undefined)) {
      completeStep(plan, active, me, false, now)
      return `Step ${n} is done as it stands, and the plan stops there.`
    }
    if (active.turnId === undefined || active.sessionId !== me) {
      delete plan.active
      return `The plan stopped ${active.pausedFor === undefined ? 'before' : 'at'} step ${n}${await organizeHint($, active)}.`
    }
    active.isChain = false
    delete active.then
    if (active.pausedFor !== undefined) active.isEnding = true
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
  const sections = [planSection(plan, await $.clock.now())!, ...(left.length > 0 ? [leftOutSection(left, keys.root)] : [])]

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
  return changePlan($, ctx, async plan => {
    if (given && !(mode === 'add' ? isSamePlan(given, plan) : JSON.stringify(plan) === JSON.stringify(given))) {
      return undefined
    }
    const base = mode === 'add' ? plan.steps.length : mode === 'tool' ? plan.adding?.after : undefined
    const kept = plan.steps.slice(0, base ?? plan.steps.length)
    const isLeft = plan.active !== undefined || kept.some(step => !step.isDone)
    if (base !== undefined && isLeft) {
      plan.steps = [...kept, ...steps]
    } else {
      // A plan run to its end goes to the log as the new one takes its place.
      if (!isLeft) await archivePlan($, plan)
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

// The tool a step waits for the person with when it needs their answer before the next one.
export async function registerWaitTool($: Engine): Promise<string> {
  const registered = await $.tool.register({
    name: 'wait',
    description:
      "Keeps the step of the user's aside plan you are working on open for their answer: their next message comes to this step, and the step ends when they press continue. " +
      'Call it only from a step of the aside plan that needs the user\'s answer or decision, then ask your question and end your reply with the "Result: " line.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'what you need from the user, in a few words' } },
      required: ['reason'],
    },
    isDeferred: false,
  })

  return registered.tool
}

// The step stays open once this turn ends: the person's answer comes to it, and /aside continue
// ends it. A new question since an answer was taken up makes the step wait for that one.
export async function pausePlanFromTool(ctx: Context, $: Engine, e: PlanToolCall[1], next: PlanToolCall[2]) {
  if (e.tool !== ctx.session.waitTool) {
    return next(e)
  }
  const me = await $.session.id()
  const reason = (e as unknown as { reason?: unknown }).reason
  const said = await changePlan($, ctx, plan => {
    const active = plan.active
    if (!active || active.turnId === undefined || active.sessionId !== me) return undefined
    if (active.isEnding) return 'ending'
    active.pausedFor = typeof reason === 'string' && reason.trim() !== '' ? shortenText(reason, 120) : 'it needs your answer'
    delete active.isAnswered
    return isSummingUp(plan.steps, stepMode(plan.steps, active.step, active.isChain, active.then)) ? 'last' : 'waits'
  })
  if (said === undefined) {
    return { deny: 'no step of the aside plan is running; call this tool only from a step of the plan' }
  }
  if (said === 'ending') {
    return { result: 'The user has ended this step, so it ends with this reply and nothing waits for their answer. Ask your question all the same, then end your reply with the "Result: " line.' }
  }
  const summary = said === 'last' ? ' Write no summary of the run yet: it comes once the step ends.' : ''

  return { result: `The step waits for the user's answer. Ask your question, then end your reply with the "Result: " line; their answer comes to this step, and /aside continue ends it.${summary}` }
}

// The turn of a plan step: remember which, so its end runs the next one. The step's time
// starts with its first turn, not when it was asked for, as its prompt may wait behind a turn
// of something else.
async function bindStepTurn($: Engine, ctx: Context, turnId: string) {
  const me = await $.session.id()
  const now = await $.clock.now()
  await changePlan($, ctx, plan => {
    const active = plan.active
    if (!active || active.turnId !== undefined || active.sessionId !== me) return
    active.turnId = turnId
    active.startedAt ??= now
  })
}

// A turn of this session while its step waits for the person belongs to the step: their
// answer, or whatever else Claude does meanwhile, such as a background task's notice, so the
// step shows as running and keeps the time. The plugin's own prompts never come here.
async function bindAnswerTurn($: Engine, ctx: Context, turnId: string, text: string) {
  const me = await $.session.id()
  // Kept through a turn it does not start, such as a background task's notice before it.
  const isAnswer = ctx.session.answer === text
  if (isAnswer) delete ctx.session.answer
  const isBound = await changePlan($, ctx, plan => {
    const active = plan.active
    if (!active || active.sessionId !== me || !isWaiting(active)) return false
    active.turnId = turnId
    if (isAnswer) active.isAnswered = true
    return true
  })
  if (isBound) await refreshBand($)
}

type Submit = Parameters<Hook<'prompt.submit'>>

// What the person types to a step that waits for them here (the hook's matcher lets only that
// through) goes to Claude with what it most likely answers and how to go on with that step,
// never shown to them; the turn it starts is then the step's, and takes up their answer. Typed
// over a running turn, it may go into that turn, so it gets no context, but a turn of its own
// later still takes up the answer.
export async function noteStepAnswer(ctx: Context, $: Engine, e: Submit[1], next: Submit[2]) {
  if (e.command !== undefined || e.isMeta !== undefined) {
    return next(e)
  }
  const plan = await loadPlan($, (await projectKeys($)).plan)
  const active = plan.active
  if (!active || active.sessionId !== (await $.session.id()) || active.pausedFor === undefined) {
    return next(e)
  }
  ctx.session.answer = e.text
  if (e.turnId !== undefined || !isWaiting(active)) {
    return next(e)
  }
  const isLast = isSummingUp(plan.steps, stepMode(plan.steps, active.step, active.isChain, active.then))

  return next({ ...e, context: [...(e.context ?? []), answerContext(plan.steps, active.step, isLast, ctx.session.waitTool)] })
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
    else if (!ctx.session.isOwnTurn) await bindAnswerTurn($, ctx, e.turnId, e.text)
    if (isAddingPrompt(e.text)) await bindAddingTurn($, ctx, e.turnId)
    const { planning } = ctx.session
    if (planning && planning.turnId === undefined && isPlanningPrompt(e.text)) planning.turnId = e.turnId
  }

  return next(e)
}

type TurnEndReason = Args<'turn.complete'>['reason']

// Why a run waits after a step that /aside plan asked to organize the queue after.
const PLANNING_PAUSE = 'to organize the queue'

// The turn of the step running here ends. A step that waits for the person stays open, as
// whatever ended the turn, keeping its time and what it said so far; with /aside plan asked
// meanwhile, the queue goes to Claude now, after an answer. A step that continue or stop ended
// is done, as it stands when the turn was cut short. Any other step, after an answer, is done,
// keeping what the answer said it did and how long it took by the clock, and the next one starts when
// the plan runs as a chain; otherwise the plan stops there. The plan is read again as it is
// changed, since a planner may have added steps since the turn's end read it, and the next step
// is marked running in that same change, so nothing in between finds the run with no step. When
// /aside plan asked during the step, and there is something to organize, the queue goes to
// Claude now, and a run with steps left waits for it.
async function finishStep($: Engine, ctx: Context, e: TurnComplete[1]) {
  const me = await $.session.id()
  const now = await $.clock.now()
  const end = await changePlan($, ctx, async plan => {
    const active = plan.active
    if (active?.turnId !== e.turnId || active.sessionId !== me) {
      return undefined
    }
    const isAnswer = e.reason === 'answer'
    const isPlanning = active.isPlanningAfter === true && (await hasItems($))
    // Cut short, it organizes nothing, as any step's turn: the toast says /aside plan does.
    const hint = isAnswer ? '' : await organizeHint($, active)
    active.ms = (active.ms ?? 0) + e.durationMs
    const result = isAnswer ? readStepResult(e.answer) : undefined
    if (result !== undefined) active.result = result
    if (active.isEnding) {
      completeStep(plan, active, me, false, now)
      return { active, waits: false, after: -1, isPausing: false, isPlanning: isPlanning && isAnswer, hint, steps: structuredClone(plan.steps) }
    }
    if (active.pausedFor !== undefined) {
      delete active.turnId
      delete active.isPlanningAfter
      return { active: structuredClone(active), waits: true, after: -1, isPausing: false, isPlanning: isPlanning && isAnswer, hint, steps: structuredClone(plan.steps) }
    }
    if (!isAnswer) {
      delete plan.active
      return { active, waits: false, after: -1, isPausing: false, isPlanning: false, hint, steps: plan.steps }
    }
    const after = nextInRun(plan.steps, active.step, active.isChain, active.then)
    const isPausing = after >= 0 && isPlanning
    completeStep(plan, active, me, !isPausing, now)
    if (isPausing) plan.paused = { step: active.step, reason: PLANNING_PAUSE, isChain: active.isChain, ...(active.then ? { then: active.then } : {}) }

    return { active, waits: false, after, isPausing, isPlanning, hint: '', steps: structuredClone(plan.steps) }
  })
  if (end === undefined) {
    return
  }
  const { active, waits, after, isPausing, isPlanning, hint, steps } = end
  const n = active.step + 1
  if (waits) {
    $.ui.toast(
      active.isAnswered
        ? `Step ${n} waits for /aside continue, which ends it${hint}.`
        : `Step ${n} waits for your answer: ${active.pausedFor}. Answer as usual; /aside continue ends the step${hint}.`,
    )
  } else if (e.reason !== 'answer' && !active.isEnding) {
    $.ui.toast(`Plan stopped: step ${n} ${e.reason === 'aborted' ? 'was interrupted' : 'did not finish'}${hint}`)
  } else if (isPausing) {
    $.ui.toast(`Plan paused after step ${n}: ${PLANNING_PAUSE}. /aside continue goes on.`)
  } else if (after >= 0) {
    sendStep($, ctx, steps, after, active.isChain, active.then?.slice(1))
  } else if (steps.every(one => one.isDone)) {
    $.ui.toast(`${doneText(steps)}${hint}`)
  } else {
    $.ui.toast(`Step ${n} done${hint}`)
  }
  await refreshBand($)
  if (isPlanning) {
    // A plan with no step left to add after is organized afresh, as /aside plan would.
    const isAdding = steps.some(one => !one.isDone)
    const said = await handOver($, ctx, isAdding).catch((error: unknown) => ({ text: `Could not organize the queue (${describeError(error)}).`, isHanded: false }))
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
        $.ui.toast(await handOverQueue($, ctx, 'answer').catch((error: unknown) => `Could not organize the queue: ${describeError(error)}`))
      })
      return
    }
    $.ui.toast(afterAnswer === 'plan' ? await handOverQueue($, ctx) : await runEntries($, ctx))
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

type SubmitFailed = Parameters<CatchHandler<Hook<'prompt.submit'>>>

// A message to a step that waits goes to Claude all the same when the plan cannot be read.
export function stepAnswerFailed($: Engine, e: SubmitFailed[1], next: SubmitFailed[2]) {
  return next(e)
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
