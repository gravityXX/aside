import type { Register } from 'claude-code'

import type { Entry } from '../types'
import type { Order } from './core/entries'
import type { ClipboardState } from './io/host'

// What organizes the queue on /aside plan: Claude in this conversation, or one call to a
// model of its own outside it.
export type PlanModel = 'session' | 'sonnet' | 'haiku' | 'opus'

const PLAN_MODELS: readonly PlanModel[] = ['session', 'sonnet', 'haiku', 'opus']

export type Settings = {
  readonly order: Order
  // Whether a small model tidies each entry's own text once it is stored.
  readonly tidy: boolean
  // What aside does by itself when Claude finishes answering: wait for /aside, or hand the
  // queue over at once, as /aside plan or /aside run all would.
  readonly afterAnswer: 'wait' | 'plan' | 'send'
  readonly planModel: PlanModel
  // Whom a named queue made by its first idea ("+@name", /aside q NAME TEXT, add or import) is
  // for: every project, or this one alone.
  readonly newQueues: 'global' | 'local'
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
  // The person's message to a step that waits for them, until the turn it starts is bound to
  // the step: that turn took up their answer.
  answer?: string
  // What /aside plan handed over, until the turn that organizes it ends: the items as the
  // planning prompt numbered them, that turn once it starts, and whether Claude saved a plan.
  // A reload loses it, and the take then waits for /aside undo as it did before. isAdding: it
  // adds to the plan, which a second hand-over before its turn ends would save over.
  planning?: { items: Entry[]; turnId?: string; isSaved: boolean; isAdding: boolean }
  // The model organizing the queue outside the conversation right now: one at a time, so a
  // second plan never saves over the first one's.
  planner?: Exclude<PlanModel, 'session'>
  // The entries being tidied now: a planner waits for them, or it would plan an entry under
  // the text it had before.
  tidies: Set<Promise<void>>
  // Writes of typed entries, one after another, so two quick ones never overwrite each other.
  writes: Promise<unknown>
  // Changes to the plan, one after another for the same reason: a step that ends and a
  // planner adding steps meanwhile each read the plan and save it back.
  planWrites: Promise<unknown>
  clipboard: ClipboardState
}

export type Context = { settings: Settings; session: Session }

// Made each time the plugin loads; nothing in it has to outlast a reload.
export const createContext = (options: Parameters<Register>[1]): Context => ({
  settings: {
    order: options.order === 'newest' ? 'newest' : 'oldest',
    tidy: options.tidy !== 'off',
    afterAnswer: options.afterClaudeAnswers === 'plan' ? 'plan' : options.afterClaudeAnswers === 'run all' ? 'send' : 'wait',
    planModel: PLAN_MODELS.find(model => model === options.planModel) ?? 'session',
    newQueues: options.newQueues === 'local' ? 'local' : 'global',
  },
  session: {
    planTool: 'mcp__aside__plan',
    waitTool: 'mcp__aside__wait',
    isOwnTurn: false,
    isRunning: false,
    writes: Promise.resolve(),
    planWrites: Promise.resolve(),
    tidies: new Set(),
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
