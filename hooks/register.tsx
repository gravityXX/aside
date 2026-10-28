// One line per hook, each handing its event straight on. Nothing is decided here: a hook that
// needs a condition puts it in the function it calls, so this file stays the list of what the
// plugin listens to. Its matchers are literals, since the engine reads this file as written (3.5).
//
// `$` is spelled out here and nowhere else. kitOf binds every call the plugin makes, and what it
// returns is what every other file is handed, so the engine's own object never leaves this file:
// the engine and the plugin directory both read this file as it stands and follow no import, so
// a `$` handed to an imported function is a `$` neither of them can account for (3.1).

import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Band } from '../types'
import { createContext } from './context'
import { noteBackgroundEnd, noteBackgroundWork } from './features/background'
import { dropFailedEntry, emptyBoxAfterQueue, queueTyped, rememberMarkdownFile, rememberToolOutput } from './features/capture'
import { asideFailed, completeAside, runAside, startSession } from './features/commands'
import { onTurnEnd, onTurnStart, turnEndFailed, turnStartFailed } from './features/plan'
import { pausePlanFromTool, planToolFailed, savePlanFromTool, waitToolFailed } from './features/plantool'
import { endSessionSteps, noteStepAnswer, stepAnswerFailed } from './features/steps'
import type { Kit } from './kit'
import { drawBand } from './ui/band'
import { drawListingFrame, drawPlanTool, hidePlanToolResult } from './ui/output'
import { drawPane } from './ui/pane'

const EMPTY_BAND: Band = { ideas: 0, comments: 0, tags: 0, steps: 0, done: 0 }

// What the line above the prompt shows, kept up to date by refreshBand in io/store.ts.
const band = atom({ plugin: 'aside', key: 'band' } as const, EMPTY_BAND)

// The markdown files /aside reads tags from, newest last: those written or edited in this
// session, agents' included, and those /aside scan added.
const trackedFiles = atom({ plugin: 'aside', key: 'files' } as const, [])

// Every call the plugin makes, each written plainly as `$.noun.method(...)`, so both readers of
// this file list what the plugin does from the source itself.
function kitOf($: Engine): Kit {
  return {
    clock: { now: () => $.clock.now(), after: (ms, fn) => $.clock.after(ms, fn) },
    command: { register: command => $.command.register(command) },
    fs: {
      exists: path => $.fs.exists(path),
      list: path => $.fs.list(path),
      read: path => $.fs.read(path),
      write: (path, text) => $.fs.write(path, text),
    },
    model: { complete: (request, options) => $.model.complete(request, options) },
    process: { run: (argv, init) => $.process.run(argv, init) },
    prompt: { fill: input => $.prompt.fill(input), read: () => $.prompt.read(), submit: input => $.prompt.submit(input) },
    session: { id: () => $.session.id(), root: () => $.session.root() },
    atoms: {
      band: () => read($, band),
      setBand: next => update($, band, () => next),
      files: () => read($, trackedFiles),
      setFiles: change => update($, trackedFiles, change),
    },
    store: {
      get: key => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      delete: key => $.store.delete(key),
      keys: () => $.store.keys(),
    },
    tool: { register: tool => $.tool.register(tool) },
    ui: {
      close: pane => $.ui.close(pane),
      invalidate: event => $.ui.invalidate(event),
      log: (text, options) => $.ui.log(text, options),
      open: pane => $.ui.open(pane),
      panes: () => $.ui.panes(),
      resolve: e => $.ui.resolve(e),
      selection: () => $.ui.selection(),
      toast: (text, options) => $.ui.toast(text, options),
    },
  }
}

// Every hook the plugin has, each handing its event to the module that does the work.
export const register: Register = (on, options) => {
  const ctx = createContext(options)

  on('session.start', ($, e, next) => startSession(ctx, kitOf($), e, next))

  on('prompt.submit', ($, e, next) => queueTyped(ctx, kitOf($), e, next)).catch(($, e, next) => dropFailedEntry(kitOf($), e, next))
  // Beneath the one above, which drops a queued entry before it comes here: what the person
  // typed, at this terminal or through Remote Control.
  on('prompt.submit', { origin: { kind: /^(composer|bridge)$/ } }, ($, e, next) => noteStepAnswer(ctx, kitOf($), e, next)).catch(($, e, next) => stepAnswerFailed(kitOf($), e, next))
  // A background task's notification: the step that started the work it names goes on.
  on('prompt.submit', { origin: { kind: 'task-notification' } }, ($, e, next) => noteBackgroundEnd(ctx, kitOf($), e, next)).catch(($, e, next) => stepAnswerFailed(kitOf($), e, next))
  on('prompt.change', ($, e, next) => emptyBoxAfterQueue(ctx, kitOf($), e, next))
  on('prompt.autocomplete', ($, e, next) => completeAside(ctx, kitOf($), e, next))

  on('tool.call', ($, e, next) => rememberToolOutput(ctx, e, next))
  on('tool.call', { tool: /^(Workflow|Agent|Bash|TaskStop)$/ }, ($, e, next) => noteBackgroundWork(ctx, kitOf($), e, next))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => rememberMarkdownFile(kitOf($), e.file_path, await next(e)))
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => rememberMarkdownFile(kitOf($), e.file_path, await next(e)))
  // A RegExp: the laid types know only the tools connected when they were written, and the
  // plan tools' full names are known only once they are registered.
  on('tool.call', { tool: /__plan$/ }, ($, e, next) => savePlanFromTool(ctx, kitOf($), e, next)).catch(($, e, next) => planToolFailed(kitOf($), e, next))
  on('tool.call', { tool: /__wait$/ }, ($, e, next) => pausePlanFromTool(ctx, kitOf($), e, next)).catch(($, e, next) => waitToolFailed(kitOf($), e, next))

  on('turn.start', ($, e, next) => onTurnStart(ctx, kitOf($), e, next)).catch(($, e, next) => turnStartFailed(kitOf($), e, next))
  on('turn.complete', ($, e, next) => onTurnEnd(ctx, kitOf($), e, next)).catch(($, e, next) => turnEndFailed(kitOf($), e, next))
  on('session.end', ($, e, next) => endSessionSteps(ctx, kitOf($), e, next))

  on('command.run', { command: 'aside' }, ($, e) => runAside(ctx, kitOf($), e)).catch(($, e, next) => asideFailed(kitOf($), e, next))

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => drawBand(ctx, kitOf($), e, next))
  // LIST_PANE in ui/pane.tsx, written out so the engine's scan of this file reads it.
  on('ui.render', { component: 'Pane', requestId: 'aside' }, ($, e, next) => drawPane(ctx, kitOf($), e, next))
  on('ui.render', { component: 'CommandOutput' }, ($, e, next) => drawListingFrame(kitOf($), e, next))
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => drawPlanTool(ctx, kitOf($), e, next))
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => hidePlanToolResult(ctx, kitOf($), e, next))
}
