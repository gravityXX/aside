// The slice of the engine the plugin uses, as register.tsx hands it on. A file of its own
// because the types contract in types/index.d.ts must stand without an import.

import type { EngineInterface } from 'claude-code'

import type { Band } from '../types'

// What the plugin uses of the engine, bound once in register.tsx by the only function allowed
// to spell `$` there. Every file below takes this instead, so the engine's own object never
// leaves that one file: the plugin directory reads a mod's calls off the source as written and
// follows no import, so a `$` handed to an imported function is a `$` it cannot account for.
// The members keep the engine's own names and signatures, so a call reads the same here as it
// does in Claude Code's own types.
export type Kit = {
  // The two atoms a drawing reads, made and reached in register.tsx because the engine ties an
  // atom to the file that makes it (3.6).
  atoms: {
    band: () => Promise<Band>
    setBand: (next: Band) => Promise<Band>
    files: () => Promise<string[]>
    setFiles: (change: (list: string[]) => string[]) => Promise<string[]>
  }
  clock: Pick<EngineInterface['clock'], 'now' | 'after'>
  command: Pick<EngineInterface['command'], 'register'>
  // `read` is one signature of the engine's three: the plugin reads text and never bytes.
  fs: Pick<EngineInterface['fs'], 'exists' | 'list' | 'write'> & { read: (path: string) => Promise<string> }
  model: Pick<EngineInterface['model'], 'complete'>
  process: Pick<EngineInterface['process'], 'run'>
  prompt: Pick<EngineInterface['prompt'], 'fill' | 'read' | 'submit'>
  session: Pick<EngineInterface['session'], 'id' | 'root'>
  store: Pick<EngineInterface['store'], 'get' | 'set' | 'delete' | 'keys'>
  tool: Pick<EngineInterface['tool'], 'register'>
  ui: Pick<EngineInterface['ui'], 'close' | 'invalidate' | 'log' | 'open' | 'panes' | 'resolve' | 'selection' | 'toast'>
}

