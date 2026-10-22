import type { Args, CatchHandler, EngineInterface as Engine, Hook } from 'claude-code'

import type { Plan, Step, StepState } from '../../types'
import type { Context } from '../context'
import { answerContext, closingPrompt, isSummingUp, readStepResult, stepMode, stepPrompt } from '../core/prompts'
import { askedOf, awayWork, isAway, isWaiting, nextInRun, runOf, stepState, turnOf } from '../core/step'
import { describeError, formatCount, formatDuration } from '../core/text'
import { changePlan } from '../io/plan'
import { readQueue } from '../io/queue'
import { loadPlan, projectKeys, refreshBand } from '../io/store'
import { tagsInFiles } from './queue'

// The step of a plan as it runs: its prompt going out, the turns that are its own, and its end.
// Nothing here reaches for the hand-over or for the commands, which is what keeps the imports of
// this area going one way (2.1): a step that asked for the queue to be organized says so to
// whoever ended its turn, rather than organizing it itself. The queries the rest of the plan
// shares, such as why nothing new may start while a step runs, live here beside the state they
// read. It is a little past the 400 lines 2.4 prefers and stays one file on purpose (1.2): a
// step's prompt going out, the turns bound to it and its end are one chain of events, and a cut
// anywhere along it would put two halves of the same walk in two places.

// Submits the prompt `compose` gives as the person's own, or nothing when it gives none. It
// goes out from a timer, since neither a command's hook nor a turn's end may submit one while
// it holds the turn; `onFail` hears why, once, when a hook beneath drops it, the engine
// refuses it or composing it fails. Nothing here is left to throw unheard in the timer.
export function submitLater($: Engine, compose: () => Promise<string | undefined>, onFail: (why: string) => Promise<void>) {
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

// Whether there is anything to hand over: an entry, or a tag not handed over yet.
export async function hasItems($: Engine): Promise<boolean> {
  return (await readQueue($, 'oldest')).length > 0 || (await tagsInFiles($, true)).length > 0
}

// Lets go of the step `index` that never started (its prompt was dropped or refused),
// unless something else took its place meanwhile. A step that continue ended, whose prompt
// was only to sum the run up, is done as it stands.
async function releaseStep($: Engine, ctx: Context, index: number, why: string) {
  const now = await $.clock.now()
  const gone = await changePlan($, plan => {
    const active = plan.active
    if (active?.step !== index || turnOf(active) !== undefined) return undefined
    // With no turn, the step continue or stop ended is the one that shows as ending.
    if (active.is === 'ending') completeStep(plan, active, active.sessionId, false, now)
    else delete plan.active
    return active
  })
  if (gone) await refreshBand($)
  $.ui.toast(
    gone?.is === 'ending'
      ? `Could not ask Claude to sum the run up (${why}); step ${index + 1} is done as it stands.`
      : `Could not send step ${index + 1} of the plan: ${why}${await organizeHint($, gone)}`,
  )
}

// What a step that never ran, or was cut short, adds to its message when /aside plan was to
// organize the queue once it ended: that /aside plan does it now, if there is anything to.
export async function organizeHint($: Engine, active: Plan['active'] | undefined): Promise<string> {
  return active?.isPlanningAfter && (await hasItems($)) ? '; /aside plan organizes the queue' : ''
}

// Runs step `index` of the plan; with `isChain`, the next one not done follows when it ends,
// with `then`, those steps in that order. A stop that lands before its prompt goes out keeps
// it from going out at all. With `paused`, the step runs alone out of a paused run, which
// stays paused after it for /aside continue.
export async function startStep($: Engine, ctx: Context, index: number, isChain: boolean, then?: readonly number[], paused?: Plan['paused']) {
  const sessionId = await $.session.id()
  const steps = await changePlan($, plan => {
    // A step that starts, the run going on or a new one, ends any pause but its own.
    if (paused) plan.paused = paused
    else delete plan.paused
    plan.active = stepState({ step: index, isChain, sessionId, ...(then ? { then: [...then] } : {}), is: 'due' })
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
      // Any step with no turn of its own running is still due its prompt, the one a stop left
      // ending, whose prompt only sums the run up, included.
      const isStillDue = now.active?.step === index && turnOf(now.active) === undefined
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
export const takeOverNote = (plan: Plan) =>
  plan.active ? ` (another session had step ${plan.active.step + 1} ${isWaiting(plan.active) ? 'waiting for an answer' : 'running'}; this one takes over)` : ''

// Why nothing new starts while a step of the plan runs in this session, or waits for the
// person in any session, if one does: a step that waits runs nowhere, so any session ends it,
// as /clear moves on to a new session.
export async function runningHere($: Engine, plan: Plan): Promise<string | undefined> {
  const active = plan.active
  if (!active) {
    return undefined
  }
  const n = active.step + 1
  if (isAway(active)) {
    const work = awayWork(active)
    return `Step ${n} goes on in the background${work && ` (${work})`}; /aside continue ends it and goes on, /aside stop ends it there.`
  }
  if (isWaiting(active)) {
    return active.is === 'answered'
      ? `Step ${n} waits: answer again, and Claude's reply ends it, or /aside continue ends it and goes on; /aside stop ends it there.`
      : `Step ${n} waits for your answer; /aside continue ends it and goes on, /aside stop ends it there.`
  }
  if (active.sessionId !== (await $.session.id())) {
    return undefined
  }

  return active.is === 'answering'
    ? `Step ${n} is running on your answer, and ends once Claude has answered. /aside stop stops after it.`
    : `Step ${n} is running. /aside stop stops after it.`
}

// Marks the step `active` runs done at `now`, with the time it took and what its last turn
// said, and with isGoingOn, the next step of its run running in that same change, so nothing
// in between finds the run with no step. Answers that step, or -1 with none.
export function completeStep(plan: Plan, active: StepState, me: string, isGoingOn: boolean, now: number): number {
  const step = plan.steps[active.step]!
  // The time by the clock, waits for the person included; never less than its turns took.
  const ms = Math.max(active.ms ?? 0, active.startedAt === undefined ? 0 : now - active.startedAt)
  plan.steps[active.step] = { ...step, isDone: true, ms, doneAt: now, ...(active.result ? { result: active.result } : {}) }
  delete plan.active
  const after = isGoingOn ? nextInRun(plan.steps, active.step, active.isChain, active.then) : -1
  if (after >= 0) {
    const then = active.then?.slice(1)
    delete plan.paused
    plan.active = stepState({ step: after, isChain: active.isChain, sessionId: me, ...(then ? { then } : {}), is: 'due' })
  }

  return after
}

// A step running in this session on a turn this process never saw start, or saw start and
// never end: one an earlier process left when it closed in the middle of it. /aside continue
// and /aside stop end it, as one that waits; a turn of this process still running is its own.
export const isLeftHere = (ctx: Context, active: StepState, me: string) => {
  const turnId = turnOf(active)

  return active.sessionId === me && turnId !== undefined && !ctx.session.openTurns.has(turnId)
}

// /aside continue on a step that waits for the person, in this session or one before it: it
// is done, and its run goes on here. The last step of a run of several takes one more turn
// first, which sums the run up and then ends it, as it stands if that turn is cut short, with
// nothing after it: steps added meanwhile wait for /aside run. Undefined when no step waits.
export async function goOnFromWaiting($: Engine, ctx: Context): Promise<string | undefined> {
  const me = await $.session.id()
  const now = await $.clock.now()
  const end = await changePlan($, plan => {
    const active = plan.active
    if (!active || !(isWaiting(active) || isAway(active) || isLeftHere(ctx, active, me))) return undefined
    const note = active.sessionId === me ? '' : takeOverNote(plan)
    if (isSummingUp(plan.steps, stepMode(plan.steps, active.step, active.isChain, active.then))) {
      // The turn it had, the question it asked and what it was still to wait for in the
      // background are all let go, as continue ends the step; the turn that sums up is this
      // session's, so its start binds to the step here.
      const { background: _background, ...kept } = runOf(active)
      const ending = stepState({ ...kept, sessionId: me, is: 'ending' })
      plan.active = ending
      return { active: ending, after: -1, isClosing: true, steps: structuredClone(plan.steps), note }
    }
    // completeStep reads only how the run goes on, so the step's own marks need no clearing.
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
export function pausedNext(plan: Plan): { index: number; then: number[] | undefined } {
  const paused = plan.paused!
  const then = paused.then?.filter(i => plan.steps[i] !== undefined && !plan.steps[i].isDone)
  if (then !== undefined) {
    return { index: then[0] ?? -1, then: then.slice(1) }
  }

  return { index: paused.isChain ? plan.steps.findIndex((step, i) => i > paused.step && !step.isDone) : -1, then: undefined }
}

// The turn of a plan step: remember which, so its end runs the next one. The step's time
// starts with its first turn, not when it was asked for, as its prompt may wait behind a turn
// of something else.
export async function bindStepTurn($: Engine, ctx: Context, turnId: string) {
  const me = await $.session.id()
  const now = await $.clock.now()
  await changePlan($, plan => {
    const active = plan.active
    if (!active || turnOf(active) !== undefined || active.sessionId !== me) return
    active.startedAt ??= now
    plan.active = withStepTurn(active, turnId)
  })
}

// The step with the turn of its own prompt running. Only the states with no turn are reachable
// here, the step bindStepTurn guards for; the rest are written out so a new state cannot be
// added without saying what its turn does (4.6).
function withStepTurn(active: StepState, turnId: string): StepState {
  const run = runOf(active)
  switch (active.is) {
    case 'due':
    case 'running':
      return stepState({ ...run, is: 'running', turnId })
    // A step that waits takes the turn as any other of this session's: its question stands,
    // and only an answer told about the step ends it (bindAnswerTurn).
    case 'waiting':
    case 'answered':
    case 'asking':
    case 'answering':
      return stepState({ ...run, is: 'asking', turnId, pausedFor: active.pausedFor })
    case 'away':
    case 'noticing':
      return stepState({ ...run, is: 'noticing', turnId })
    // The prompt that sums the run up: the step is done when its turn ends.
    case 'ending':
    case 'closing':
      return stepState({ ...run, is: 'closing', turnId, ...(active.pausedFor === undefined ? {} : { pausedFor: active.pausedFor }) })
  }
}

// A turn of this session while its step waits for the person belongs to the step: their
// answer, or whatever else Claude does meanwhile, such as a background task's notice, so the
// step shows as running and keeps the time. The plugin's own prompts never come here.
export async function bindAnswerTurn($: Engine, ctx: Context, turnId: string, text: string) {
  const me = await $.session.id()
  // Kept through a turn it does not start, such as a background task's notice before it.
  const answer = ctx.session.answer?.text === text ? ctx.session.answer : undefined
  // The turn a background task's notification starts, for the step its work was part of.
  const isNotice = ctx.session.notice === text
  if (isNotice) delete ctx.session.notice
  // Only an answer sent with the step's own words ends the step with the reply to it.
  const isAnswer = answer !== undefined
  const isTold = answer?.isTold === true
  if (isAnswer) delete ctx.session.answer
  const isBound = await changePlan($, plan => {
    const active = plan.active
    if (!active || active.sessionId !== me) return false
    // A step in the background takes only the turn of its work's notification, never one
    // of the person's own.
    if (isAway(active)) {
      if (isNotice) plan.active = stepState({ ...runOf(active), is: 'noticing', turnId })
      return isNotice
    }
    if (!isWaiting(active)) return false
    const { pausedFor } = active
    // An answer taken before this turn still counts: the step says "answer again" until Claude
    // asks something new (pausePlanFromTool), which is the one place that mark is let go.
    const isAnswerTaken = isAnswer || active.is === 'answered'
    // Only an answer sent with the step's own words makes this turn the one whose reply ends
    // the step; any other turn of this session leaves it waiting for the next answer.
    plan.active = isTold
      ? stepState({ ...runOf(active), is: 'answering', turnId, pausedFor })
      : stepState({ ...runOf(active), is: 'asking', turnId, pausedFor, ...(isAnswerTaken ? { isAnswered: true as const } : {}) })

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
  if (!active || active.sessionId !== (await $.session.id()) || askedOf(active) === undefined) {
    return next(e)
  }
  ctx.session.answer = { text: e.text, isTold: false }
  if (e.turnId !== undefined || !isWaiting(active)) {
    return next(e)
  }
  const isLast = isSummingUp(plan.steps, stepMode(plan.steps, active.step, active.isChain, active.then))
  ctx.session.answer = { text: e.text, isTold: true }

  return next({ ...e, context: [...(e.context ?? []), answerContext(plan.steps, active.step, isLast, ctx.session.waitTool)] })
}

type SessionEnd = Parameters<Hook<'session.end'>>

export type TurnEndReason = Args<'turn.complete'>['reason']

// What a step waits for whose turn ended with no end the plugin heard.
const CUT_OFF = 'its turn ended without an answer'

// The step of session `sessionId` whose turn will never end: one this process started, still
// open, other than `turnId`; with isGone, the session itself ended, so also its work in the
// background that calls here started, and a step whose turn never started. Turns and work of
// another process, on the same session resumed elsewhere, are left to it. One that continue or
// stop ended is done, as it stands; any other has no turn running and waits for the person, as
// after a step's question, so /aside continue ends it and goes on and /aside stop ends it there.
export async function dropDeadTurn($: Engine, ctx: Context, sessionId: string, turnId: string | undefined, isGone: boolean) {
  const { openTurns, ownWork } = ctx.session
  const now = await $.clock.now()
  const dropped = await changePlan($, async plan => {
    const active = plan.active
    if (!active || active.sessionId !== sessionId) return undefined
    const turn = turnOf(active)
    if (turn !== undefined) {
      if (turn === turnId || !openTurns.has(turn)) return undefined
    } else if (!isGone || isWaiting(active) || (isAway(active) && !(active.background ?? []).every(work => work.callId !== undefined && ownWork.has(work.callId)))) {
      return undefined
    }
    if (active.is === 'ending' || active.is === 'closing') {
      completeStep(plan, active, sessionId, false, now)
      return { n: active.step + 1, waits: false, hint: '' }
    }
    // Read before the request to organize the queue is let go with the turn it was asked in.
    const hint = await organizeHint($, active)
    const { isPlanningAfter: _isPlanningAfter, background, ...rest } = runOf(active)
    // With the session itself gone, so is the work it had going and the step's wait on it.
    const run = isGone || background === undefined ? rest : { ...rest, background }
    if (!isGone && active.is === 'noticing') {
      // Its work is still going: the step goes back to waiting on that, not on the person.
      plan.active = stepState({ ...run, is: 'away' })
      return { n: active.step + 1, waits: false, hint }
    }
    // Any other step waits for the person: what Claude asked it to wait for if it asked, else
    // that its turn ended with no answer. The work it left behind stays on for /aside continue.
    const pausedFor = askedOf(active) ?? CUT_OFF
    plan.active = stepState(active.is === 'answering' ? { ...run, is: 'answered', pausedFor } : { ...run, is: 'waiting', pausedFor })

    return { n: active.step + 1, waits: true, hint }
  })
  if (dropped === undefined) return
  await refreshBand($)
  if (!isGone && dropped.waits) $.ui.toast(`Step ${dropped.n}'s turn never ended; it waits, and /aside continue ends it and goes on${dropped.hint}.`)
}

// The session ends: a turn of a step it runs never ends now.
export async function endSessionSteps(ctx: Context, $: Engine, e: SessionEnd[1], next: SessionEnd[2]) {
  await dropDeadTurn($, ctx, e.sessionId, undefined, true)

  return next(e)
}

// Why a run waits after a step that /aside plan asked to organize the queue after.
const PLANNING_PAUSE = 'to organize the queue'

// The turn of the step running here ends. A step that waits for the person stays open, as
// whatever ended the turn, keeping its time and what it said so far, unless the turn took their
// answer and Claude asked nothing again in it: it is then done, as any step after an answer; with /aside plan asked
// meanwhile, the queue goes to Claude now, after an answer. A step that continue or stop ended
// is done, as it stands when the turn was cut short. Any other step, after an answer, is done,
// keeping what the answer said it did and how long it took by the clock, and the next one starts when
// the plan runs as a chain; otherwise the plan stops there. The plan is read again as it is
// changed, since a planner may have added steps since the turn's end read it, and the next step
// is marked running in that same change, so nothing in between finds the run with no step. When
// /aside plan asked during the step, and there is something to organize, the queue goes to
// Claude now, and a run with steps left waits for it.
export async function finishStep($: Engine, ctx: Context, e: TurnComplete[1]): Promise<{ isAdding: boolean } | undefined> {
  const me = await $.session.id()
  const now = await $.clock.now()
  const end = await changePlan($, async plan => {
    const active = plan.active
    if (!active || turnOf(active) !== e.turnId || active.sessionId !== me) {
      return undefined
    }
    const isAnswer = e.reason === 'answer'
    const isPlanning = active.isPlanningAfter === true && (await hasItems($))
    // Cut short, it organizes nothing, as any step's turn: the toast says /aside plan does.
    const hint = isAnswer ? '' : await organizeHint($, active)
    active.ms = (active.ms ?? 0) + e.durationMs
    const result = isAnswer ? readStepResult(e.answer) : undefined
    if (result !== undefined) active.result = result
    // continue or stop ended the step: it is done when this turn ends, whatever ends it.
    if (active.is === 'closing') {
      completeStep(plan, active, me, false, now)
      return { active, after: -1, isPausing: false, isPlanning: isPlanning && isAnswer, hint, steps: structuredClone(plan.steps) }
    }
    // The turn that took the person's answer ends the step, unless Claude asked again in it.
    const isAnswered = isAnswer && active.is === 'answering'
    const asked = askedOf(active)
    if (asked !== undefined && !isAnswered) {
      // The request to organize the queue goes with the turn it was asked in; a turn that took
      // an answer before this one leaves the step asking for another.
      const { isPlanningAfter: _isPlanningAfter, ...run } = runOf(active)
      const isAgain = active.is === 'answering' || (active.is === 'asking' && active.isAnswered === true)
      const back = stepState(isAgain ? { ...run, is: 'answered', pausedFor: asked } : { ...run, is: 'waiting', pausedFor: asked })
      plan.active = back
      return { active: back, after: -1, isPausing: false, isPlanning: isPlanning && isAnswer, hint, steps: structuredClone(plan.steps) }
    }
    // A turn of a step in the background cut short leaves it there, as one that waits.
    if (!isAnswer && active.is === 'noticing') {
      const away = stepState({ ...runOf(active), is: 'away' })
      plan.active = away
      return { active: away, after: -1, isPausing: false, isPlanning: false, hint, steps: structuredClone(plan.steps) }
    }
    if (!isAnswer) {
      delete plan.active
      return { active, after: -1, isPausing: false, isPlanning: false, hint, steps: plan.steps }
    }
    // Work in the background a turn of it started is still going: the step goes on there, and
    // the turn that work's end brings ends it.
    if ((active.background?.length ?? 0) > 0) {
      const away = stepState({ ...runOf(active), is: 'away' })
      plan.active = away
      return { active: away, after: -1, isPausing: false, isPlanning: false, hint: '', steps: structuredClone(plan.steps) }
    }
    const after = nextInRun(plan.steps, active.step, active.isChain, active.then)
    const isPausing = after >= 0 && isPlanning
    completeStep(plan, active, me, !isPausing, now)
    if (isPausing) plan.paused = { step: active.step, reason: PLANNING_PAUSE, isChain: active.isChain, ...(active.then ? { then: active.then } : {}) }

    return { active, after, isPausing, isPlanning, hint: '', steps: structuredClone(plan.steps) }
  })
  if (end === undefined) {
    return undefined
  }
  const { active, after, isPausing, isPlanning, hint, steps } = end
  const n = active.step + 1
  if (isAway(active)) {
    $.ui.toast(
      awayWork(active)
        ? `Step ${n} goes on in the background (${awayWork(active)}); it ends once that work is done and Claude has answered it, or /aside continue ends it now.`
        : `Step ${n} waits for /aside continue, which ends it: its work in the background is done.`,
    )
  } else if (isWaiting(active)) {
    // Asked of the state, not of a flag carried beside it: only a state that holds a question
    // can be read for one, so it can never come out as "undefined".
    $.ui.toast(
      active.is === 'answered'
        ? `Step ${n} waits: answer again, and Claude's reply ends it, or /aside continue ends it now${hint}.`
        : `Step ${n} waits for your answer: ${active.pausedFor}. Answer as usual, and the step ends with Claude's reply; /aside continue ends it now${hint}.`,
    )
  } else if (e.reason !== 'answer' && active.is !== 'closing') {
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

  // Whether the queue goes to Claude now, which the turn's end does: a plan with no step left
  // to add after is organized afresh, as /aside plan would. The step's own work is over here,
  // so what follows it is the caller's, not this function's.
  return isPlanning ? { isAdding: steps.some(one => !one.isDone) } : undefined
}

export type TurnComplete = Parameters<Hook<'turn.complete'>>

type SubmitFailed = Parameters<CatchHandler<Hook<'prompt.submit'>>>

// A message to a step that waits goes to Claude all the same when the plan cannot be read.
export function stepAnswerFailed($: Engine, e: SubmitFailed[1], next: SubmitFailed[2]) {
  return next(e)
}
