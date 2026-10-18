import type { CatchHandler, EngineInterface as Engine, Hook } from 'claude-code'

import type { Entry } from '../../types'
import { currentOutput, chainWrite } from '../context'
import type { Context } from '../context'
import { inOrder, KINDS, parseEntries } from '../core/entries'
import type { Order, TypedEntry } from '../core/entries'
import { formatPlace } from '../core/listing'
import { findFragment, findHeading, fragmentWords, MARKDOWN_PATH, MIN_FRAGMENT_WORDS } from '../core/markdown'
import { readTidyReply, TIDY_SYSTEM, tidyPrompt } from '../core/prompts'
import { relativePath, shortenText } from '../core/text'
import { readClipboard, readGitBranch, resolveFile, searchMarkdown, tryReadFile } from '../io/host'
import { loadEntries, projectKeys, refreshBand, readTrackedFiles, trackFile, saveEntries, takeEditing } from '../io/store'

// The tools whose output a comment may be about when nothing else says so; any error counts.
const OUTPUT_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit'])

// Where a comment points, and why it points nowhere when it does: `note` is said to the
// person at once, so a comment that missed its fragment never passes unnoticed.
type Pin = Pick<Entry, 'file' | 'line' | 'heading' | 'quote' | 'isLoose' | 'from' | 'output'> & { note?: string }

// What a comment can be about when it names no place: the clipboard (and whether it changed
// since the last comment), the text selected in a transcript row, the last tool output.
// Each is asked at most once per message.
type CommentSources = { selection: () => Promise<string>; clipboard: () => Promise<{ text: string; isNew: boolean }>; output?: string }

type ReadSource = (file: string) => Promise<string | undefined>

// The text selected in one transcript row: one in the prompt box or a pane is not about
// Claude's output.
function readReplySelection($: Engine): Promise<string> {
  return $.ui.selection().then(one => (one?.requestId ? one.text.trim() : ''), () => '')
}

function commentSources($: Engine, ctx: Context, output: string | undefined, selection: string | undefined): CommentSources {
  let clipboard: Promise<{ text: string; isNew: boolean }> | undefined
  let selected: Promise<string> | undefined

  return {
    clipboard: () => (clipboard ??= readClipboard($, ctx.session.clipboard)),
    selection: () => (selected ??= selection !== undefined ? Promise.resolve(selection) : readReplySelection($)),
    ...(output ? { output } : {}),
  }
}

const pinToHeading = async (heading: string, named: string | undefined, candidates: readonly string[], root: string, readSource: ReadSource): Promise<Pin> => {
  for (const file of candidates) {
    const text = await readSource(file)
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
async function pinToCopiedText(
  $: Engine,
  named: string | undefined,
  candidates: readonly string[],
  root: string,
  sources: CommentSources,
  readSource: ReadSource,
): Promise<Pin> {
  const find = async (quote: string) => {
    if (fragmentWords(quote).length < MIN_FRAGMENT_WORDS) return undefined
    const more = named ? [] : (await searchMarkdown($, quote, root)).filter(file => !candidates.includes(file))
    for (const file of [...candidates, ...more]) {
      const text = await readSource(file)
      const line = text === undefined ? undefined : findFragment(quote, text)
      if (line !== undefined) return { file, line, quote: shortenText(quote, 300) }
    }

    return undefined
  }
  const base = named ? { file: named } : {}
  const output = sources.output ? { output: sources.output } : {}
  const withOutput = sources.output ? '; the last tool output is attached' : ''

  const { text: quote, isNew } = await sources.clipboard()
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
    return sources.output ? { ...base, ...output, note: 'with the last tool output' } : { ...base, note: 'no text on the clipboard' }
  }
  const scope = named ? relativePath(named, root) : `any .md file under ${root}`
  const why = count < MIN_FRAGMENT_WORDS ? `copied text too short to find (${count} words)` : `copied text not found in ${scope}`

  return { ...base, quote: shortenText(quote, 300), isLoose: true, from: 'clipboard', ...output, note: `${why}${withOutput}` }
}

// Where a comment points: the line or heading it names, else the text it was copied from.
async function pinComment($: Engine, entry: TypedEntry, root: string, seen: readonly string[], sources: CommentSources, readSource: ReadSource): Promise<Pin> {
  const { anchor } = entry
  const named = anchor.file ? await resolveFile($, anchor.file, root, seen) : undefined
  if (named && anchor.line) {
    return { file: named, line: anchor.line }
  }
  const candidates = named ? [named] : [...seen].reverse()
  if (anchor.heading) {
    return pinToHeading(anchor.heading, named, candidates, root, readSource)
  }

  return pinToCopiedText($, named, candidates, root, sources, readSource)
}

// What was queued and where it points, as the line the dropped prompt leaves in the transcript.
const reportQueued = (entries: readonly Entry[], notes: readonly string[], root: string, waiting: number) => {
  const why = notes.length > 0 ? ` - ${[...new Set(notes)].join('; ')}` : ''
  if (entries.length > 1) {
    return `queued ${entries.length} entries${why} (${waiting} waiting)`
  }
  const entry = entries[0]!
  if (entry.kind === 'idea') {
    return `queued "${shortenText(entry.text)}" (${waiting} waiting)`
  }
  const at = formatPlace(entry, root)
  const quote = entry.quote ? ` "${shortenText(entry.quote, 30)}"` : ''
  const spot = at || quote ? `${at}${quote}`.trimStart() : `"${shortenText(entry.text, 30)}"`

  return `queued ${KINDS[entry.kind].mark} ${spot}${why} (${waiting} waiting)`
}

// An edited entry back at its place as /aside showed it.
const putBack = (stored: readonly Entry[], added: readonly Entry[], index: number, order: Order): Entry[] => {
  const shown = inOrder(stored, order)
  shown.splice(Math.min(index, shown.length), 0, ...added)

  return inOrder(shown, order)
}

// An entry's own text, tidied by a small model once it is stored. It waits as typed until
// the reply comes, and keeps that text when none comes in time or the entry has left the
// queue by then. The edit box gets the tidied text too, with its mark and place as typed.
async function tidyEntry($: Engine, ctx: Context, entry: Entry): Promise<void> {
  if (entry.text.trim() === '') {
    return
  }
  const ask = { model: 'haiku', system: TIDY_SYSTEM, prompt: tidyPrompt(entry.text), maxTokens: 1024, timeoutMs: 10_000 }
  const reply = await $.model.complete(ask).catch(() => undefined)
  const fixed = reply?.isAnswered ? readTidyReply(reply.text, entry.text) : undefined
  if (fixed === undefined) {
    return
  }
  chainWrite(
    ctx,
    async () => {
      const { queue } = await projectKeys($)
      const list = await loadEntries($, queue)
      const i = list.findIndex(one => one.at === entry.at && one.kind === entry.kind && one.text === entry.text)
      const one = list[i]
      if (one === undefined) return
      const raw = one.raw?.endsWith(one.text) ? `${one.raw.slice(0, one.raw.length - one.text.length)}${fixed}` : one.raw
      list[i] = { ...one, text: fixed, ...(raw === undefined ? {} : { raw }) }
      await saveEntries($, queue, list)
      await refreshBand($)
    },
    () => undefined,
  )
}

// How addEntries reports what it queued: a line in the transcript (a typed "+", whose prompt
// has long been answered by then), or nothing (a command, which answers with the text itself).
type Report = 'log' | 'none'

// Stores what a message (or /aside TEXT) holds and says what was queued and where it
// points, or returns null when the text is no entry at all.
export async function addEntries(
  $: Engine,
  ctx: Context,
  text: string,
  task: string | undefined,
  output: string | undefined,
  options: { images?: number; selection?: string; report?: Report } = {},
): Promise<string | null> {
  const { images = 0, report = 'none' } = options
  const typed = parseEntries(text)
  if (typed === null) {
    return null
  }
  const keys = await projectKeys($)
  const seen = await readTrackedFiles($)
  const now = await $.clock.now()
  const branch = await readGitBranch($, keys.root)
  const sources = commentSources($, ctx, output, options.selection)
  // An entry taken out with /aside edit comes back where it was, keeping what it pointed at,
  // unless the reworked text names a place of its own.
  const editing = await takeEditing($, keys.editing)
  const isRework = editing !== undefined && typed.length === 1 && typed[0]!.kind === editing.idea.kind && Object.keys(typed[0]!.anchor).length === 0
  const sourceCache = new Map<string, Promise<string | undefined>>()
  const readSource: ReadSource = file => {
    if (!sourceCache.has(file)) sourceCache.set(file, tryReadFile($, file))

    return sourceCache.get(file)!
  }

  const added: Entry[] = []
  const notes: string[] = []
  for (const one of typed) {
    if (isRework) {
      const { text: _text, raw: _raw, ...kept } = editing!.idea
      added.push({ ...kept, text: one.text, raw: one.raw })
      continue
    }
    const { note, ...spot } = one.kind === 'idea' ? ({} as Pin) : await pinComment($, one, keys.root, seen, sources, readSource)
    if (note) notes.push(note)
    added.push({ text: one.text, raw: one.raw, at: now, kind: one.kind, ...spot, ...(task ? { task } : {}), ...(branch ? { branch } : {}) })
  }

  const stored = await loadEntries($, keys.queue)
  const all = isRework ? putBack(stored, added, editing!.index, ctx.settings.order) : [...stored, ...added]
  await saveEntries($, keys.queue, all)
  await refreshBand($)
  if (ctx.settings.tidy) for (const entry of added) void tidyEntry($, ctx, entry)
  if (images > 0) notes.push('the image was not kept')
  const said = reportQueued(added, notes, keys.root, all.length)
  if (report === 'log') $.ui.log(said)

  return said
}

// A dropped prompt goes back into the box; once queued it should not wait there to be
// deleted by hand. The engine's put-back raises prompt.change, which empties the box at
// once (emptyBoxAfterQueue); this timer is the fallback. Either empties it only while it
// still holds exactly that message, so a new draft typed meanwhile is left alone.
function emptyBoxLater($: Engine, ctx: Context, typed: string) {
  ctx.session.justQueued = typed
  $.clock.after(30, async () => {
    const box = await $.prompt.read().catch(() => undefined)
    if (box && box.text.trim() === typed) await $.prompt.fill({ text: '', mode: 'replace' }).catch(() => undefined)
  })
}

const isTypedMessage = (e: { origin: { kind: string }; command?: unknown }) => e.origin.kind === 'composer' && e.command === undefined

// A message typed with a mark is dropped before the model and queued. Enter is answered at
// once, as on a plain prompt: the slow part (the clipboard, the search, the store) runs right
// after, one message at a time, and says in a transcript line where each entry points. Only
// the selection is read now, before it goes away.
type Submit = Parameters<Hook<'prompt.submit'>>

export async function queueTyped(ctx: Context, $: Engine, e: Submit[1], next: Submit[2]) {
  const entries = isTypedMessage(e) ? parseEntries(e.text) : null
  if (entries === null) {
    if (isTypedMessage(e) && e.text.trim() !== '') ctx.session.lastTask = shortenText(e.text, 200)
    void refreshBand($)

    return next(e)
  }

  const text = e.text
  const task = e.turnId !== undefined ? ctx.session.lastTask : undefined
  const output = currentOutput(ctx)
  const images = e.attachments?.length ?? 0
  const isComment = entries.some(entry => entry.kind !== 'idea' && Object.keys(entry.anchor).length === 0)
  const selection = isComment ? await readReplySelection($) : ''
  $.clock.after(1, () =>
    chainWrite(
      ctx,
      () => addEntries($, ctx, text, task, output, { images, selection, report: 'log' }),
      error => $.ui.log(`queue: could not store "${shortenText(text, 40)}": ${String(error)}`),
    ),
  )
  emptyBoxLater($, ctx, e.text.trim())

  return { drop: 'queued' }
}

type SubmitFailed = Parameters<CatchHandler<Hook<'prompt.submit'>>>

// A queued entry that failed to store is dropped, not sent: it was meant to wait.
export function dropFailedEntry($: Engine, e: SubmitFailed[1], next: SubmitFailed[2]) {
  return next.called || !(isTypedMessage(e) && parseEntries(e.text)) ? next(e) : { drop: 'queue: could not store this entry; nothing was sent' }
}

type Change = Parameters<Hook<'prompt.change'>>

export async function emptyBoxAfterQueue(ctx: Context, $: Engine, e: Change[1], next: Change[2]) {
  if (ctx.session.justQueued !== undefined && e.origin.kind === 'engine' && e.text.trim() === ctx.session.justQueued) {
    ctx.session.justQueued = undefined
    await $.prompt.fill({ text: '', mode: 'replace' }).catch(() => undefined)
  }

  return next(e)
}

// What a command or an edit printed in the main loop, failed or not: a denied call, a
// missing file on Read or a refused web fetch is not what a comment is about.
type ToolCall = Parameters<Hook<'tool.call'>>

export async function rememberToolOutput(ctx: Context, e: ToolCall[1], next: ToolCall[2]) {
  const ran = await next(e)
  const isError = ran.isError === true
  if (e.agentId === undefined && ran.deny === undefined && OUTPUT_TOOLS.has(e.tool)) {
    const { lastOutput, turnId } = ctx.session
    const keepsError = lastOutput?.isError === true && lastOutput.turnId === turnId && !isError
    if (!keepsError) {
      const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : JSON.stringify(ran.result ?? ''))
      ctx.session.lastOutput = { text: `${e.tool}${isError ? ' failed' : ''}: ${shortenText(text, 400)}`, turnId, isError }
    }
  }

  return ran
}

// A markdown file Claude wrote or edited may hold tags: /aside reads it from now on.
export async function rememberMarkdownFile<R extends { deny?: unknown; isError?: boolean }>($: Engine, path: string, ran: R): Promise<R> {
  if (ran.deny === undefined && !ran.isError && MARKDOWN_PATH.test(path)) {
    await trackFile($, path)
  }

  return ran
}
