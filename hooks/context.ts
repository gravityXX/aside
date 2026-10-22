import type { Register, Timer } from 'claude-code'

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
  // What aside does by itself when Claude finishes answering: wait for /aside, or take the
  // queue at once, as /aside plan or /aside run all would.
  readonly afterAnswer: 'wait' | 'plan' | 'run all'
  readonly planModel: PlanModel
  // Whom a named queue made by its first idea ("+@name", /aside q NAME TEXT, add or import) is
  // for: every project, or this one alone.
  readonly newQueues: 'global' | 'local'
}

// Who asked for a hand-over: a command answers with the whole text, while the pane's button
// and the end of Claude's answer say one line in a toast.
export type Asker = 'command' | 'pane' | 'answer'

export type ToolOutput = { text: string; turnId: string | undefined; isError: boolean }

// A view of the list pane, by what it lists, so it is listed anew each time it is drawn.
export type PaneView = { kind: 'queue' } | { kind: 'named'; typed: string } | { kind: 'queues' } | { kind: 'find'; query: string } | { kind: 'log'; n?: number }

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
  // The last tool the main loop called, in the turn turnId names: what a step does now.
  lastTool?: { turnId: string | undefined; text: string }
  // The last message queued, until the box it went back into has been emptied.
  justQueued?: string
  // The person's message to a step that waits for them, until the turn it starts is bound to
  // the step: that turn took up their answer. isTold: it went with the step's own words, which
  // tell Claude its reply ends the step; one typed over a running turn goes without them, so
  // its turn leaves the step waiting for /aside continue. The two are one field, so a message
  // cannot be told about without being there to tell about.
  answer?: { text: string; isTold: boolean }
  // The notification of a step's work in the background, until the turn it starts is bound to
  // the step, which that turn's end then ends.
  notice?: string
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
  // The prompts of steps with a title an earlier release cut, sent to be named in this process.
  namedOld: Set<string>
  // The turns of the main loop this process saw start and has not yet seen end, and the work
  // in the background calls here started: what a step's turn or work can be known dead by.
  openTurns: Set<string>
  ownWork: Set<string>
  // What the list pane shows: the queue, as /aside and the band's list button open it, or what
  // /aside g, q, find or log asked for while Claude worked. None is the queue.
  paneView?: PaneView
  // What draws the list pane again while a step runs or waits, so its time there moves on.
  paneTick?: Timer
  clipboard: ClipboardState
}

export type Context = { settings: Settings; session: Session }

// Made each time the plugin loads; nothing in it has to outlast a reload.
export const createContext = (options: Parameters<Register>[1]): Context => ({
  settings: {
    order: options.order === 'newest' ? 'newest' : 'oldest',
    tidy: options.tidy !== 'off',
    afterAnswer: options.afterClaudeAnswers === 'plan' ? 'plan' : options.afterClaudeAnswers === 'run all' ? 'run all' : 'wait',
    planModel: PLAN_MODELS.find(model => model === options.planModel) ?? 'session',
    newQueues: options.newQueues === 'local' ? 'local' : 'global',
  },
  session: {
    planTool: 'mcp__aside__plan',
    waitTool: 'mcp__aside__wait',
    isOwnTurn: false,
    isRunning: false,
    openTurns: new Set(),
    ownWork: new Set(),
    tidies: new Set(),
    namedOld: new Set(),
    clipboard: {},
  },
})

// The task an entry queued now belongs to: none at an idle prompt.
export const currentTask = (ctx: Context) => (ctx.session.isRunning ? ctx.session.lastTask : undefined)

export const currentOutput = (ctx: Context) => {
  const { lastOutput, turnId } = ctx.session

  return lastOutput && lastOutput.turnId === turnId ? lastOutput.text : undefined
}
