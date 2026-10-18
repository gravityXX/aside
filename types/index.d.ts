// What a queued entry is: a plain idea, or a comment on something the agents wrote.
export type Kind = 'idea' | 'question' | 'change' | 'drop' | 'deeper'

export type Idea = {
  text: string
  // The line as typed, "+" included: what /aside pop puts back in the prompt box.
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
  // The task that was running, and the branch, when the idea came.
  task?: string
  branch?: string
  // Read from a <!-- ? --> tag in a file, not typed at the prompt.
  isTag?: true
}

export type Step = { title: string; prompt: string; isDone?: true }

export type Plan = {
  steps: Step[]
  // The step running now: isChain runs the next one when it ends, turnId names its turn
  // once it started, sessionId the session that runs it (the store is shared by all).
  active?: { step: number; isChain: boolean; turnId?: string; sessionId: string }
}

export type Band = { ideas: number; comments: number; tags: number; steps: number; done: number; running?: number }

declare module 'claude-code' {
  interface PluginState {
    'aside': { band: Band; files: string[] }
  }
}
