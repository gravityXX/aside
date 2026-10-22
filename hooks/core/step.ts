import type { Plan, Step, StepRun, StepState, StoredActive } from '../../types'

// The step's own fields, in the one order every state keeps them in, so a state built by a
// writer and the same state read back from the store stringify alike: changePlan writes only
// when JSON.stringify of the plan moved (2.9), and savePlanSteps drops a planner's whole save
// when the plan it was given no longer stringifies the same (3.16). Every state goes through
// stepState below, which is the only place these keys are laid out.
export const runOf = (run: StepRun): StepRun => ({
  step: run.step,
  isChain: run.isChain,
  sessionId: run.sessionId,
  ...(run.then === undefined ? {} : { then: run.then }),
  ...(run.ms === undefined ? {} : { ms: run.ms }),
  ...(run.result === undefined ? {} : { result: run.result }),
  ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
  ...(run.isPlanningAfter === undefined ? {} : { isPlanningAfter: run.isPlanningAfter }),
  ...(run.background === undefined ? {} : { background: run.background }),
})

// The state with its keys in that one order. Each writer in features/plan.ts hands its new
// state here, so no two of them lay the same state out two ways.
export const stepState = (state: StepState): StepState => {
  const run = runOf(state)
  switch (state.is) {
    case 'due':
      return { ...run, is: 'due' }
    case 'running':
      return { ...run, is: 'running', turnId: state.turnId }
    case 'asking':
      return {
        ...run,
        is: 'asking',
        turnId: state.turnId,
        pausedFor: state.pausedFor,
        ...(state.isAnswered === undefined ? {} : { isAnswered: state.isAnswered }),
      }
    case 'answering':
      return { ...run, is: 'answering', turnId: state.turnId, pausedFor: state.pausedFor }
    case 'waiting':
      return { ...run, is: 'waiting', pausedFor: state.pausedFor }
    case 'answered':
      return { ...run, is: 'answered', pausedFor: state.pausedFor }
    case 'noticing':
      return { ...run, is: 'noticing', turnId: state.turnId }
    case 'away':
      return { ...run, is: 'away' }
    case 'ending':
      return { ...run, is: 'ending', ...(state.pausedFor === undefined ? {} : { pausedFor: state.pausedFor }) }
    case 'closing':
      return { ...run, is: 'closing', turnId: state.turnId, ...(state.pausedFor === undefined ? {} : { pausedFor: state.pausedFor }) }
  }
}

// The stored flags as the state they stand for, for every combination the store can hold, not
// only those a release writes (2.7). The marks are tested in the precedence every reader of
// them has always used: isEnding first (pausePlanFromTool, stopPlan, dropDeadTurn and
// finishStep all test it before the rest), then pausedFor, then isAway.
//
// Two combinations no release writes are read rather than kept apart, and both are out of
// reach of this one (1.2): isEnding beside pausedFor with no turn reads as ending, which is
// where stopPlan sent it already, and isEnding beside isAway with no turn reads as ending too,
// since goOnFromWaiting, the one writer of isEnding without a turn, deletes isAway in the same
// change.
export const readActive = (stored: StoredActive): StepState => {
  const { turnId, pausedFor } = stored
  if (stored.isEnding === true) {
    return stepState(turnId === undefined ? { ...stored, is: 'ending' } : { ...stored, is: 'closing', turnId })
  }
  if (pausedFor !== undefined) {
    if (turnId === undefined) {
      return stepState(stored.isAnswered === true ? { ...stored, is: 'answered', pausedFor } : { ...stored, is: 'waiting', pausedFor })
    }

    return stepState(
      stored.answerTurnId === turnId ? { ...stored, is: 'answering', turnId, pausedFor } : { ...stored, is: 'asking', turnId, pausedFor },
    )
  }
  if (stored.isAway === true) {
    return stepState(turnId === undefined ? { ...stored, is: 'away' } : { ...stored, is: 'noticing', turnId })
  }

  return stepState(turnId === undefined ? { ...stored, is: 'due' } : { ...stored, is: 'running', turnId })
}

// The state as the flags an earlier release reads, each left out when false (2.8). Every state
// writes back the marks it was read from, so a session of such a release on this machine finds
// the record it would have written itself (2.6, 3.17).
export const storedActive = (state: StepState): StoredActive => {
  const run = runOf(state)
  switch (state.is) {
    case 'due':
      return run
    case 'running':
      return { ...run, turnId: state.turnId }
    case 'asking':
      return {
        ...run,
        turnId: state.turnId,
        pausedFor: state.pausedFor,
        ...(state.isAnswered === undefined ? {} : { isAnswered: state.isAnswered }),
      }
    case 'answering':
      return { ...run, turnId: state.turnId, pausedFor: state.pausedFor, isAnswered: true, answerTurnId: state.turnId }
    case 'waiting':
      return { ...run, pausedFor: state.pausedFor }
    case 'answered':
      return { ...run, pausedFor: state.pausedFor, isAnswered: true }
    case 'noticing':
      return { ...run, turnId: state.turnId, isAway: true }
    case 'away':
      return { ...run, isAway: true }
    case 'ending':
      return { ...run, ...(state.pausedFor === undefined ? {} : { pausedFor: state.pausedFor }), isEnding: true }
    case 'closing':
      return { ...run, turnId: state.turnId, ...(state.pausedFor === undefined ? {} : { pausedFor: state.pausedFor }), isEnding: true }
  }
}

// The turn of the step running now, if one runs: the five states that carry one.
export const turnOf = (active: StepState): string | undefined => ('turnId' in active ? active.turnId : undefined)

// What Claude asked the person, if the step has asked: the question the listing and the toasts
// print as it stands, kept through the turns that answer it and through continue and stop, so
// /aside stop in another session still reads "at step n" over "before".
export const askedOf = (active: StepState): string | undefined => ('pausedFor' in active ? active.pausedFor : undefined)

// Whether the step waits for the person's answer with no turn of it running, so the turn of
// their answer, /aside continue or /aside stop ends it. An ending step that still holds its
// question counts, as the flags it is read from have always counted it (readActive).
export type Waiting = StepRun & ({ is: 'waiting' | 'answered'; pausedFor: string } | { is: 'ending'; pausedFor: string })

export const isWaiting = (active: StepState): active is Waiting =>
  active.is === 'waiting' || active.is === 'answered' || (active.is === 'ending' && active.pausedFor !== undefined)

// Whether the step goes on in the background with no turn of it running: work a turn of it
// started was still going when that turn ended, and the turn the work's end brings ends the
// step. A step Claude has asked the person something in waits instead, whatever it left
// running, which is why no asking state reaches here.
export const isAway = (active: StepState) => active.is === 'away'

// What a step that goes on in the background waits for, by name.
export const awayWork = (active: StepState) => [...new Set((active.background ?? []).map(one => one.what))].join(', ')

// The step that follows `index` in its run: the first of `then` when /aside run named the
// steps, the next one not done in a chain, none for a step run on its own.
export function nextInRun(steps: readonly Step[], index: number, isChain: boolean, then: readonly number[] | undefined): number {
  if (then !== undefined) {
    return then[0] ?? -1
  }

  return isChain ? steps.findIndex((step, i) => i > index && !step.isDone) : -1
}

// Whether `turnId` is the turn of this session's prompt that adds to the plan.
export const isAddingTurn = (plan: Plan, me: string, turnId: string | undefined) =>
  plan.adding?.sessionId === me && plan.adding.turnId !== undefined && plan.adding.turnId === turnId
