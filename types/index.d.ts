// The shapes the store holds, which every release must still be able to read (2.7), and the
// PluginState contract. No behaviour here.

// An idea, or one of the four marks that comment on what the agents wrote.
export type Kind = 'idea' | 'question' | 'change' | 'drop' | 'deeper'

export type Entry = {
  text: string
  // The line as typed, the mark included: what /aside edit puts back in the prompt box.
  raw?: string
  at: number
  kind: Kind
  file?: string
  line?: number
  heading?: string
  quote?: string
  // The quote was kept, but no file holds it; `from` says where it was copied from.
  isLoose?: true
  from?: 'terminal' | 'clipboard'
  // What the last tool printed when the comment came, an error before a success.
  output?: string
  // What was running, and on what branch, when the entry was queued, not since.
  task?: string
  branch?: string
  // Read from a <!-- ? --> tag in a file, not typed at the prompt.
  isTag?: true
}

export type Step = {
  title: string
  prompt: string
  isDone?: true
  // The step's "Result:" line, and how long it took by the clock from its start to its end (in
  // earlier releases, how long its turns ran). Both are kept for the run's summary and the log.
  result?: string
  ms?: number
  doneAt?: number
}

// A plan run to its end, kept in the log once another took its place.
export type PastRun = { at: number; steps: { title: string; ms?: number; result?: string }[] }

export type Plan = {
  steps: Step[]
  // Read from the flags the store holds and written back as those flags, in hooks/core/step.ts
  // (4.8). The record itself does not change: StoredActive below is what every release up to
  // 0.37.1 holds.
  active?: StepState
  // A run that paused after a step, as /aside plan asked, or as the wait tool did in earlier
  // releases, until it goes on or stops.
  paused?: { step: number; reason: string; isChain: boolean; then?: number[] }
  // A planning prompt that adds to the plan: in the turn turnId names, the plan tool saves its
  // steps after the first `after`, the plan's own, which it leaves as they are. Gone with that
  // turn.
  adding?: { after: number; sessionId: string; turnId?: string }
}

// One closed set, so a switch over `is` covers every state and TypeScript flags a new one
// nobody handled (4.5, 4.6). A state with a turnId has a turn of the step running, and only
// that turn's end moves the step on; one without is open, and the person's answer, /aside
// continue or /aside stop ends it from any session. The one reading this cannot answer is
// isLeftHere in hooks/features/steps.ts: whether a turn is still alive is this process's own
// state, not the plan's.
export type StepState = StepRun &
  (
    // Only here is the prompt still to go out, so a stop that lands first keeps it from going
    // out at all.
    | { is: 'due' }
    | { is: 'running'; turnId: string }
    // The turn it asked in, or a later one of this session that is not the answer the step was
    // told about. isAnswered: an answer came since Claude last asked, so the step says "answer
    // again" once it falls back to waiting.
    | { is: 'asking'; turnId: string; pausedFor: string; isAnswered?: true }
    // The answer came with the step's own words, so Claude's reply to it ends the step, where a
    // turn of anything else would leave it waiting.
    | { is: 'answering'; turnId: string; pausedFor: string }
    // pausedFor is printed as it stands, the plugin's own "its turn ended without an answer"
    // included.
    | { is: 'waiting'; pausedFor: string }
    // The listing says "answered" in place of the question, and the toast asks for one again.
    | { is: 'answered'; pausedFor: string }
    // The turn a background task's notification brought: its end ends the step unless more work
    // is left.
    | { is: 'noticing'; turnId: string }
    // The work may be done already and `background` empty, the step waiting for /aside continue,
    // which is why that list is data the step carries and not a state of its own.
    | { is: 'away' }
    // Done as it stands, and so it is if the prompt that closes it never goes out. pausedFor is
    // kept for what it had asked, which /aside stop elsewhere reads for "at step n" over
    // "before".
    | { is: 'ending'; pausedFor?: string }
    // As ending, with that turn running: the wait tool is refused rather than asking again.
    | { is: 'closing'; turnId: string; pausedFor?: string }
  )

// What every state carries. isChain runs the next step not done when this one ends, and `then`
// the steps /aside run named instead. sessionId, since the store is shared (2.6). startedAt is
// absent before the step's first turn and in earlier releases, where ms alone holds the time.
// background: the work a turn of it started, by the call and the task, until each one's
// notification says it ended. isPlanningAfter: /aside plan asked, mid-turn, for the queue to be
// organized once the step ends, as Claude cannot be asked in the middle of one.
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

// The plan as the store holds it. Every session on the machine shares the key and keeps the
// module it loaded until a reload (2.6, 3.7, 3.17), so a session of an earlier release reads
// and writes the same record. Only loadPlan and savePlan see this shape.
export type StoredPlan = Omit<Plan, 'active'> & { active?: StoredActive }

// The flags whose combination is the state StepState names; readActive in hooks/core/step.ts
// holds the reading. A flag left out is false (2.8), and a combination no release writes any
// more still reads as some state, since readActive is total (2.7).
export type StoredActive = StepRun & {
  turnId?: string
  pausedFor?: string
  isAnswered?: true
  answerTurnId?: string
  isEnding?: true
  isAway?: true
}

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
  // The queues other than the global list that hold an idea, the one added to last first.
  named?: { name: string; count: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'aside': { band: Band; files: string[] }
  }
}
