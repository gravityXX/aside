// Everything whose life is one load of the plugin, and nothing whose life is longer: a reload
// starts this over (3.7), so what must outlast one belongs in `$.store` or an atom. The settings
// are read once here and never checked again further in (4.8).

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
  // How long a step may go on in the background before the plugin ends it and the run goes on,
  // in milliseconds; undefined with the setting at never, which leaves it to /aside continue.
  readonly backgroundWait: number | undefined
}

// How long each word of the setting stands for, never being none of them.
const BACKGROUND_WAITS: Record<string, number | undefined> = { '5 min': 5 * 60_000, '15 min': 15 * 60_000, '30 min': 30 * 60_000, never: undefined }

const backgroundWaitOf = (given: unknown): number | undefined =>
  typeof given === 'string' && given in BACKGROUND_WAITS ? BACKGROUND_WAITS[given] : BACKGROUND_WAITS['15 min']

// Who asked for a hand-over: a command answers with the whole text, while the pane's button
// and the end of Claude's answer say one line in a toast.
export type Asker = 'command' | 'pane' | 'answer'

export type ToolOutput = { text: string; turnId: string | undefined; isError: boolean }

// A view of the list pane, by what it lists, so it is listed anew each time it is drawn. The
// help is the one view that carries its own text instead: it is the same text at every draw,
// and carrying it keeps the pane from reaching into the commands it is built from (2.1).
export type PaneView =
  | { kind: 'queue' }
  | { kind: 'named'; typed: string }
  | { kind: 'queues' }
  | { kind: 'find'; query: string }
  | { kind: 'log'; n?: number }
  | { kind: 'help'; text: string }

export type Session = {
  // Full names as the engine registered them: the prefix comes from where the plugin was
  // loaded from, a marketplace install or a --plugin-dir folder, so it is never assumed (3.10).
  planTool: string
  waitTool: string
  // The current turn, or the last one: it is not cleared when a turn ends.
  turnId?: string
  isOwnTurn: boolean
  // Only an entry queued while a turn is in flight was made "while Claude worked on" it.
  isRunning: boolean
  lastTask?: string
  // The last tool output of the turn: an error stays over a later success.
  lastOutput?: ToolOutput
  // In the turn turnId names: what the listing shows a running step as doing now.
  lastTool?: { turnId: string | undefined; text: string }
  // The last message queued, until the box it went back into has been emptied.
  justQueued?: string
  // Held until the turn it starts is bound to the step, which is what takes the answer up.
  // isTold: it went with the step's own words, which tell Claude its reply ends the step; one
  // typed over a running turn goes without them, so its turn leaves the step waiting.
  answer?: { text: string; isTold: boolean }
  // Held the same way; the turn it starts is the step's, and that turn's end ends the step.
  notice?: string
  // What /aside plan handed over, the items numbered as the planning prompt numbered them. A
  // reload loses it, and the take then waits for /aside undo. isAdding: a second hand-over
  // before this turn ends would save over the steps this one adds.
  planning?: { items: Entry[]; turnId?: string; isSaved: boolean; isAdding: boolean }
  // One planner at a time, so a second plan never saves over the first one's.
  planner?: Exclude<PlanModel, 'session'>
  // The entries being tidied now: a planner waits for them, or it would plan an entry under
  // the text it had before.
  tidies: Set<Promise<void>>
  // The prompts of steps with a title an earlier release cut, sent to be named in this process.
  namedOld: Set<string>
  // What this process saw start and not end: how a step's turn, or its work, is known dead.
  openTurns: Set<string>
  ownWork: Set<string>
  // What /aside g, q, find or log asked for while Claude worked. None of them means the queue.
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
    backgroundWait: backgroundWaitOf(options.backgroundWait),
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
