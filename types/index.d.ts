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
  // What the step's answer said it did and left open (its "Result:" line), and how long it
  // ran, kept once it is done for the summary at the end of the run.
  result?: string
  ms?: number
}

export type Plan = {
  steps: Step[]
  // The step running now: isChain runs the next one when it ends, turnId names its turn
  // once it started, sessionId the session that runs it (the store is shared by all), and
  // pausedFor what Claude asked for when it paused the plan from this step, and then the
  // steps still to run after it when /aside run named them (in place of the chain).
  // isPlanningAfter: /aside plan asked, while it ran, for the queue to be organized here once
  // it ends, as Claude cannot be asked in the middle of a step.
  active?: { step: number; isChain: boolean; turnId?: string; sessionId: string; pausedFor?: string; then?: number[]; isPlanningAfter?: true }
  // A run that paused after a step, as the wait tool or /aside plan asked: the step it paused
  // after, why, and how the run was to go on (as a chain, or with the steps /aside run named),
  // until it goes on or stops.
  paused?: { step: number; reason: string; isChain: boolean; then?: number[] }
  // A planning prompt that adds to the plan, sent by session sessionId: turnId names its turn
  // once it starts, and in that turn the plan tool saves its steps after the first `after`
  // steps, the plan's own, which it leaves as they are. Gone once that turn ends.
  adding?: { after: number; sessionId: string; turnId?: string }
}

export type Band = { ideas: number; comments: number; tags: number; steps: number; done: number; running?: number; paused?: number; global?: number }

declare module 'claude-code' {
  interface PluginState {
    'aside': { band: Band; files: string[] }
  }
}
