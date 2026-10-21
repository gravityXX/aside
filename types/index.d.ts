// What a queued entry is: a plain idea, or a comment on something the agents wrote.
export type Kind = 'idea' | 'question' | 'change' | 'drop' | 'deeper'

export type Entry = {
  text: string
  // The line as typed, "+" included: what /aside edit puts back in the prompt box.
  raw?: string
  at: number
  kind: Kind
  file?: string
  line?: number
  heading?: string
  quote?: string
  // The quoted text was kept, but no file holds it; `from` says where it came from.
  isLoose?: true
  from?: 'terminal' | 'clipboard'
  // What the last tool printed when the comment came (an error first), for context.
  output?: string
  // The task that was running, and the branch, when the entry came.
  task?: string
  branch?: string
  // Read from a <!-- ? --> tag in a file, not typed at the prompt.
  isTag?: true
}

export type Step = {
  title: string
  prompt: string
  isDone?: true
  // What the step's answer said it did and left open (its "Result:" line), how long it took
  // by the clock from its start to its end (in earlier releases, how long its turns ran), and
  // when, by the clock, it was done, kept once it is done for the summary at the end of
  // the run and the log.
  result?: string
  ms?: number
  doneAt?: number
}

// A plan run to its end, in the log once another took its place: when its last step was done,
// and each step's title, time and result.
export type PastRun = { at: number; steps: { title: string; ms?: number; result?: string }[] }

export type Plan = {
  steps: Step[]
  // The step running now, as loadPlan read it from the flags the store holds and savePlan
  // writes back (readActive and storedActive in hooks/core/step.ts). The store itself is
  // unchanged: StoredActive below is what every release up to 0.37.1 holds, and the two shapes
  // meet in that one file (4.8).
  active?: StepState
  // A run that paused after a step, as /aside plan asked (or, in earlier releases, the wait
  // tool): the step it paused after, why, and how the run was to go on (as a chain, or with the
  // steps /aside run named), until it goes on or stops.
  paused?: { step: number; reason: string; isChain: boolean; then?: number[] }
  // A planning prompt that adds to the plan, sent by session sessionId: turnId names its turn
  // once it starts, and in that turn the plan tool saves its steps after the first `after`
  // steps, the plan's own, which it leaves as they are. Gone once that turn ends.
  adding?: { after: number; sessionId: string; turnId?: string }
}

// Where the step running stands: one closed set, so a switch over `is` covers every state and
// TypeScript flags a new one nobody handles (4.5, 4.6). The states with a turnId have a turn of
// the step running, so only that turn's end moves the step on; those without are open with no
// turn, and the person's answer, /aside continue or /aside stop ends them from any session.
// One reading this cannot answer is isLeftHere in hooks/features/plan.ts: whether a turn is
// still alive is this process's own state, not the plan's.
export type StepState = StepRun &
  (
    // Its prompt is on its way out: only in this state does the prompt still go out, and a stop
    // that lands first keeps it from going out at all.
    | { is: 'due' }
    // A turn of the step's own prompt runs.
    | { is: 'running'; turnId: string }
    // Claude asked the person something with the wait tool (pausedFor) and a turn still runs:
    // the turn it asked in, or a later one of this session that is not the answer the step was
    // told about. isAnswered: a turn has taken an answer since Claude last asked, so the step
    // says "answer again" once it falls back to waiting.
    | { is: 'asking'; turnId: string; pausedFor: string; isAnswered?: true }
    // The turn that took the person's answer with the step's own words: Claude's reply to it
    // ends the step, where a turn of anything else leaves it waiting.
    | { is: 'answering'; turnId: string; pausedFor: string }
    // No turn runs: the step waits for the person's answer to pausedFor, which the listing's
    // title and the step's toast print as it stands, the plugin's own "its turn ended without
    // an answer" included.
    | { is: 'waiting'; pausedFor: string }
    // As waiting, once a turn took an answer and Claude asked again or ended it with none: the
    // listing says "answered" in place of the question, and the toast asks for one again.
    | { is: 'answered'; pausedFor: string }
    // The turn a background task's notification brought, for work of this step: its end ends
    // the step unless more work is left.
    | { is: 'noticing'; turnId: string }
    // Work a turn of it left going in the background, with no turn of the step running. The
    // work may already be done and `background` empty: the step then waits for /aside continue,
    // which is why the list is data the step carries, not a state of its own.
    | { is: 'away' }
    // continue or stop ended the step and the turn that closes it has yet to start: the step is
    // done as it stands, and so it is if that prompt never goes out. pausedFor is kept for what
    // it had asked, which /aside stop in another session reads for "at step n" over "before".
    | { is: 'ending'; pausedFor?: string }
    // As ending, with that turn running: the step is done when it ends, whatever ends it, and
    // the wait tool is refused rather than asking again.
    | { is: 'closing'; turnId: string; pausedFor?: string }
  )

// What the step running carries in every state: which step of the plan it is, how its run goes
// on (isChain runs the next step not done when it ends, `then` the steps /aside run named
// instead), and the session that runs it, since the store is shared (2.6). ms and result keep
// how long its turns have run and what the last one said; startedAt when, by the clock, its
// first turn started (none before it, nor in earlier releases, where ms alone holds the time).
// background: the work in the background its turns started (a workflow, an agent, a command),
// by the call that started it and its task's id, until the notification of each says it ended.
// isPlanningAfter: /aside plan asked, while a turn of the step ran, for the queue to be
// organized once it ends, as Claude cannot be asked in the middle of one.
export type StepRun = {
  step: number
  isChain: boolean
  sessionId: string
  then?: number[]
  ms?: number
  result?: string
  startedAt?: number
  isPlanningAfter?: true
  background?: { callId?: string; taskId: string; what: string }[]
}

// The plan as the store holds it, which this release does not change: every session on the
// machine shares the key and keeps the module it loaded until a reload (2.6, 3.7, 3.17), so a
// session of an earlier release reads and writes the same record. loadPlan and savePlan in
// hooks/io/store.ts are the only code that sees this shape.
export type StoredPlan = Omit<Plan, 'active'> & { active?: StoredActive }

// The step running as every release up to 0.37.1 stores it: flags whose combination is the
// state StepState names. turnId names the turn of the step running; pausedFor what Claude asked
// with the wait tool; isAnswered that a turn took an answer since, in the turn answerTurnId;
// isEnding that continue or stop ended the step; isAway that a turn of it ended with work of
// its own still going. A flag left out is false (2.8), and a combination no release writes any
// more still reads as some state, since readActive is total (2.7).
export type StoredActive = StepRun & {
  turnId?: string
  pausedFor?: string
  isAnswered?: true
  answerTurnId?: string
  isEnding?: true
  isAway?: true
}

// named: the queues other than the global list that hold ideas, the one added to last first.
export type Band = {
  ideas: number
  comments: number
  tags: number
  steps: number
  done: number
  running?: number
  isBackground?: true
  waiting?: number
  paused?: number
  global?: number
  named?: { name: string; count: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'aside': { band: Band; files: string[] }
  }
}
