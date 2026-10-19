import type { Register } from 'claude-code'

import { createContext } from './context'
import { dropFailedEntry, emptyBoxAfterQueue, queueTyped, rememberMarkdownFile, rememberToolOutput } from './features/capture'
import { asideFailed, completeAside, runAside, startSession } from './features/commands'
import {
  noteStepAnswer,
  onTurnEnd,
  onTurnStart,
  pausePlanFromTool,
  planToolFailed,
  savePlanFromTool,
  stepAnswerFailed,
  turnEndFailed,
  turnStartFailed,
  waitToolFailed,
} from './features/plan'
import { drawBand } from './ui/band'
import { drawListingFrame, drawPlanTool, hidePlanToolResult } from './ui/output'
import { drawPane } from './ui/pane'

// Every hook the plugin has, each handing its event to the module that does the work.
export const register: Register = (on, options) => {
  const ctx = createContext(options)

  on('session.start', ($, e, next) => startSession(ctx, $, e, next))

  on('prompt.submit', ($, e, next) => queueTyped(ctx, $, e, next)).catch(dropFailedEntry)
  // Beneath the one above, which drops a queued entry before it comes here: what the person
  // typed, at this terminal or through Remote Control.
  on('prompt.submit', { origin: { kind: /^(composer|bridge)$/ } }, ($, e, next) => noteStepAnswer(ctx, $, e, next)).catch(stepAnswerFailed)
  on('prompt.change', ($, e, next) => emptyBoxAfterQueue(ctx, $, e, next))
  on('prompt.autocomplete', ($, e, next) => completeAside(ctx, $, e, next))

  on('tool.call', ($, e, next) => rememberToolOutput(ctx, e, next))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => rememberMarkdownFile($, e.file_path, await next(e)))
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => rememberMarkdownFile($, e.file_path, await next(e)))
  // A RegExp: the laid types know only the tools connected when they were written, and the
  // plan tools' full names are known only once they are registered.
  on('tool.call', { tool: /__plan$/ }, ($, e, next) => savePlanFromTool(ctx, $, e, next)).catch(planToolFailed)
  on('tool.call', { tool: /__wait$/ }, ($, e, next) => pausePlanFromTool(ctx, $, e, next)).catch(waitToolFailed)

  on('turn.start', ($, e, next) => onTurnStart(ctx, $, e, next)).catch(turnStartFailed)
  on('turn.complete', ($, e, next) => onTurnEnd(ctx, $, e, next)).catch(turnEndFailed)

  on('command.run', { command: 'aside' }, ($, e) => runAside(ctx, $, e)).catch(asideFailed)

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => drawBand(ctx, $, e, next))
  // LIST_PANE in ui/pane.tsx, written out so the engine's scan of this file reads it.
  on('ui.render', { component: 'Pane', requestId: 'aside' }, ($, e, next) => drawPane(ctx, $, e, next))
  on('ui.render', { component: 'CommandOutput' }, drawListingFrame)
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => drawPlanTool(ctx, $, e, next))
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => hidePlanToolResult(ctx, $, e, next))
}
