import type { Register } from 'claude-code'

import { createContext } from './context'
import { dropFailedEntry, emptyBoxAfterQueue, queueTyped, rememberMarkdownFile, rememberToolOutput } from './features/capture'
import { completeAside, runAside, startSession } from './features/commands'
import { onTurnEnd, onTurnStart, savePlanFromTool } from './features/plan'
import { drawBand } from './ui/band'
import { drawListingFrame } from './ui/output'
import { drawPane } from './ui/pane'

// Every hook the plugin has, each handing its event to the module that does the work.
export const register: Register = (on, options) => {
  const ctx = createContext(options)

  on('session.start', ($, e, next) => startSession(ctx, $, e, next))

  on('prompt.submit', ($, e, next) => queueTyped(ctx, $, e, next)).catch(dropFailedEntry)
  on('prompt.change', ($, e, next) => emptyBoxAfterQueue(ctx, $, e, next))
  on('prompt.autocomplete', ($, e, next) => completeAside(ctx, $, e, next))

  on('tool.call', ($, e, next) => rememberToolOutput(ctx, e, next))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => rememberMarkdownFile($, e.file_path, await next(e)))
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => rememberMarkdownFile($, e.file_path, await next(e)))
  // A RegExp: the laid types know only the tools connected when they were written, and the
  // plan tool's full name is known only once it is registered.
  on('tool.call', { tool: /__plan$/ }, ($, e, next) => savePlanFromTool(ctx, $, e, next))

  on('turn.start', ($, e, next) => onTurnStart(ctx, $, e, next))
  on('turn.complete', ($, e, next) => onTurnEnd(ctx, $, e, next))

  on('command.run', { command: 'aside' }, ($, e) => runAside(ctx, $, e))

  on('ui.render', { component: 'AbovePrompt' }, drawBand)
  // LIST_PANE in ui/pane.tsx, written out so the engine's scan of this file reads it.
  on('ui.render', { component: 'Pane', requestId: 'aside' }, ($, e, next) => drawPane(ctx, $, e, next))
  on('ui.render', { component: 'CommandOutput' }, drawListingFrame)
}
