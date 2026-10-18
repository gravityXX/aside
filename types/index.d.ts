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
  active?: { step: number; isChain: boolean; turnId?: string; sessionId: string; pausedFor?: string; then?: number[] }
}

export type Band = { ideas: number; comments: number; tags: number; steps: number; done: number; running?: number }

declare module 'claude-code' {
  interface PluginState {
    'aside': { band: Band; files: string[] }
  }
}
