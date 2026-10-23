// What can happen to the step of a plan, and what each of those does to the plan. `decide` is
// the only thing that moves a step: it answers with a new plan, what it asks the shell to do
// about it, and the word the shell turns into a sentence. It is pure and sees no `$`, so
// everything a move needs that `core/` cannot reach - the clock, the session, the turns this
// process has open - rides on the event (2.11).
//
// Events arrive here one at a time as the plan's area is moved onto them; what is not here yet
// is still built where it always was, in `features/`.

import type { Plan, Step, StepRun } from '../../types'
import { isSummingUp, stepMode } from './prompts'
import { isAway, runOf, stepState, turnOf, withRun } from './step'

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

// What a move asks the shell to do about it, as data and never as a function: the engine
// refuses `$` passed to a property call, so a table of handlers taking it cannot exist (3.2).
export type Effect = { does: 'refreshBand' }

// The word the shell turns into a sentence for the person or for Claude. 'nothing' is a move
// that did not happen, which every event may answer with.
export type Outcome = 'nothing' | 'ending' | 'waits' | 'last' | 'noted' | 'told' | 'quiet'

export type Decided = { plan: Plan; does: readonly Effect[]; outcome: Outcome }

const nothing = (plan: Plan): Decided => ({ plan, does: [], outcome: 'nothing' })

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
