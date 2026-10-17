// What a queued entry is: a plain idea, or a comment on something the agents wrote.
export type Kind = 'idea' | 'question' | 'change' | 'drop' | 'deeper'

export type Idea = {
  text: string
  // The line as typed, "+" included: what /queue pop puts back in the prompt box.
  raw?: string
  at: number
  kind: Kind
  file?: string
  line?: number
  heading?: string
  quote?: string
  // The copied text was kept, but no file holds it.
  isLoose?: true
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
    'idea-queue': { band: Band; files: string[] }
  }
}
