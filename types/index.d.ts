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
  // What the step's answer said it did and left open (its "Result:" line), how long it ran
  // and when, by the clock, it was done, kept once it is done for the summary at the end of
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
  // The step running now: isChain runs the next one when it ends, turnId names its turn
  // once it started, sessionId the session that runs it (the store is shared by all), and
  // then the steps still to run after it when /aside run named them (in place of the chain).
  // pausedFor: what Claude asked for with the wait tool. The step then waits for the person:
  // every turn of that session but the plugin's own prompts is the step's, each with its turnId
  // while it runs, until /aside continue or /aside stop ends it, and ms and result keep the time
  // those turns took and what the last one said. isAnswered: a turn took the person's answer
  // since Claude last asked. isEnding: continue or stop ended the step, which is done once the
  // turn it has left ends, whatever ends it. isPlanningAfter: /aside plan asked, while a turn of
  // the step ran, for the queue to be organized once it ends, as Claude cannot be asked in the
  // middle of one.
  active?: {
    step: number
    isChain: boolean
    turnId?: string
    sessionId: string
    pausedFor?: string
    then?: number[]
    isPlanningAfter?: true
    ms?: number
    result?: string
    isAnswered?: true
    isEnding?: true
  }
  // A run that paused after a step, as /aside plan asked (or, in earlier releases, the wait
  // tool): the step it paused after, why, and how the run was to go on (as a chain, or with the
  // steps /aside run named), until it goes on or stops.
  paused?: { step: number; reason: string; isChain: boolean; then?: number[] }
  // A planning prompt that adds to the plan, sent by session sessionId: turnId names its turn
  // once it starts, and in that turn the plan tool saves its steps after the first `after`
  // steps, the plan's own, which it leaves as they are. Gone once that turn ends.
  adding?: { after: number; sessionId: string; turnId?: string }
}

// named: the queues other than the global list that hold ideas, the one added to last first.
export type Band = {
  ideas: number
  comments: number
  tags: number
  steps: number
  done: number
  running?: number
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
