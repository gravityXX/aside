// Where a comment points, settled before anything is stored. The machine is handed in as
// closures (`Sources`), so these rules stay plain functions with no `$` of their own and can be
// held to a table (pin.test.ts, 6.3).

import type { Entry } from '../../types'
import type { TypedEntry } from './entries'
import { isExportText } from './listing'
import { findFragment, findHeading, fragmentWords, MIN_FRAGMENT_WORDS } from './markdown'
import { relativePath, shortenText } from './text'

// Where a comment points, and why it points nowhere when it does: `note` is said to the
// person at once, so a comment that missed its fragment never passes unnoticed.
export type Pin = Pick<Entry, 'file' | 'line' | 'heading' | 'quote' | 'isLoose' | 'from' | 'output'> & { note?: string }

// What was copied, and whether it changed since the last comment. `missing` says why nothing
// was read: no reader runs here, or the comment came from another device, whose clipboard this
// machine cannot see.
export type Copied = { text: string; isNew: boolean; missing?: string }

// Everything the rules below need from the machine, each a closure over `$` made where `$` is
// (3.3), so the rules themselves stay plain functions with no `$` of their own (2.2). The
// clipboard, the selection and the search are asked at most once per message, by the caller
// that builds this. `output` is the last tool output, which rides along when nothing else
// places the comment.
export type Sources = {
  clipboard: () => Promise<Copied>
  selection: () => Promise<string>
  read: (file: string) => Promise<string | undefined>
  search: (quote: string) => Promise<string[]>
  resolve: (file: string) => Promise<string | undefined>
  output?: string
}

const pinToHeading = async (heading: string, named: string | undefined, candidates: readonly string[], root: string, sources: Sources): Promise<Pin> => {
  for (const file of candidates) {
    const text = await sources.read(file)
    const found = text === undefined ? undefined : findHeading(text, heading)
    if (found) {
      return { file, line: found.line, heading: found.title }
    }
  }
  const scope = named ? relativePath(named, root) : `the ${candidates.length} files written this session`

  return { heading, ...(named ? { file: named } : {}), note: `no heading "${heading}" in ${scope}` }
}

// A fresh clipboard first; else the text selected in a transcript row (Claude's reply);
// else an older clipboard. Each is looked for in the session's files and the project's.
// Text no file holds is kept as a loose quote and said so, since the person sees it and can
// take the entry back with /aside pop. With nothing on the clipboard, or nothing found, the
// last tool output rides along.
async function pinToCopiedText(named: string | undefined, candidates: readonly string[], root: string, sources: Sources): Promise<Pin> {
  const find = async (quote: string) => {
    if (fragmentWords(quote).length < MIN_FRAGMENT_WORDS) return undefined
    const more = named ? [] : (await sources.search(quote)).filter(file => !candidates.includes(file))
    for (const file of [...candidates, ...more]) {
      const text = await sources.read(file)
      // An export quotes what it lists: the text was copied from somewhere else, unless the
      // comment names the export itself.
      const line = text === undefined || (file !== named && isExportText(text)) ? undefined : findFragment(quote, text)
      if (line !== undefined) return { file, line, quote: shortenText(quote, 300) }
    }

    return undefined
  }
  const base = named ? { file: named } : {}
  const output = sources.output ? { output: sources.output } : {}
  const withOutput = sources.output ? '; the last tool output is attached' : ''

  const { text: quote, isNew, missing } = await sources.clipboard()
  const count = fragmentWords(quote).length
  const selected = await sources.selection()
  if (count > 0 && (isNew || fragmentWords(selected).length === 0)) {
    const found = await find(quote)
    if (found) return found
  }
  if (fragmentWords(selected).length > 0) {
    return (await find(selected)) ?? { ...base, quote: shortenText(selected, 300), isLoose: true, from: 'terminal' }
  }

  if (count === 0) {
    return sources.output ? { ...base, ...output, note: 'with the last tool output' } : { ...base, note: missing ?? 'no text on the clipboard' }
  }
  const scope = named ? relativePath(named, root) : `any .md file under ${root}`
  const why = count < MIN_FRAGMENT_WORDS ? `copied text too short to find (${count} words)` : `copied text not found in ${scope}`

  return { ...base, quote: shortenText(quote, 300), isLoose: true, from: 'clipboard', ...output, note: `${why}${withOutput}` }
}

// Where a comment points: the line or heading it names, else the text it was copied from.
export async function pinComment(entry: TypedEntry, root: string, seen: readonly string[], sources: Sources): Promise<Pin> {
  const { anchor } = entry
  const named = anchor.file ? await sources.resolve(anchor.file) : undefined
  if (named && anchor.line) {
    return { file: named, line: anchor.line }
  }
  const candidates = named ? [named] : [...seen].reverse()
  if (anchor.heading) {
    return pinToHeading(anchor.heading, named, candidates, root, sources)
  }

  return pinToCopiedText(named, candidates, root, sources)
}
