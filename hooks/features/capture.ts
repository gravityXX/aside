// A typed message becoming stored entries: what it holds, where each one points, and what the
// person reads back. The slow part, the clipboard and git, runs before the queue is read and
// never while it is held (2.9).

import type { CatchHandler, Hook } from 'claude-code'

import type { Band, Entry } from '../../types'
import { currentOutput } from '../context'
import type { Context } from '../context'
import { inOrder, isSameEntry, KINDS, parseEntries, retypedRaw } from '../core/entries'
import type { Order } from '../core/entries'
import { formatPlace } from '../core/listing'
import { MARKDOWN_PATH } from '../core/markdown'
import { pinComment } from '../core/pin'
import type { Copied, Pin, Sources } from '../core/pin'
import { readTidyReply, TIDY_SYSTEM, tidyPrompt } from '../core/prompts'
import { describeError, describeTool, formatCount, newQueueNote, shortenText } from '../core/text'
import { readClipboard, readGitBranch, resolveFile, searchMarkdown, tryReadFile } from '../io/host'
import { changeQueue, changeQueueAfter } from '../io/queue'
import { forgetEditing, loadEditing, projectKeys, readTrackedFiles, refreshBand, trackFile } from '../io/store'
import { GLOBAL, addIdeas, countQueues, forgetGlobalEditing, forgetGlobalIdeas, isLocalQueue, isOut, loadGlobalEditing, loadIdeas, queueName, queueOf, resolveQueue, restoreIdea, saveGlobalIdea } from '../io/queues'
import type { GlobalIdea } from '../io/queues'
import type { Kit } from '../kit'

// The tools whose output a comment may be about when nothing else says so; any error counts.
const OUTPUT_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit'])

// The text selected in one transcript row: one in the prompt box or a pane is not about
// Claude's output.
function readReplySelection($: Kit): Promise<string> {
  return $.ui.selection().then(one => (one?.requestId ? one.text.trim() : ''), () => '')
}

// What the pinning rules in core/pin.ts read, each a closure over `$` made here, where `$` is.
// The clipboard and the selection are read at most once per message, and a file at most once,
// however many comments the message holds.
function commentSources(
  $: Kit,
  ctx: Context,
  root: string,
  seen: readonly string[],
  output: string | undefined,
  selection: string | undefined,
  isRemote: boolean,
): Sources {
  let clipboard: Promise<Copied> | undefined
  let selected: Promise<string> | undefined
  const sourceCache = new Map<string, Promise<string | undefined>>()
  const readCopied = async (): Promise<Copied> => {
    const read = await readClipboard($, ctx.session.clipboard)

    return read.hasReader ? read : { ...read, missing: 'no clipboard reader here (wl-clipboard, xclip or xsel)' }
  }
  const machine = {
    read: (file: string) => {
      if (!sourceCache.has(file)) sourceCache.set(file, tryReadFile($, file))

      return sourceCache.get(file)!
    },
    search: (quote: string) => searchMarkdown($, quote, root),
    resolve: (file: string) => resolveFile($, file, root, seen),
    ...(output ? { output } : {}),
  }

  // A comment from another device: this machine's clipboard is not the one it was copied on.
  if (isRemote) {
    return {
      ...machine,
      clipboard: () => Promise.resolve({ text: '', isNew: false, missing: 'sent from another device, so no clipboard was read' }),
      selection: () => Promise.resolve(''),
    }
  }

  return {
    ...machine,
    clipboard: () => (clipboard ??= readCopied()),
    selection: () => (selected ??= selection !== undefined ? Promise.resolve(selection) : readReplySelection($)),
  }
}

// What was queued and where it points, as the line the dropped prompt leaves in the transcript.
const reportQueued = (entries: readonly Entry[], notes: readonly string[], root: string, waiting: number) => {
  const why = notes.length > 0 ? ` - ${[...new Set(notes)].join('; ')}` : ''
  if (entries.length > 1) {
    return `queued ${entries.length} entries${why} · ${waiting} waiting`
  }
  const entry = entries[0]!
  if (entry.kind === 'idea') {
    return `queued "${shortenText(entry.text, 30)}" · ${waiting} waiting`
  }
  const at = formatPlace(entry, root)
  const quote = entry.quote ? ` "${shortenText(entry.quote, 30)}"` : ''
  const spot = at || quote ? `${at}${quote}`.trimStart() : `"${shortenText(entry.text, 30)}"`

  return `queued ${KINDS[entry.kind].mark} ${spot}${why} · ${waiting} waiting`
}

// An edited entry back at its place as /aside showed it.
const putBack = (stored: readonly Entry[], added: readonly Entry[], index: number, order: Order): Entry[] => {
  const shown = inOrder(stored, order)
  shown.splice(Math.min(index, shown.length), 0, ...added)

  return inOrder(shown, order)
}

// A tidying in flight, which a planner waits for.
function whileTidying(ctx: Context, work: Promise<void>) {
  const tidy = work.catch(() => undefined)
  ctx.session.tidies.add(tidy)
  void tidy.then(() => ctx.session.tidies.delete(tidy))
}

// An idea typed for a queue of no project, "+g" or "+@work", and that queue.
type Listed = { list: string; entry: Entry }

// The ideas typed for queues of no project, each onto its queue. A message that is one such
// idea, sent while an idea is out with /aside q edit, takes that idea's place when it names the
// same queue, and moves it to the queue it names otherwise; the record goes once it is back.
// All of them or none: should a write fail, those already written are taken back.
async function storeListed($: Kit, ideas: readonly Listed[], isSingle: boolean): Promise<GlobalIdea[]> {
  if (ideas.length === 0) {
    return []
  }
  const editing = isSingle ? await loadGlobalEditing($) : undefined
  if (editing && (await queueOf($, editing)) === ideas[0]!.list) {
    const idea = await restoreIdea($, { key: editing.key, entry: { ...editing.entry, text: ideas[0]!.entry.text, raw: ideas[0]!.entry.raw } }, editing.entry)
    await forgetGlobalEditing($)

    return [idea]
  }
  const added: GlobalIdea[] = []
  try {
    for (const list of new Set(ideas.map(one => one.list))) {
      added.push(...(await addIdeas($, list, ideas.filter(one => one.list === list).map(one => one.entry))))
    }
  } catch (error) {
    await forgetGlobalIdeas($, added.map(idea => idea.key)).catch(() => undefined)
    throw error
  }
  if (editing) await forgetGlobalEditing($)

  return added
}

// What a message queued for queues of no project says, one part per queue, in the order typed:
// the global list by its count, any other queue by its name, and a queue the message made as
// new, with whom it is for and how to make it the other.
const reportListed = (ideas: readonly Listed[], band: Band, isNew: (list: string) => boolean): string[] =>
  [...new Set(ideas.map(one => one.list))].map(list => {
    const own = ideas.filter(one => one.list === list)
    const what = own.length === 1 ? `"${shortenText(own[0]!.entry.text, 30)}"` : formatCount(own.length, 'idea')
    if (list === GLOBAL) {
      return `queued ${what} to the global list · ${band.global ?? 0} global`
    }
    const name = queueName(list)
    const count = band.named?.find(one => one.name === name)?.count ?? own.length

    return isNew(list) ? `queued ${what} to @${name}, ${newQueueNote(name, isLocalQueue(list))}` : `queued ${what} to @${name} · ${count} in @${name}`
  })

// A tidied text from the small model, or undefined when none comes in time.
async function askTidy($: Kit, text: string): Promise<string | undefined> {
  if (text.trim() === '') {
    return undefined
  }
  const ask = { model: 'haiku', system: TIDY_SYSTEM, prompt: tidyPrompt(text), maxTokens: 1024, timeoutMs: 10_000 }
  const reply = await $.model.complete(ask).catch(() => undefined)

  return reply?.isAnswered ? readTidyReply(reply.text, text) : undefined
}

// An idea's text in a queue of no project, tidied as an entry's is, unless the idea has left
// its queue or changed meanwhile.
async function tidyGlobalIdea($: Kit, idea: GlobalIdea): Promise<void> {
  const fixed = await askTidy($, idea.entry.text)
  if (fixed === undefined) {
    return
  }
  const now = (await loadIdeas($, (await queueOf($, idea)) ?? GLOBAL)).find(one => one.key === idea.key)
  if (now === undefined || now.entry.text !== idea.entry.text) {
    return
  }
  const raw = retypedRaw(now.entry, fixed)
  await saveGlobalIdea($, { key: now.key, entry: { ...now.entry, text: fixed, ...(raw === undefined ? {} : { raw }) } })
  // Taken out meanwhile with edit or clear, between the read above and that write: the write
  // brought its key back, so it goes again, and the idea comes back only as edit or undo brings it.
  if (await isOut($, now.key)) await forgetGlobalIdeas($, [now.key])
}

// An entry's own text, tidied by a small model once it is stored. It waits as typed until
// the reply comes, and keeps that text when none comes in time or the entry has left the
// queue by then. The edit box gets the tidied text too, with its mark and place as typed.
// It resolves once the tidied text is stored, so a planner that waits for it reads that text.
async function tidyEntry($: Kit, entry: Entry): Promise<void> {
  const fixed = await askTidy($, entry.text)
  if (fixed === undefined) {
    return
  }
  const isTidied = await changeQueue($, stored => {
    const i = stored.findIndex(one => isSameEntry(one, entry))
    const one = stored[i]
    if (one === undefined) return { value: false }
    const raw = retypedRaw(one, fixed)
    const tidied = { ...one, text: fixed, ...(raw === undefined ? {} : { raw }) }

    return { list: stored.map((each, j) => (j === i ? tidied : each)), value: true }
  })
  if (isTidied) await refreshBand($)
}

// How addEntries reports what it queued: a line in the transcript (a typed "+", whose prompt
// has long been answered by then), or nothing (a command, which answers with the text itself).
type Report = 'log' | 'none'

// Stores what a message (or /aside TEXT) holds and says what was queued and where it
// points, or returns null when the text is no entry at all.
export async function addEntries(
  $: Kit,
  ctx: Context,
  text: string,
  task: string | undefined,
  output: string | undefined,
  options: { images?: number; selection?: string; report?: Report; isRemote?: boolean } = {},
): Promise<string | null> {
  const { images = 0, report = 'none' } = options
  const typed = parseEntries(text)
  if (typed === null) {
    return null
  }
  // The ideas for queues of no project this message stored, and whether its part of the queue
  // is stored too: until then a failure takes those ideas back.
  let onGlobal: GlobalIdea[] = []
  let isStored = false
  // One change on the queue for the whole message, so messages sent one after another are stored
  // in that order, and an entry back from /aside edit is put back by one of them alone. The slow
  // part (git, the clipboard, the files a comment points into) comes before the queue is read,
  // so the list is read right before it is stored and a removal or a hand-over meanwhile is kept.
  const prepare = async () => {
    const keys = await projectKeys($)
    const seen = await readTrackedFiles($)
    const now = await $.clock.now()
    const branch = await readGitBranch($, keys.root)
    const sources = commentSources($, ctx, keys.root, seen, output, options.selection, options.isRemote === true)
    // An entry taken out with /aside edit comes back where it was, keeping what it pointed at,
    // unless the reworked text names a place of its own.
    const editing = await loadEditing($, keys.editing)
    const isRework =
      editing !== undefined && typed.length === 1 && typed[0]!.list === undefined && typed[0]!.kind === editing.idea.kind && Object.keys(typed[0]!.anchor).length === 0
    const added: Entry[] = []
    const notes: string[] = []
    // Each "+@name" to the queue that name means here, or a new one of the scope the setting gives.
    const listed: Listed[] = []
    for (const one of typed) {
      if (one.list === undefined) continue
      const list = await resolveQueue($, one.list, ctx.settings.newQueues === 'local')
      listed.push({ list, entry: { text: one.text, raw: one.raw, at: now, kind: 'idea' as const } })
    }
    // The queues there before, so a message that makes one says so; the queue of an idea out for
    // editing is there still, even when that idea was its only one.
    const out = listed.length > 0 ? await loadGlobalEditing($) : undefined
    const queues = listed.length > 0 ? new Set([...(await countQueues($)).map(one => one.name), ...(out ? [(await queueOf($, out)) ?? GLOBAL] : [])]) : new Set<string>()
    for (const one of typed.filter(entry => entry.list === undefined)) {
      if (isRework) {
        const { text: _text, raw: _raw, ...kept } = editing!.idea
        added.push({ ...kept, text: one.text, raw: one.raw })
        continue
      }
      const { note, ...spot } = one.kind === 'idea' ? ({} as Pin) : await pinComment(one, keys.root, seen, sources)
      if (note) notes.push(note)
      added.push({ text: one.text, raw: one.raw, at: now, kind: one.kind, ...spot, ...(task ? { task } : {}), ...(branch ? { branch } : {}) })
    }

    return { keys, editing, isRework, added, notes, listed, queues }
  }
  const { keys, added, all, notes, listed, queues } = await changeQueueAfter($, prepare, async (stored, { keys, editing, isRework, added, notes, listed, queues }) => {
    const all = isRework ? putBack(stored, added, editing!.index, ctx.settings.order) : [...stored, ...added]
    // The ideas for queues of no project first, and taken back should the queue's write fail, so
    // a message is kept whole or not at all and sent again adds nothing twice.
    onGlobal = await storeListed($, listed, typed.length === 1)
    // An idea taken out with /aside edit and sent back as "+g idea" or "+@work idea" has moved
    // to that queue.
    const isMovedOut = editing !== undefined && typed.length === 1 && typed[0]!.list !== undefined && editing.idea.kind === 'idea'
    const forget = editing !== undefined && (added.length > 0 || isMovedOut)

    return {
      ...(added.length > 0 ? { list: all } : {}),
      value: { keys, added, all, notes, listed, queues },
      afterSave: async () => {
        isStored = true
        // Each tidying is one a planner waits for from the moment its entry can be read.
        for (const entry of ctx.settings.tidy ? added : []) whileTidying(ctx, tidyEntry($, entry))
        for (const idea of ctx.settings.tidy ? onGlobal : []) whileTidying(ctx, tidyGlobalIdea($, idea))
        if (forget) await forgetEditing($, keys.editing)
      },
    }
  }).catch(async (error: unknown) => {
    if (!isStored) await forgetGlobalIdeas($, onGlobal.map(idea => idea.key)).catch(() => undefined)
    throw error
  })
  const band = await refreshBand($)
  if (images > 0) notes.push('the image was not kept')
  const parts = [
    ...(added.length > 0 ? [reportQueued(added, notes, keys.root, all.length)] : []),
    ...reportListed(listed, band, list => !queues.has(list)),
  ]
  const said = parts.join('; ')
  if (report === 'log') $.ui.log(said)

  return said
}

// A dropped prompt goes back into the box; once queued it should not wait there to be
// deleted by hand. The engine's put-back raises prompt.change, which empties the box at
// once (emptyBoxAfterQueue); this timer is the fallback. Either empties it only while it
// still holds exactly that message, so a new draft typed meanwhile is left alone.
function emptyBoxLater($: Kit, ctx: Context, typed: string) {
  ctx.session.justQueued = typed
  $.clock.after(30, async () => {
    // Emptied already, or given back because it could not be stored.
    if (ctx.session.justQueued !== typed) return
    const box = await $.prompt.read().catch(() => undefined)
    if (box && box.text.trim() === typed) await $.prompt.fill({ text: '', mode: 'replace' }).catch(() => undefined)
  })
}

// Typed by the person: at this terminal, or on a phone or the web through Remote Control.
const isTypedMessage = (e: { origin: { kind: string }; command?: unknown }) => (e.origin.kind === 'composer' || e.origin.kind === 'bridge') && e.command === undefined

// A message typed with a mark is dropped before the model and queued. Enter is answered at
// once, as on a plain prompt: the slow part (the clipboard, the search, the store) runs right
// after, one message at a time, and says in a transcript line where each entry points. Only
// the selection is read now, before it goes away.
type Submit = Parameters<Hook<'prompt.submit'>>

export async function queueTyped(ctx: Context, $: Kit, e: Submit[1], next: Submit[2]) {
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
  // Sent from a phone or the web: this machine's clipboard, selection and prompt box are not
  // the sender's.
  const isRemote = e.origin.kind === 'bridge'
  const isComment = entries.some(entry => entry.kind !== 'idea' && Object.keys(entry.anchor).length === 0)
  const selection = isComment && !isRemote ? await readReplySelection($) : ''
  $.clock.after(1, () =>
    addEntries($, ctx, text, task, output, { images, selection, report: 'log', isRemote }).catch((error: unknown) =>
      storeFailed($, ctx, text, error, isRemote).catch(() => undefined),
    ),
  )
  if (!isRemote) emptyBoxLater($, ctx, e.text.trim())

  return { drop: 'queued' }
}

// A typed entry that could not be stored goes back into the prompt box when the box is empty,
// so nothing typed is lost; with a new draft there, the transcript line gives it whole.
async function storeFailed($: Kit, ctx: Context, text: string, error: unknown, isRemote: boolean) {
  if (ctx.session.justQueued === text.trim()) ctx.session.justQueued = undefined
  const why = describeError(error)
  const box = isRemote ? undefined : await $.prompt.read().catch(() => undefined)
  const filled = box?.text.trim() === '' ? await $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined) : undefined
  $.ui.log(
    filled?.isFilled
      ? `Could not queue "${shortenText(text, 40)}" (${why}); it is back in the prompt box.`
      : `Could not queue this entry (${why}); here it is to queue again:\n${text}`,
  )
}

type SubmitFailed = Parameters<CatchHandler<Hook<'prompt.submit'>>>

// A queued entry that failed to store is dropped, not sent: it was meant to wait.
export function dropFailedEntry($: Kit, e: SubmitFailed[1], next: SubmitFailed[2]) {
  return next.called || !(isTypedMessage(e) && parseEntries(e.text)) ? next(e) : { drop: 'aside could not queue this entry; nothing was sent to Claude' }
}

type Change = Parameters<Hook<'prompt.change'>>

export async function emptyBoxAfterQueue(ctx: Context, $: Kit, e: Change[1], next: Change[2]) {
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
  // What the main loop does now, as the step running shows it, kept as the call starts.
  if (e.agentId === undefined) ctx.session.lastTool = { turnId: ctx.session.turnId, text: describeTool(e.tool, e as unknown as Record<string, unknown>) }
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
export async function rememberMarkdownFile<R extends { deny?: unknown; isError?: boolean }>($: Kit, path: string, ran: R): Promise<R> {
  if (ran.deny === undefined && !ran.isError && MARKDOWN_PATH.test(path)) {
    await trackFile($, path)
  }

  return ran
}
