import type { Register } from 'claude-code'

import type { Entry } from '../types'
import type { Order } from './core/entries'
import type { ClipboardState } from './io/host'

export type Settings = {
  readonly order: Order
  // Whether a small model tidies each entry's own text once it is stored.
  readonly tidy: boolean
  // What aside does by itself when Claude finishes answering: wait for /aside, or hand the
  // queue over at once, as /aside plan or /aside run all would.
  readonly afterAnswer: 'wait' | 'plan' | 'send'
}

export type ToolOutput = { text: string; turnId: string | undefined; isError: boolean }

export type Session = {
  // The plan tool's full name as the engine registered it: its prefix comes from where the
  // plugin was loaded from (a marketplace install, a --plugin-dir folder), so it is never assumed.
  planTool: string
  // The same for the tool a step pauses the plan with.
  waitTool: string
  // The main loop's current (or last) turn, and whether it was the plugin's own.
  turnId?: string
  isOwnTurn: boolean
  // Whether a main-loop turn is in flight: only an entry queued then was made "while Claude
  // worked on" the last prompt.
  isRunning: boolean
  lastTask?: string
  // The last tool output of the turn: an error stays over a later success.
  lastOutput?: ToolOutput
  // The last message queued, until the box it went back into has been emptied.
  justQueued?: string
  // What /aside plan handed over, until the turn that organizes it ends: the items as the
  // planning prompt numbered them, that turn once it starts, and whether Claude saved a plan.
  // A reload loses it, and the take then waits for /aside undo as it did before.
  planning?: { items: Entry[]; turnId?: string; isSaved: boolean }
  // Writes of typed entries, one after another, so two quick ones never overwrite each other.
  writes: Promise<unknown>
  clipboard: ClipboardState
}

export type Context = { settings: Settings; session: Session }

// Made each time the plugin loads; nothing in it has to outlast a reload.
export const createContext = (options: Parameters<Register>[1]): Context => ({
  settings: {
    order: options.order === 'newest' ? 'newest' : 'oldest',
    tidy: options.tidy !== 'off',
    afterAnswer: options.afterClaudeAnswers === 'plan' ? 'plan' : options.afterClaudeAnswers === 'run all' ? 'send' : 'wait',
  },
  session: {
    planTool: 'mcp__aside__plan',
    waitTool: 'mcp__aside__wait',
    isOwnTurn: false,
    isRunning: false,
    writes: Promise.resolve(),
    clipboard: {},
  },
})

// The task an entry queued now belongs to: none at an idle prompt.
export const currentTask = (ctx: Context) => (ctx.session.isRunning ? ctx.session.lastTask : undefined)

export const currentOutput = (ctx: Context) => {
  const { lastOutput, turnId } = ctx.session

  return lastOutput && lastOutput.turnId === turnId ? lastOutput.text : undefined
}

// Runs `write` once every write chained before it is done.
export const chainWrite = (ctx: Context, write: () => Promise<unknown>, onError: (error: unknown) => unknown) => {
  ctx.session.writes = ctx.session.writes.then(write).catch(onError)
}
