// Handing the queue over, the commands that run the plan, and the hooks on a turn that drive
// both. What the step's own life needs is in `steps`, the two tools Claude saves a plan with in
// `plantool`, the model that organizes the queue outside the conversation in `planner`, and the
// work a step leaves going in `background`; this file imports all four and none imports it, so
// the area reads in one direction (2.1). It could be cut again between the hand-over and the
// commands, which call each other nowhere, but the turn's end needs both in one breath, so they
// stay together and the file stays a little past the 400 lines 2.4 prefers (1.2).

import type { Args, CatchHandler, EngineInterface as Engine, Hook, MatchedHook } from 'claude-code'

import type { Entry, Plan, Step, StepState } from '../../types'
import type { Asker, Context } from '../context'
import { inOrder, isSameEntry, KINDS } from '../core/entries'
import { describeCount, formatPlace, leftOutSection, listingText, planSection } from '../core/listing'
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
  readTitleReply,
  STEP_MARKER,
  stepMode,
  stepPrompt,
  tidyPrompt,
  TITLE_SYSTEM,
} from '../core/prompts'
import type { StepMode } from '../core/prompts'
import { askedOf, awayWork, isAway, isWaiting, nextInRun, runOf, stepState, turnOf } from '../core/step'
import { askPlaces, describeError, describeFailure, formatCount, formatDuration, isPlace, shortenText } from '../core/text'
import { changePlan } from '../io/plan'
import { bringBackTake, forgetAnsweredTake, giveBackItems, readQueue, takeChosen, takeForHandOver, takePlanned } from '../io/queue'
import { loadPlan, loadTagIds, projectKeys, refreshBand, tagId } from '../io/store'
import type { Keys } from '../io/store'
import { archivePlan } from './history'
import { openListPane, tagsInFiles } from './queue'

import {
  bindAnswerTurn,
  bindStepTurn,
  completeStep,
  dropDeadTurn,
  finishStep,
  goOnFromWaiting,
  hasItems,
  isLeftHere,
  organizeHint,
  pausedNext,
  runningHere,
  startStep,
  submitLater,
  takeOverNote,
} from './steps'
import type { TurnComplete, TurnEndReason } from './steps'
import { parseSteps, parseUnclear, replaceSteps, savePlanSteps } from './plantool'
import { nameOldSteps, nameStepsLater, planOutside } from './planner'

const EMPTY_QUEUE = 'The queue is empty. Start a message with "+" to add an idea, or "+?" to comment on a copied fragment.'

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
  const step = await changePlan($, plan => {
    if (plan.active?.sessionId !== me || isWaiting(plan.active)) return undefined
    plan.active.isPlanningAfter = true
    return { n: plan.active.step + 1, isAnswer: plan.active.is === 'answering' }
  })
  if (step === undefined) {
    return handOverQueue($, ctx, asker)
  }
  const text = step.isAnswer
    ? `Step ${step.n} is running on your answer; once Claude has answered, it organizes the queue into steps after the plan's own, and /aside continue goes on.`
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
  // Tags already handed over stay in their files until a step removes them; they are
  // not handed over again. The take reads the queue itself, so nothing typed meanwhile is
  // stored between that read and its write.
  const tags = await tagsInFiles($, true)
  // The entries leave the queue as they are handed over; /aside undo brings them back.
  const { stored, giveBack } = await takeForHandOver($, tags)
  const all = [...inOrder(stored, ctx.settings.order), ...tags]
  if (all.length === 0) {
    return { text: EMPTY_QUEUE, isHanded: false }
  }
  await refreshBand($, 0)
  const me = await $.session.id()
  const plan = await changePlan($, plan => {
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

// An entry as a step of a plan of its own, titled with the start of its text until the small
// model names it.
const entryStep = (entry: Entry, root: string): Step => ({
  title: shortenText(entry.text || formatPlace(entry, root) || KINDS[entry.kind].label, 120),
  prompt: entryPrompt(entry, root),
})

async function runChosenSteps($: Engine, ctx: Context, plan: Plan, chosen: readonly number[]): Promise<string> {
  if (!chosen.every(n => isPlace(n, plan.steps.length))) {
    return askPlaces(chosen.length, plan.steps.length, 'step')
  }
  const note = takeOverNote(plan)
  const [first, ...rest] = chosen.map(n => n - 1)
  await startStep($, ctx, first!, false, rest.length > 0 ? rest : undefined)

  return chosen.length === 1
    ? `Running step ${chosen[0]}: ${plan.steps[first!]!.title}${note}`
    : `Running steps ${chosen.join(', ')} one by one. /aside stop stops after the current one.${note}`
}

async function runChosenEntries($: Engine, ctx: Context, keys: Keys, plan: Plan, chosen: readonly number[]): Promise<string> {
  // The numbers are read against the queue as the take finds it, so an entry typed or tidied
  // meanwhile is neither written over nor taken in place of the one shown.
  const taken = await takeChosen($, stored => {
    const list = inOrder(stored, ctx.settings.order)
    if (list.length === 0) return 'The queue is empty.'
    if (!chosen.every(n => isPlace(n, list.length))) {
      return askPlaces(chosen.length, list.length, 'entry')
    }
    return chosen.map(n => list[n - 1]!)
  })
  if (typeof taken === 'string') {
    return taken
  }
  const note = takeOverNote(plan)
  const { chosen: entries, giveBack } = taken
  const steps = entries.map(entry => entryStep(entry, keys.root))
  if (!(await replacePlan($, ctx, steps))) {
    await giveBack()
    return PLAN_STARTED
  }
  await refreshBand($)
  await startStep($, ctx, 0, true)
  nameStepsLater($, ctx, steps, entries)

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
  if ((await readQueue($, 'oldest')).length === 0) {
    const tags = (await tagsInFiles($, true)).length
    return tags > 0 ? `The queue is empty; /aside run all runs the ${formatCount(tags, 'tag')} in files.` : 'Nothing to run: the queue is empty and the plan is done.'
  }

  return runChosenEntries($, ctx, keys, plan, [1])
}

const PLAN_STARTED = 'Another session started a plan meanwhile; the entries stay in the queue, and /aside shows the plan.'

// The plan done made of `steps` alone, the one it was going to the log; false, and nothing
// changed, when a plan with steps to do took its place since it was read (3.16).
async function replacePlan($: Engine, ctx: Context, steps: readonly Step[]): Promise<boolean> {
  return changePlan($, async plan => {
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
  const tags = await tagsInFiles($, true)
  // As a hand-over does, the take reads the queue itself.
  const { stored, giveBack } = await takeForHandOver($, tags)
  const all = [...inOrder(stored, ctx.settings.order), ...tags]
  if (all.length === 0) {
    return 'Nothing to run: the queue is empty and the plan is done.'
  }
  const steps = all.map(entry => entryStep(entry, keys.root))
  if (!(await replacePlan($, ctx, steps))) {
    await giveBack()
    await refreshBand($, tags.length)
    return PLAN_STARTED
  }
  await refreshBand($, 0)
  await startStep($, ctx, 0, true)
  nameStepsLater($, ctx, steps, all)

  return `Running ${formatCount(steps.length, 'entry')} one by one. /aside stop stops after the current one.${note}`
}

// Stops the plan: a step that has not started yet does not start; a running one finishes
// and is the last; one that waits for the person, in any session, is done as it stands, and so
// is one that continue ended whose last turn has yet to start. A step running in another
// session is let go here. A step that waited ends with the turn running now, whatever ends it.
export async function stopPlan($: Engine, ctx: Context): Promise<string> {
  const me = await $.session.id()
  const now = await $.clock.now()
  const text = await changePlan($, async plan => {
    const active = plan.active
    if (!active && plan.paused) {
      delete plan.paused
      return 'Dropped the paused run. /aside run all starts the plan again from its first step to do.'
    }
    if (!active) {
      return undefined
    }
    const n = active.step + 1
    // A step with no turn of its own left: one that waits, one in the background, one continue
    // or stop already ended, or one an earlier process left running here.
    if (isWaiting(active) || isAway(active) || active.is === 'ending' || isLeftHere(ctx, active, me)) {
      // With nothing it said it did, the step shows that stop ended it.
      active.result ??= 'stopped'
      completeStep(plan, active, me, false, now)
      return `Step ${n} is done as it stands, and the plan stops there.`
    }
    const turnId = turnOf(active)
    if (turnId === undefined || active.sessionId !== me) {
      delete plan.active
      return `The plan stopped ${askedOf(active) === undefined ? 'before' : 'at'} step ${n}${await organizeHint($, active)}.`
    }
    active.isChain = false
    delete active.then
    // A step that had asked the person something is done once the turn it has left ends.
    const asked = askedOf(active)
    if (asked !== undefined) plan.active = stepState({ ...runOf(active), is: 'closing', turnId, pausedFor: asked })

    return `The plan stops after step ${n}.`
  })
  if (text === undefined) {
    return 'Nothing is running.'
  }
  await refreshBand($)

  return text
}

// The turn of this session's prompt that adds to the plan, known by its text, so a reload
// since the hand-over still finds it.
async function bindAddingTurn($: Engine, ctx: Context, turnId: string) {
  const me = await $.session.id()
  await changePlan($, plan => {
    if (plan.adding?.sessionId === me && plan.adding.turnId === undefined) plan.adding.turnId = turnId
  })
}

type TurnStart = Parameters<Hook<'turn.start'>>

export async function onTurnStart(ctx: Context, $: Engine, e: TurnStart[1], next: TurnStart[2]) {
  if (e.agentId === undefined) {
    // A process runs one turn at a time: a step's turn it started, still open as a new one
    // starts here, never ended.
    await dropDeadTurn($, ctx, await $.session.id(), e.turnId, false)
    ctx.session.openTurns.add(e.turnId)
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

// The queue a step asked /aside plan to organize, handed over once that step's turn has ended.
// Only a hand-over that did not go out has more to say than the step's own toast.
async function organizeAfterStep($: Engine, ctx: Context, isAdding: boolean) {
  const said = await handOver($, ctx, isAdding).catch((error: unknown) => ({
    text: `Could not organize the queue (${describeError(error)}).`,
    isHanded: false,
  }))
  if (!said.isHanded) $.ui.toast(said.text)
}

// The turn that was to organize the queue ended with no plan saved, answered or cut short:
// what it was handed goes back to the queue, so nothing is lost.
async function giveBackUnplanned($: Engine) {
  const { entries, tagIds } = await bringBackTake($)
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

export async function onTurnEnd(ctx: Context, $: Engine, e: TurnComplete[1], next: TurnComplete[2]) {
  // Before anything awaits: a turn that starts while this end is handled finds this one ended.
  if (e.agentId === undefined) ctx.session.openTurns.delete(e.turnId)
  const done = await next(e)
  if (e.agentId !== undefined) {
    return done
  }
  ctx.session.isRunning = false

  const keys = await projectKeys($)
  const { planning } = ctx.session
  if (planning?.turnId === e.turnId) {
    delete ctx.session.planning
    if (!planning.isSaved) await giveBackUnplanned($)
  }
  // The plan tool may save again within the turn that adds, each time in place of its last
  // steps; once that turn is over, the steps it added are the plan's own. Read from the plan,
  // so a reload since does not keep the mark.
  const me = await $.session.id()
  await changePlan($, plan => {
    if (plan.adding?.sessionId === me && plan.adding.turnId === e.turnId) delete plan.adding
  })
  // Claude has answered what the plugin handed over, so undo has nothing to bring back; but
  // a step that ran ahead of a planning prompt still out leaves that prompt's take.
  if (ctx.session.isOwnTurn && e.reason === 'answer' && !ctx.session.planning) {
    await forgetAnsweredTake($)
  }
  const plan = await loadPlan($, keys.plan)
  const isThisStep = plan.active !== undefined && turnOf(plan.active) === e.turnId && plan.active.sessionId === (await $.session.id())
  if (isThisStep) {
    const organize = await finishStep($, ctx, e)
    if (organize) await organizeAfterStep($, ctx, organize.isAdding)
  } else {
    await handOverAfterAnswer($, ctx, plan, e.reason)
  }

  return done
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
