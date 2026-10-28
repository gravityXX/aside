// Nothing here reaches for the hand-over or for the commands, which is what keeps the imports of
// this area going one way (2.1): a step that asked for the queue to be organized says so to
// whoever ended its turn, rather than organizing it itself. The queries the rest of the plan
// shares, such as why nothing new may start while a step runs, live here beside the state they
// read. It is a little past the 400 lines 2.4 prefers and stays one file on purpose (1.2): a
// step's prompt going out, the turns bound to it and its end are one chain of events, and a cut
// anywhere along it would put two halves of the same walk in two places.

import type { Args, CatchHandler, Hook } from 'claude-code'

import type { Plan, Step } from '../../types'
import type { Context } from '../context'
import { answerContext, closingPrompt, isSummingUp, stepMode, stepPrompt } from '../core/prompts'
import { PLANNING_PAUSE, decide, writeInto } from '../core/reduce'
import type { Effect } from '../core/reduce'
import { askedOf, awayWork, isAway, isWaiting, turnOf } from '../core/step'
import { describeError, formatCount, formatDuration } from '../core/text'
import { changePlan } from '../io/plan'
import { readQueue } from '../io/queue'
import { loadPlan, projectKeys, refreshBand } from '../io/store'
import type { Kit } from '../kit'
import { tagsInFiles } from './queue'

// From a timer, since neither a command's hook nor a turn's end may submit a prompt while
// it holds the turn; `onFail` hears why, once, when a hook beneath drops it, the engine
// refuses it or composing it fails. Nothing here is left to throw unheard in the timer.
export function submitLater($: Kit, compose: () => Promise<string | undefined>, onFail: (why: string) => Promise<void>) {
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
export async function hasItems($: Kit): Promise<boolean> {
  return (await readQueue($, 'oldest')).length > 0 || (await tagsInFiles($, true)).length > 0
}

// Lets go of the step `index` that never started (its prompt was dropped or refused),
// unless something else took its place meanwhile. A step that continue ended, whose prompt
// was only to sum the run up, is done as it stands.
async function releaseStep($: Kit, ctx: Context, index: number, why: string) {
  const now = await $.clock.now()
  const made = await changePlan($, plan => {
    const was = plan.active
    const out = decide(plan, { is: 'promptDropped', index, now })
    writeInto(plan, out.plan)

    // The step as it was: its own sentence says whether /aside plan still has anything to do.
    return { outcome: out.outcome, does: out.does, plan: structuredClone(out.plan), was: out.outcome === 'nothing' || was === undefined ? undefined : structuredClone(was) }
  })
  await runEffects($, ctx, made.plan, made.does)
  $.ui.toast(
    made.outcome === 'ending'
      ? `Could not ask Claude to sum the run up (${why}); step ${index + 1} is done as it stands.`
      : `Could not send step ${index + 1} of the plan: ${why}${await organizeHint($, made.was)}`,
  )
}

// What a step that never ran, or was cut short, adds to its message when /aside plan was to
// organize the queue once it ended: that /aside plan does it now, if there is anything to.
const ORGANIZE_HINT = '; /aside plan organizes the queue'

export async function organizeHint($: Kit, active: Plan['active'] | undefined): Promise<string> {
  return active?.isPlanningAfter && (await hasItems($)) ? ORGANIZE_HINT : ''
}

// With `isChain` the next step not done follows when this one ends, with `then` those steps in
// that order. A stop that lands before its prompt goes out keeps
// it from going out at all. With `paused`, the step runs alone out of a paused run, which
// stays paused after it for /aside continue.
export async function startStep($: Kit, ctx: Context, index: number, isChain: boolean, then?: readonly number[], paused?: Plan['paused']) {
  const sessionId = await $.session.id()
  const made = await changePlan($, plan => {
    const out = decide(plan, { is: 'start', sessionId, index, isChain, ...(then ? { then } : {}), ...(paused ? { paused } : {}) })
    writeInto(plan, out.plan)

    return { plan: structuredClone(out.plan), does: out.does }
  })
  await runEffects($, ctx, made.plan, made.does)
}

// What a move asked for, done in the order it asked for it. The sentences a move leads to stay
// here rather than in `core/`, built from its outcome: one of them has to read the queue.
export async function runEffects($: Kit, ctx: Context, plan: Plan, does: readonly Effect[]) {
  for (const one of does) {
    switch (one.does) {
      case 'refreshBand':
        await refreshBand($)
        break
      case 'sendStep':
        sendStep($, ctx, plan.steps, one.index, one.isChain, one.then, one.isClosing)
        break
      // Handed on to whoever ended the turn instead: the hand-over is out of this file's
      // reach, which is what keeps its imports going one way (2.1).
      case 'organize':
        break
    }
  }
}

// Sends the prompt of step `index`, which the plan holds as running, unless a stop or another
// run took its place before it goes out; with isClosing, the turn that ends the last step of a
// run that waited, and sums the run up.
function sendStep($: Kit, ctx: Context, steps: readonly Step[], index: number, isChain: boolean, then: readonly number[] | undefined, isClosing = false) {
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
export async function runningHere($: Kit, plan: Plan): Promise<string | undefined> {
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

// /aside continue on a step that waits for the person, in this session or one before it: it
// is done, and its run goes on here. The last step of a run of several takes one more turn
// first, which sums the run up and then ends it, as it stands if that turn is cut short, with
// nothing after it: steps added meanwhile wait for /aside run. Undefined when no step waits.
export async function goOnFromWaiting($: Kit, ctx: Context): Promise<string | undefined> {
  const me = await $.session.id()
  const now = await $.clock.now()
  const end = await changePlan($, plan => {
    const was = plan.active
    // Read before the move: the note is about the step that was running, wherever it ran.
    const note = was === undefined || was.sessionId === me ? '' : takeOverNote(plan)
    const out = decide(plan, { is: 'continue', sessionId: me, now, openTurns: [...ctx.session.openTurns] })
    if (out.outcome === 'nothing') return undefined
    writeInto(plan, out.plan)

    return { was: structuredClone(was!), plan: structuredClone(out.plan), does: out.does, outcome: out.outcome, note }
  })
  if (end === undefined) {
    return undefined
  }
  const { was, plan, does, outcome, note } = end
  const n = was.step + 1
  await runEffects($, ctx, plan, does)
  if (outcome === 'closing') {
    return `Step ${n} ends here; Claude sums the run up.${note}`
  }
  if (outcome === 'onward') {
    const named = was.then === undefined ? '' : `: steps ${was.then.map(i => i + 1).join(', ')}`

    return `Step ${n} done; going on with the plan from step ${plan.active!.step + 1}${named}. /aside stop stops after the current one.${note}`
  }

  return `${plan.steps.every(one => one.isDone) ? doneText(plan.steps) : `Step ${n} done.`}${note}`
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
export async function bindStepTurn($: Kit, ctx: Context, turnId: string) {
  const sessionId = await $.session.id()
  const now = await $.clock.now()
  await changePlan($, plan => {
    writeInto(plan, decide(plan, { is: 'bindTurn', sessionId, turnId, now }).plan)
  })
}

// A turn of this session while its step waits for the person belongs to the step: their
// answer, or whatever else Claude does meanwhile, such as a background task's notice, so the
// step shows as running and keeps the time. The plugin's own prompts never come here.
export async function bindAnswerTurn($: Kit, ctx: Context, turnId: string, text: string) {
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
    const made = decide(plan, { is: 'bindAnswer', sessionId: me, turnId, isAnswer, isTold, isNotice })
    writeInto(plan, made.plan)

    return made.outcome === 'bound'
  })
  if (isBound) await refreshBand($)
}

type Submit = Parameters<Hook<'prompt.submit'>>

// What the person types to a step that waits for them here (the hook's matcher lets only that
// through) goes to Claude with what it most likely answers and how to go on with that step,
// never shown to them; the turn it starts is then the step's, and takes up their answer. Typed
// over a running turn, it may go into that turn, so it gets no context, but a turn of its own
// later still takes up the answer.
export async function noteStepAnswer(ctx: Context, $: Kit, e: Submit[1], next: Submit[2]) {
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

// The step of session `sessionId` whose turn will never end: one this process started, still
// open, other than `turnId`; with isGone, the session itself ended, so also its work in the
// background that calls here started, and a step whose turn never started. Where that leaves the
// step is `turnDied` in core/reduce.ts; only a step left waiting has anything to say about it,
// and a session that is gone says nothing at all.
export async function dropDeadTurn($: Kit, ctx: Context, sessionId: string, turnId: string | undefined, isGone: boolean) {
  const { openTurns, ownWork } = ctx.session
  const now = await $.clock.now()
  const dropped = await changePlan($, async plan => {
    const was = plan.active
    const out = decide(plan, { is: 'turnDied', sessionId, turnId, isGone, openTurns: [...openTurns], ownWork: [...ownWork], now })
    if (out.outcome === 'nothing') {
      return undefined
    }
    writeInto(plan, out.plan)

    // Asked of the step as it was: the request to organize the queue is let go with the turn.
    return { n: was!.step + 1, plan: structuredClone(out.plan), does: out.does, outcome: out.outcome, hint: await organizeHint($, was) }
  })
  if (dropped === undefined) {
    return
  }
  await runEffects($, ctx, dropped.plan, dropped.does)
  if (!isGone && dropped.outcome === 'waits') {
    $.ui.toast(`Step ${dropped.n}'s turn never ended; it waits, and /aside continue ends it and goes on${dropped.hint}.`)
  }
}

// The session ends: a turn of a step it runs never ends now.
export async function endSessionSteps(ctx: Context, $: Kit, e: SessionEnd[1], next: SessionEnd[2]) {
  await dropDeadTurn($, ctx, e.sessionId, undefined, true)

  return next(e)
}

// What the turn's end hands on to whoever ended it, since only they can reach the hand-over.
type Organize = Extract<Effect, { does: 'organize' }>

// The turn of the step running here ends, whatever ended it; where that leaves the step is
// `turnEnded` in core/reduce.ts, and what the person reads of it is here. So is the one thing
// the decision cannot see for itself: whether there is a queue for /aside plan to organize. The
// plan is read again as it is changed, since a planner may have added steps since the turn's end
// read it, and the step that follows is marked running in that same change, so nothing in
// between finds the run with no step.
export async function finishStep($: Kit, ctx: Context, e: TurnComplete[1]): Promise<Organize | undefined> {
  const me = await $.session.id()
  const now = await $.clock.now()
  const isAnswer = e.reason === 'answer'
  const end = await changePlan($, async plan => {
    const was = plan.active
    // The queue is read for a step that asked for it to be organized and for no other, and
    // before the move, which lets that request go with the turn it was asked in.
    const canOrganize = was?.isPlanningAfter === true && (await hasItems($))
    const out = decide(plan, { is: 'turnEnded', sessionId: me, turnId: e.turnId, isAnswer, ms: e.durationMs, answer: e.answer, now, canOrganize })
    if (out.outcome === 'nothing') {
      return undefined
    }
    writeInto(plan, out.plan)

    return { was: structuredClone(was!), plan: structuredClone(out.plan), does: out.does, outcome: out.outcome, canOrganize }
  })
  if (end === undefined) {
    return undefined
  }
  const { was, plan, does, outcome, canOrganize } = end
  const n = was.step + 1
  await runEffects($, ctx, plan, does)
  // Cut short, the step organizes nothing, as any step's turn: the toast says /aside plan does.
  const hint = !isAnswer && canOrganize ? ORGANIZE_HINT : ''
  const active = plan.active
  if (active !== undefined && isAway(active)) {
    const work = awayWork(active)
    $.ui.toast(
      work
        ? `Step ${n} goes on in the background (${work}); it ends once that work is done and Claude has answered it, or /aside continue ends it now.`
        : `Step ${n} waits for /aside continue, which ends it: its work in the background is done.`,
    )
  } else if (active !== undefined && isWaiting(active)) {
    // Asked of the state, not of a flag carried beside it: only a state that holds a question
    // can be read for one, so it can never come out as "undefined".
    $.ui.toast(
      active.is === 'answered'
        ? `Step ${n} waits: answer again, and Claude's reply ends it, or /aside continue ends it now${hint}.`
        : `Step ${n} waits for your answer: ${active.pausedFor}. Answer as usual, and the step ends with Claude's reply; /aside continue ends it now${hint}.`,
    )
  } else if (outcome === 'stopped') {
    $.ui.toast(`Plan stopped: step ${n} ${e.reason === 'aborted' ? 'was interrupted' : 'did not finish'}${hint}`)
  } else if (outcome === 'pausing') {
    $.ui.toast(`Plan paused after step ${n}: ${PLANNING_PAUSE}. /aside continue goes on.`)
  } else if (outcome === 'done') {
    $.ui.toast(`${plan.steps.every(one => one.isDone) ? doneText(plan.steps) : `Step ${n} done`}${hint}`)
  }

  return does.find((one): one is Organize => one.does === 'organize')
}

export type TurnComplete = Parameters<Hook<'turn.complete'>>

type SubmitFailed = Parameters<CatchHandler<Hook<'prompt.submit'>>>

// A message to a step that waits goes to Claude all the same when the plan cannot be read.
export function stepAnswerFailed($: Kit, e: SubmitFailed[1], next: SubmitFailed[2]) {
  return next(e)
}
