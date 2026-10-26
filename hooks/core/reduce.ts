// What can happen to the step of a plan, and what each of those does to the plan. `decide` is
// the only thing that moves a step: it answers with a new plan, what it asks the shell to do
// about it, and the word the shell turns into a sentence. It is pure and sees no `$`, so
// everything a move needs that `core/` cannot reach - the clock, the session, the turns this
// process has open - rides on the event (2.11).
//
// Events arrive here one at a time as the plan's area is moved onto them; what is not here yet
// is still built where it always was, in `features/`.

import type { Plan, Step, StepRun, StepState } from '../../types'
import { isSummingUp, readStepResult, stepMode } from './prompts'
import { askedOf, isAway, isWaiting, nextInRun, runOf, stepState, turnOf, withRun } from './step'

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
  // /aside continue, on a step that waits for the person, goes on in the background, or was
  // left running by an earlier process of this session. `openTurns` is the turns this process
  // saw start and not end, which is how a turn of an earlier one is known dead.
  | { is: 'continue'; sessionId: string; now: number; openTurns: readonly string[] }
  // /aside stop. A paused run with no step is dropped; a step with no turn of its own left is
  // done as it stands; a step of another session is let go; the step running here is the last.
  | { is: 'stop'; sessionId: string; now: number; openTurns: readonly string[] }
  // The turn of the step running here has ended, whatever ended it: isAnswer is the engine's own
  // reason for it, `ms` what the turn took and `answer` what it said. canOrganize: /aside plan
  // asked, mid-step, for the queue to be organized once the step ends, and there is something to
  // organize - the plan holds the request, the queue is the shell's to read (2.11).
  | { is: 'turnEnded'; sessionId: string; turnId: string; isAnswer: boolean; ms: number; answer: string; now: number; canOrganize: boolean }
  // A turn of this session that will never end: one this process started, still open, other
  // than `turnId`; with isGone, the session itself ended under the step. `openTurns` is the
  // turns this process saw start and not end, and `ownWork` the calls of this process that left
  // work running, since the work of a session that ended goes with it.
  | { is: 'turnDied'; sessionId: string; turnId: string | undefined; isGone: boolean; openTurns: readonly string[]; ownWork: readonly string[]; now: number }

// What a move asks the shell to do about it, as data and never as a function: the engine
// refuses `$` passed to a property call, so a table of handlers taking it cannot exist (3.2).
export type Effect =
  // The line above the prompt counts what the move changed.
  | { does: 'refreshBand' }
  // The prompt of step `index` goes out, from a timer: a hook that holds the turn may not
  // submit one (3.8). With isClosing it is the turn that sums a run up rather than a step's own.
  | { does: 'sendStep'; index: number; isChain: boolean; then?: readonly number[]; isClosing: boolean }
  // The queue a step asked /aside plan to organize goes to Claude now that the step has ended.
  // Whoever ended its turn runs this one: features/steps.ts may not reach the hand-over (2.1),
  // so it hands the effect on. isAdding: the plan has steps left, so the queue is organized as
  // something to add to it rather than as a plan of its own.
  | { does: 'organize'; isAdding: boolean }

// The word the shell turns into a sentence for the person or for Claude. 'nothing' is a move
// that did not happen, which every event may answer with.
export type Outcome =
  | 'nothing'
  | 'ending'
  | 'waits'
  | 'last'
  | 'noted'
  | 'told'
  | 'quiet'
  | 'bound'
  | 'started'
  | 'gone'
  | 'closing'
  | 'onward'
  | 'done'
  | 'dropped'
  | 'doneAsStands'
  | 'letGo'
  | 'after'
  | 'away'
  | 'stopped'
  | 'pausing'

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

// A step running in this session on a turn this process never saw start, or saw start and never
// end: one an earlier process left when it closed in the middle of it.
const isLeftHere = (openTurns: readonly string[], active: StepState, sessionId: string) => {
  const turnId = turnOf(active)

  return active.sessionId === sessionId && turnId !== undefined && !openTurns.includes(turnId)
}

// Whether a step is one /aside continue and /aside stop may end without its turn ending.
const isEndable = (active: StepState, event: { sessionId: string; openTurns: readonly string[] }) =>
  isWaiting(active) || isAway(active) || isLeftHere(event.openTurns, active, event.sessionId)

// /aside continue. The last step of a run of several takes one more turn first, which sums the
// run up; the turn it had, the question it asked and what it was still waiting on in the
// background are all let go, and the turn that sums up is this session's.
function goOn(plan: Plan, event: Extract<StepEvent, { is: 'continue' }>): Decided {
  const active = plan.active
  if (!active || !isEndable(active, event)) {
    return nothing(plan)
  }
  if (isSummingUp(plan.steps, stepMode(plan.steps, active.step, active.isChain, active.then))) {
    const { background: _waited, ...kept } = runOf(active)
    const ending = stepState({ ...kept, sessionId: event.sessionId, is: 'ending' })
    const does: Effect[] = [{ does: 'refreshBand' }, { does: 'sendStep', index: active.step, isChain: active.isChain, ...(active.then ? { then: active.then } : {}), isClosing: true }]

    return { plan: { ...plan, active: ending }, does, outcome: 'closing' }
  }
  const made = completed(plan, active, event.sessionId, true, event.now)
  if (made.after < 0) {
    return { plan: made.plan, does: [{ does: 'refreshBand' }], outcome: 'done' }
  }
  const then = active.then?.slice(1)
  const does: Effect[] = [{ does: 'refreshBand' }, { does: 'sendStep', index: made.after, isChain: active.isChain, ...(then ? { then } : {}), isClosing: false }]

  return { plan: made.plan, does, outcome: 'onward' }
}

// /aside stop.
function stop(plan: Plan, event: Extract<StepEvent, { is: 'stop' }>): Decided {
  const active = plan.active
  const band: Effect[] = [{ does: 'refreshBand' }]
  if (!active) {
    if (plan.paused === undefined) {
      return nothing(plan)
    }
    const { paused: _dropped, ...rest } = plan

    return { plan: rest, does: band, outcome: 'dropped' }
  }
  if (isEndable(active, event) || active.is === 'ending') {
    // With nothing it said it did, the step shows that stop ended it.
    const said = withRun(active, { ...runOf(active), result: active.result ?? 'stopped' })

    return { plan: completed(plan, said, event.sessionId, false, event.now).plan, does: band, outcome: 'doneAsStands' }
  }
  const turnId = turnOf(active)
  if (turnId === undefined || active.sessionId !== event.sessionId) {
    const { active: _letGo, ...rest } = plan

    return { plan: rest, does: band, outcome: 'letGo' }
  }
  // The run stops with this step: no chain, and none of the steps /aside run named after it.
  const { then: _named, ...run } = runOf(active)
  const stopping = { ...run, isChain: false }
  const asked = askedOf(active)
  // A step that had asked the person something is done once the turn it has left ends.
  const next = asked === undefined ? withRun(active, stopping) : stepState({ ...stopping, is: 'closing', turnId, pausedFor: asked })

  return { plan: { ...plan, active: next }, does: band, outcome: 'after' }
}

// Why a run waits after a step that /aside plan asked to organize the queue after. It is the
// plan's own, read back by the listing and by the toast that says the run paused.
export const PLANNING_PAUSE = 'to organize the queue'

// What a step waits for whose turn ended with no answer the plugin heard. It is printed as it
// stands, in place of the question Claude would have left.
export const CUT_OFF = 'its turn ended without an answer'

// The turn of the step running here has ended. The branches are tried in the order the step's
// end has always tried them, and the first that holds answers: a step continue or stop ended is
// done; a question Claude asked and this turn did not answer leaves the step waiting; a turn of
// a step in the background cut short leaves it there; a turn that is no answer at all leaves no
// step; work still running keeps the step away; and otherwise the step is done, the run going on
// with the next step unless the queue is to be organized first.
function turnEnded(plan: Plan, event: Extract<StepEvent, { is: 'turnEnded' }>): Decided {
  const active = plan.active
  if (!active || turnOf(active) !== event.turnId || active.sessionId !== event.sessionId) {
    return nothing(plan)
  }
  const { isAnswer, canOrganize, now } = event
  const result = isAnswer ? readStepResult(event.answer) : undefined
  // Whatever follows, the step keeps the time this turn took and what its answer said it did.
  const said = withRun(active, { ...runOf(active), ms: (active.ms ?? 0) + event.ms, ...(result === undefined ? {} : { result }) })
  const band: Effect[] = [{ does: 'refreshBand' }]
  // Only a step that ended on an answer organizes the queue: one cut short leaves that to
  // /aside plan, and one left waiting or away has not ended at all.
  const andOrganize = (steps: readonly Step[]): Effect[] =>
    isAnswer && canOrganize ? [...band, { does: 'organize', isAdding: steps.some(one => !one.isDone) }] : band

  // continue or stop ended the step: it is done when this turn ends, whatever ends it.
  if (said.is === 'closing') {
    const { plan: ended } = completed(plan, said, event.sessionId, false, now)

    return { plan: ended, does: andOrganize(ended.steps), outcome: 'done' }
  }
  const asked = askedOf(said)
  // The turn that took the person's answer ends the step, unless Claude asked again in it.
  if (asked !== undefined && !(isAnswer && said.is === 'answering')) {
    // The request to organize the queue goes with the turn it was asked in; a turn that took an
    // answer before this one leaves the step asking for another.
    const { isPlanningAfter: _asked, ...run } = runOf(said)
    const isAgain = said.is === 'answering' || (said.is === 'asking' && said.isAnswered === true)
    const back = stepState(isAgain ? { ...run, is: 'answered', pausedFor: asked } : { ...run, is: 'waiting', pausedFor: asked })

    return { plan: { ...plan, active: back }, does: andOrganize(plan.steps), outcome: 'waits' }
  }
  // A turn of a step in the background cut short leaves it there, as one that waits.
  if (!isAnswer && said.is === 'noticing') {
    return { plan: { ...plan, active: stepState({ ...runOf(said), is: 'away' }) }, does: band, outcome: 'away' }
  }
  if (!isAnswer) {
    const { active: _stopped, ...rest } = plan

    return { plan: rest, does: band, outcome: 'stopped' }
  }
  // Work in the background a turn of it started is still running: the step goes on there, and
  // the turn that work's end brings is the one that ends it.
  if ((said.background?.length ?? 0) > 0) {
    return { plan: { ...plan, active: stepState({ ...runOf(said), is: 'away' }) }, does: band, outcome: 'away' }
  }
  // With the queue to organize first, the run waits after this step and /aside continue takes
  // it on; the next step would otherwise start inside this same change (`completed`).
  const isPausing = canOrganize && nextInRun(plan.steps, said.step, said.isChain, said.then) >= 0
  const made = completed(plan, said, event.sessionId, !isPausing, now)
  if (isPausing) {
    const paused = { step: said.step, reason: PLANNING_PAUSE, isChain: said.isChain, ...(said.then ? { then: said.then } : {}) }

    return { plan: { ...made.plan, paused }, does: andOrganize(made.plan.steps), outcome: 'pausing' }
  }
  if (made.after < 0) {
    return { plan: made.plan, does: andOrganize(made.plan.steps), outcome: 'done' }
  }
  const then = said.then?.slice(1)

  return {
    plan: made.plan,
    does: [...band, { does: 'sendStep', index: made.after, isChain: said.isChain, ...(then ? { then } : {}), isClosing: false }],
    outcome: 'onward',
  }
}

// A turn of this session that will never end, so the step lets go of it. One that continue or
// stop had ended is done, as it stands; one in the background whose work is still running goes
// back to waiting on that work; any other waits for the person, as after a step's question, so
// /aside continue ends it and goes on and /aside stop ends it there.
function turnDied(plan: Plan, event: Extract<StepEvent, { is: 'turnDied' }>): Decided {
  const active = plan.active
  if (!active || active.sessionId !== event.sessionId) {
    return nothing(plan)
  }
  const { isGone, openTurns, ownWork, now } = event
  const turnId = turnOf(active)
  if (turnId !== undefined) {
    // A turn this process never saw start belongs to another process, on the same session
    // resumed elsewhere, and so does the step: both are left to it.
    if (turnId === event.turnId || !openTurns.includes(turnId)) {
      return nothing(plan)
    }
  } else if (!isGone || isWaiting(active) || (isAway(active) && !(active.background ?? []).every(work => work.callId !== undefined && ownWork.includes(work.callId)))) {
    // With no turn of its own, only the session's own end reaches the step, and only where the
    // work it waits on was this process's: a step that waits for the person is where the
    // session's end would leave it already.
    return nothing(plan)
  }
  const band: Effect[] = [{ does: 'refreshBand' }]
  if (active.is === 'ending' || active.is === 'closing') {
    return { plan: completed(plan, active, event.sessionId, false, now).plan, does: band, outcome: 'done' }
  }
  // The request to organize the queue goes with the turn it was asked in.
  const { isPlanningAfter: _asked, background, ...rest } = runOf(active)
  // With the session itself gone, so is the work it had running, and the step's wait on it.
  const run = isGone || background === undefined ? rest : { ...rest, background }
  if (!isGone && active.is === 'noticing') {
    return { plan: { ...plan, active: stepState({ ...run, is: 'away' }) }, does: band, outcome: 'away' }
  }
  // What Claude asked the step to wait for if it asked, else that its turn ended with no answer.
  const pausedFor = askedOf(active) ?? CUT_OFF
  const next = stepState(active.is === 'answering' ? { ...run, is: 'answered', pausedFor } : { ...run, is: 'waiting', pausedFor })

  return { plan: { ...plan, active: next }, does: band, outcome: 'waits' }
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
    case 'continue':
      return goOn(plan, event)
    case 'stop':
      return stop(plan, event)
    case 'turnEnded':
      return turnEnded(plan, event)
    case 'turnDied':
      return turnDied(plan, event)
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
