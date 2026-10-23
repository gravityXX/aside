// What can happen to the step of a plan, and what each of those does to the plan. `decide` is
// the only thing that moves a step: it answers with a new plan, what it asks the shell to do
// about it, and the word the shell turns into a sentence. It is pure and sees no `$`, so
// everything a move needs that `core/` cannot reach - the clock, the session, the turns this
// process has open - rides on the event (2.11).
//
// Events arrive here one at a time as the plan's area is moved onto them; what is not here yet
// is still built where it always was, in `features/`.

import type { Plan, Step, StepRun, StepState } from '../../types'
import { isSummingUp, stepMode } from './prompts'
import { isAway, isWaiting, nextInRun, runOf, stepState, turnOf, withRun } from './step'

export type StepEvent =
  // Claude asked the person something with the wait tool, in the turn of the step it is working
  // on. The step's own turn is the one it keeps; the tool brings no turn of its own.
  | { is: 'ask'; sessionId: string; pausedFor: string }
  // A call of the step's own turn left work running in the background, so the step does not end
  // before that work does. `turnId` is the turn the call ran in.
  | { is: 'workStarted'; sessionId: string; turnId: string | undefined; callId?: string; taskId: string; what: string }
  // Claude stopped the work, which sends no notification: it leaves the step at once.
  | { is: 'workStopped'; sessionId: string; turnId: string | undefined; taskId: string }
  // The work's own notification, whatever its status. `turnId` is the turn it was delivered
  // into, if it landed in one already running.
  | { is: 'workEnded'; sessionId: string; turnId?: string; taskId?: string; callId?: string }
  // The turn of the step's own prompt started. `now` is when, by the clock, so the step's first
  // turn stamps the time it has been running since.
  | { is: 'bindTurn'; sessionId: string; turnId: string; now: number }
  // A turn of this session that is not the step's own prompt started while the step waits or
  // goes on in the background. The shell reads what it is from `ctx.session`, which `core/`
  // cannot see: isAnswer, that the person's message started it; isTold, that the message went
  // with the step's own words, so Claude's reply to it ends the step; isNotice, that a
  // background task's notification started it.
  | { is: 'bindAnswer'; sessionId: string; turnId: string; isAnswer: boolean; isTold: boolean; isNotice: boolean }
  // A run starts step `index`: with isChain the next step not done follows when it ends, with
  // `then` the steps /aside run named instead, and with `paused` the step runs alone out of a
  // paused run, which stays paused after it.
  | { is: 'start'; sessionId: string; index: number; isChain: boolean; then?: readonly number[]; paused?: Plan['paused'] }
  // The prompt of step `index` never went out: a hook beneath dropped it, or the engine refused
  // it. `now` is when, by the clock, for a step that is done as it stands.
  | { is: 'promptDropped'; index: number; now: number }

// What a move asks the shell to do about it, as data and never as a function: the engine
// refuses `$` passed to a property call, so a table of handlers taking it cannot exist (3.2).
export type Effect =
  // The line above the prompt counts what the move changed.
  | { does: 'refreshBand' }
  // The prompt of step `index` goes out, from a timer: a hook that holds the turn may not
  // submit one (3.8). With isClosing it is the turn that sums a run up rather than a step's own.
  | { does: 'sendStep'; index: number; isChain: boolean; then?: readonly number[]; isClosing: boolean }

// The word the shell turns into a sentence for the person or for Claude. 'nothing' is a move
// that did not happen, which every event may answer with.
export type Outcome = 'nothing' | 'ending' | 'waits' | 'last' | 'noted' | 'told' | 'quiet' | 'bound' | 'started' | 'gone'

export type Decided = { plan: Plan; does: readonly Effect[]; outcome: Outcome }

const nothing = (plan: Plan): Decided => ({ plan, does: [], outcome: 'nothing' })

// The step `active` runs, done at `now`, with the time it took and what its last turn said.
// With isGoingOn the next step of the run starts in the same answer, so nothing in between
// finds the run with no step. `after` is that step's index, or -1 when none follows.
export function completed(plan: Plan, active: StepState, me: string, isGoingOn: boolean, now: number): { plan: Plan; after: number } {
  const step = plan.steps[active.step]!
  // The time by the clock, waits for the person included; never less than its turns took.
  const ms = Math.max(active.ms ?? 0, active.startedAt === undefined ? 0 : now - active.startedAt)
  const steps = plan.steps.map((one, i) =>
    i === active.step ? { ...step, isDone: true as const, ms, doneAt: now, ...(active.result ? { result: active.result } : {}) } : one,
  )
  const after = isGoingOn ? nextInRun(steps, active.step, active.isChain, active.then) : -1
  const { active: _done, paused, ...rest } = plan
  if (after < 0) {
    return { plan: { ...rest, ...(paused ? { paused } : {}), steps }, after }
  }
  const then = active.then?.slice(1)
  const next = stepState({ step: after, isChain: active.isChain, sessionId: me, ...(then ? { then } : {}), is: 'due' })

  return { plan: { ...rest, steps, active: next }, after }
}

// Claude's question, asked in the turn of the step it is working on. The question is new, so an
// answer a turn took before it no longer ends the step, and a step that was in the background
// waits from here, keeping the work on its record. A step that continue or stop already ended
// is not asked again: it says so instead.
function ask(plan: Plan, event: Extract<StepEvent, { is: 'ask' }>): Decided {
  const active = plan.active
  if (!active) {
    return nothing(plan)
  }
  const turnId = turnOf(active)
  if (turnId === undefined || active.sessionId !== event.sessionId) {
    return nothing(plan)
  }
  if (active.is === 'closing') {
    return { plan, does: [], outcome: 'ending' }
  }
  const asking = stepState({ ...runOf(active), is: 'asking', turnId, pausedFor: event.pausedFor })
  const mode = stepMode(plan.steps, asking.step, asking.isChain, asking.then)

  return { plan: { ...plan, active: asking }, does: [], outcome: isSummingUp(plan.steps, mode) ? 'last' : 'waits' }
}

// The work a turn of the step started, kept on the step's record until its notification comes.
// The turn has to be the one running now: work a call of anything else started is not the
// step's.
function workStarted(plan: Plan, event: Extract<StepEvent, { is: 'workStarted' }>): Decided {
  const active = plan.active
  const turnId = active === undefined ? undefined : turnOf(active)
  if (!active || turnId === undefined || active.sessionId !== event.sessionId || turnId !== event.turnId) {
    return nothing(plan)
  }
  const { callId, taskId, what } = event
  const background = [...(active.background ?? []), { ...(callId ? { callId } : {}), taskId, what }]

  return { plan: { ...plan, active: withRun(active, { ...runOf(active), background }) }, does: [], outcome: 'noted' }
}

// The step with `left` as the work it still waits on: with none left and the step away in this
// session, the turn that brought the news is the step's, and that turn's end ends it.
const withWork = (plan: Plan, left: readonly { callId?: string; taskId: string; what: string }[], turnId: string | undefined, isMine: boolean) => {
  const active = plan.active!
  const { background: _gone, ...run } = runOf(active)
  const rest: StepRun = left.length > 0 ? { ...run, background: [...left] } : run
  const isTold = isMine && isAway(active)

  return {
    active: isTold && turnId !== undefined ? stepState({ ...rest, is: 'noticing', turnId }) : withRun(active, rest),
    isTold,
  }
}

function workStopped(plan: Plan, event: Extract<StepEvent, { is: 'workStopped' }>): Decided {
  const active = plan.active
  const left = active?.background?.filter(one => one.taskId !== event.taskId)
  if (!active?.background || left === undefined || left.length === active.background.length) {
    return nothing(plan)
  }
  // Only a step left with no work at all takes the turn that stopped it.
  const isMine = left.length === 0 && active.sessionId === event.sessionId
  const { active: next } = withWork(plan, left, event.turnId, isMine)

  return { plan: { ...plan, active: next }, does: [], outcome: 'quiet' }
}

function workEnded(plan: Plan, event: Extract<StepEvent, { is: 'workEnded' }>): Decided {
  const active = plan.active
  const left = active?.background?.filter(one => one.taskId !== event.taskId && (event.callId === undefined || one.callId !== event.callId))
  if (!active?.background || left === undefined || left.length === active.background.length) {
    return nothing(plan)
  }
  const { active: next, isTold } = withWork(plan, left, event.turnId, active.sessionId === event.sessionId)

  return { plan: { ...plan, active: next }, does: [], outcome: isTold ? 'told' : 'quiet' }
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

// The step's own prompt has started its turn. The step's first turn stamps when it began, so
// the listing counts from there and not from when the prompt was asked for.
function bindTurn(plan: Plan, event: Extract<StepEvent, { is: 'bindTurn' }>): Decided {
  const active = plan.active
  if (!active || turnOf(active) !== undefined || active.sessionId !== event.sessionId) {
    return nothing(plan)
  }
  const started = withRun(active, { ...runOf(active), startedAt: active.startedAt ?? event.now })

  return { plan: { ...plan, active: withStepTurn(started, event.turnId) }, does: [], outcome: 'bound' }
}

// Any other turn of this session, while the step waits for the person or goes on in the
// background. A step in the background takes only the turn of its work's notification, never
// one of the person's own.
function bindAnswer(plan: Plan, event: Extract<StepEvent, { is: 'bindAnswer' }>): Decided {
  const active = plan.active
  if (!active || active.sessionId !== event.sessionId) {
    return nothing(plan)
  }
  if (isAway(active)) {
    if (!event.isNotice) {
      return nothing(plan)
    }

    return { plan: { ...plan, active: stepState({ ...runOf(active), is: 'noticing', turnId: event.turnId }) }, does: [], outcome: 'bound' }
  }
  if (!isWaiting(active)) {
    return nothing(plan)
  }
  const { pausedFor } = active
  const run = runOf(active)
  // An answer taken before this turn still counts: the step says "answer again" until Claude
  // asks something new (`ask`), which is the one place that mark is let go.
  const isAnswerTaken = event.isAnswer || active.is === 'answered'
  // Only an answer sent with the step's own words makes this turn the one whose reply ends the
  // step; any other turn of this session leaves it waiting for the next answer.
  const next = event.isTold
    ? stepState({ ...run, is: 'answering', turnId: event.turnId, pausedFor })
    : stepState({ ...run, is: 'asking', turnId: event.turnId, pausedFor, ...(isAnswerTaken ? { isAnswered: true as const } : {}) })

  return { plan: { ...plan, active: next }, does: [], outcome: 'bound' }
}

// A run starting a step. A step that starts, the run going on or a new one, ends any pause but
// its own, and nothing is asked of the step that was there: the run took it over already.
function start(plan: Plan, event: Extract<StepEvent, { is: 'start' }>): Decided {
  const { index, isChain, then, paused, sessionId } = event
  const active = stepState({ step: index, isChain, sessionId, ...(then ? { then: [...then] } : {}), is: 'due' })
  const { paused: _was, ...rest } = plan

  return {
    plan: { ...rest, ...(paused ? { paused } : {}), active },
    does: [{ does: 'refreshBand' }, { does: 'sendStep', index, isChain, ...(then ? { then } : {}), isClosing: false }],
    outcome: 'started',
  }
}

// The prompt of a step that never went out. A step continue or stop had ended, whose prompt was
// only to sum the run up, is done as it stands; any other is let go. A step something else took
// the place of meanwhile is left alone.
function promptDropped(plan: Plan, event: Extract<StepEvent, { is: 'promptDropped' }>): Decided {
  const active = plan.active
  if (active?.step !== event.index || turnOf(active) !== undefined) {
    return nothing(plan)
  }
  if (active.is === 'ending') {
    return { plan: completed(plan, active, active.sessionId, false, event.now).plan, does: [{ does: 'refreshBand' }], outcome: 'ending' }
  }
  const { active: _gone, ...rest } = plan

  return { plan: rest, does: [{ does: 'refreshBand' }], outcome: 'gone' }
}

export function decide(plan: Plan, event: StepEvent): Decided {
  switch (event.is) {
    case 'ask':
      return ask(plan, event)
    case 'workStarted':
      return workStarted(plan, event)
    case 'workStopped':
      return workStopped(plan, event)
    case 'workEnded':
      return workEnded(plan, event)
    case 'bindTurn':
      return bindTurn(plan, event)
    case 'bindAnswer':
      return bindAnswer(plan, event)
    case 'start':
      return start(plan, event)
    case 'promptDropped':
      return promptDropped(plan, event)
  }
}

// The plan a move made, written into the one changePlan holds, field by field: a field the move
// left out goes, and one it kept keeps the place it had, so two plans that say the same thing
// still stringify alike and changePlan writes only when the move moved something (2.9).
export function writeInto(plan: Plan, made: Plan) {
  plan.steps = made.steps as Step[]
  if (made.active === undefined) delete plan.active
  else plan.active = made.active
  if (made.paused === undefined) delete plan.paused
  else plan.paused = made.paused
  if (made.adding === undefined) delete plan.adding
  else plan.adding = made.adding
}
