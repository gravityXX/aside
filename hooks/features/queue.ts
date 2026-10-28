// The project's own queue: its listing, and the commands on its entries. The queues no project
// owns are in `global`. Nothing here holds the queue's key: only io/queue.ts writes it (2.9).

import type { Entry } from '../../types'
import type { Context, PaneView } from '../context'
import { findTags, inOrder } from '../core/entries'
import { describeCount, isExportText, listedText, listingMarkdown, listingText, planSection, queueSection, tagsSection } from '../core/listing'
import { isWaiting, turnOf } from '../core/step'
import type { Listed, ListingSection } from '../core/listing'
import { popPrompt } from '../core/prompts'
import { askPlaces, askTwoPlaces, canonicalPath, formatCount, isAbsolutePath, isPlace, isWindowsPath, relativePath, shortenText } from '../core/text'
import { resolveFile, tryReadFile, writeExport } from '../io/host'
import { bringBackTake, changeQueue, readQueue, takeCleared } from '../io/queue'
import type { QueueChange } from '../io/queue'
import { loadPlan, loadTagIds, projectKeys, readTrackedFiles, refreshBand, saveEditing, tagId, trackFile } from '../io/store'
import type { Kit } from '../kit'

// The <!-- ? --> tags in the session's markdown files, as entries of their own; `onlyNew`
// leaves out those an earlier /aside already handed over.
export async function tagsInFiles($: Kit, onlyNew = false): Promise<Entry[]> {
  const { handed } = await projectKeys($)
  const old = new Set(onlyNew ? await loadTagIds($, handed) : [])
  const found: Entry[] = []
  for (const file of await readTrackedFiles($)) {
    const source = await tryReadFile($, file)
    for (const tag of source === undefined ? [] : findTags(source)) {
      const entry: Entry = { text: tag.text, at: 0, kind: tag.kind, file, line: tag.line, isTag: true, ...(tag.quote ? { quote: tag.quote } : {}) }
      if (!old.has(tagId(entry))) found.push(entry)
    }
  }

  return found
}

// What /aside shows: the queue, the tags in files and the plan, with what each section holds.
// While a run goes on, a step running, waiting or paused after, the plan comes first, so what
// happens now is at the top however long the queue is.
async function loadListing($: Kit, ctx: Context) {
  const { root, plan: planKey, handed } = await projectKeys($)
  const list = await readQueue($, ctx.settings.order)
  const tags = await tagsInFiles($)
  const handedOver = new Set(await loadTagIds($, handed))
  const plan = await loadPlan($, planKey)
  const { lastTool } = ctx.session
  // A turn's id names one turn of one process: the step running in it is this session's. A step
  // with no turn of its own running matches no tool, whatever the last one's turn was.
  const doingTurn = plan.active === undefined ? undefined : turnOf(plan.active)
  const isDoing = doingTurn !== undefined && doingTurn === lastTool?.turnId
  const steps = planSection(plan, await $.clock.now(), isDoing ? lastTool.text : undefined)
  const queued = [queueSection(list, root), ...(tags.length > 0 ? [tagsSection(tags, root, tag => handedOver.has(tagId(tag)))] : [])]
  const isRunGoing = plan.active !== undefined || plan.paused !== undefined
  const sections = steps === null ? queued : isRunGoing ? [steps, ...queued] : [...queued, steps]

  return { root, list, tags, plan, sections }
}

export async function currentListing($: Kit, ctx: Context): Promise<ListingSection[]> {
  return (await loadListing($, ctx)).sections
}

// Words joined as a sentence lists them: "a, b and c".
const joinWords = (words: readonly string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`)

// Why a FILE for /aside export would not land where its name says, if it would not: a home
// folder or a variable nobody expands, or a path spelled for another system.
const exportNameProblem = (name: string, root: string): string | undefined => {
  if (/^(?:~|\$|%[^%]+%)/.test(name)) {
    return 'Name a file in the project or by its full path, as ~, $HOME and %USERPROFILE% are not expanded: /aside export notes/queue.md'
  }
  if (!isWindowsPath(root)) {
    return isWindowsPath(name) || name.includes('\\') ? `${name} is spelled as on Windows; name the file as this system does, such as notes/queue.md.` : undefined
  }
  // On Windows a path with no drive starts at the drive's root, and any other ":" names a
  // stream inside a file.
  const isUnplaced = /^[\\/](?![\\/])/.test(name) || name.replace(/^[A-Za-z]:(?=[\\/])/, '').includes(':')

  return isUnplaced ? `${name} is not a full Windows path; name the file in the project or with its drive, such as C:\\notes\\queue.md.` : undefined
}

// Writes what /aside shows to a Markdown file in the project, aside.md unless named: over an
// earlier export, never over another file. The queue stays as it is.
export async function exportListing($: Kit, ctx: Context, name: string): Promise<string> {
  const { root, list, tags, plan, sections } = await loadListing($, ctx)
  if (list.length === 0 && tags.length === 0 && plan.steps.length === 0) {
    return 'Nothing to export: the queue is empty.'
  }
  const problem = exportNameProblem(name, root)
  if (problem) {
    return problem
  }
  const named = canonicalPath(name || 'aside.md', root)
  const path = isAbsolutePath(named) ? named : canonicalPath(`${root}/${named}`)
  const shown = relativePath(path, root)
  // In UTC: the clock gives the moment, not the person's time zone.
  const made = new Date(await $.clock.now()).toISOString().slice(0, 16).replace('T', ' ')
  const wrote = await writeExport($, path, listingMarkdown(sections, `${made} UTC`))
  if (!wrote.isWritten) {
    return 'isForeign' in wrote ? `${shown} is not an aside export; name another file: /aside export FILE` : `Could not write ${shown}: ${wrote.reason}.`
  }
  const what = [describeCount(list), tags.length > 0 ? formatCount(tags.length, 'tag') : '', plan.steps.length > 0 ? `the plan of ${formatCount(plan.steps.length, 'step')}` : '']

  return `Exported ${joinWords(what.filter(Boolean))} to ${shown}.`
}

// The pane the band's list button opens; register.tsx names the same id in its matcher.
export const LIST_PANE = 'aside'

// The list pane as the person sees it: not open, open but out of sight (a tab behind another
// pane, or waiting undrawn), or in sight.
async function listPaneState($: Kit): Promise<'closed' | 'hidden' | 'shown'> {
  const pane = (await $.ui.panes()).find(one => one.id === LIST_PANE)

  return pane === undefined ? 'closed' : pane.isShown && pane.isPlaced ? 'shown' : 'hidden'
}

// Shows the list pane on `view`: opens it, or brings it to the front when it is open out of
// sight, and draws it again when it is in sight already. Each opener names what it shows, so a
// view another command left never stands in for it. The reason is the surface's when it cannot
// place the pane.
export async function openListPane($: Kit, ctx: Context, view: PaneView): Promise<{ isPlaced: true } | { isPlaced: false; reason: string }> {
  setPaneView($, ctx, view)
  if ((await listPaneState($)) === 'shown') {
    return { isPlaced: true }
  }

  return $.ui.open({ id: LIST_PANE, title: 'aside', focus: true, closeOnEscape: true })
}

// The band's list button: closes the list pane when it is in sight, shows it otherwise. A pane
// open out of sight is shown, not closed, or the press would seem to do nothing.
export async function toggleListPane($: Kit, ctx: Context) {
  const state = await listPaneState($)
  if (state === 'shown') {
    await $.ui.close({ id: LIST_PANE })
    return
  }
  const opened = await openListPane($, ctx, { kind: 'queue' })
  // The engine's reason runs long ("unasked below 144 columns (125 now): placed when ..."): its head says enough.
  if (!opened.isPlaced) $.ui.toast(`Could not show the list pane (${opened.reason.split(':')[0]}); /aside shows the list`)
}

// /aside alone. While Claude works, what a command prints shows only once the turn ends, so
// the list opens in the pane, which shows at once and keeps up to date; where the terminal has
// no room for it, the list goes into the transcript as a line, which shows at once too.
export async function showListing($: Kit, ctx: Context): Promise<string> {
  return showWhileWorking($, ctx, { kind: 'queue' }, { sections: await currentListing($, ctx) }, 'the list')
}

// What the list pane shows from now on, drawn again at once if it is open.
function setPaneView($: Kit, ctx: Context, view: PaneView) {
  ctx.session.paneView = view
  $.ui.invalidate('ui.render')
}

// What a command lists, as its text; while Claude works, in the list pane at once, drawn as
// `view` and kept up to date there, or where the pane has no room, in the transcript. A pane
// left open after the turn shows it too. A sentence with nothing to list is the command's text
// either way, and leaves the pane as it is.
export async function showWhileWorking($: Kit, ctx: Context, view: PaneView, listed: Listed, what: string): Promise<string> {
  const text = listedText(listed)
  if (typeof listed === 'string') {
    return text
  }
  if (!ctx.session.isRunning) {
    setPaneView($, ctx, view)
    return text
  }
  if ((await openListPane($, ctx, view)).isPlaced) {
    return `Opened ${what} in the pane while Claude was working.`
  }
  $.ui.log(text)

  return `Wrote ${what} above while Claude was working.`
}

// Changes the queue as /aside shows it, in its turn on the queue's chain (2.9): `change` gets
// the list as it is stored by then, numbered as /aside numbers it, so a tidy reply or an entry
// typed meanwhile is neither stored over nor taken for the one shown. What it makes of the list
// goes back in the order the store keeps, oldest first.
function changeShownQueue<T>($: Kit, ctx: Context, change: (list: Entry[]) => QueueChange<T> | Promise<QueueChange<T>>): Promise<T> {
  return changeQueue($, async stored => {
    const made = await change(inOrder(stored, ctx.settings.order))

    return made.list === undefined ? made : { ...made, list: inOrder(made.list, ctx.settings.order) }
  })
}

// Takes entry `n` out of the queue and into the prompt box, in the change that takes it out, so
// what the box gets is what left the queue. `into` says what goes in the box, what the person
// reads of it, and what goes with the queue once it is stored, such as the record of where an
// entry out for /aside edit stood, which is there before a message sent right after.
async function takeIntoBox(
  $: Kit,
  ctx: Context,
  n: number,
  shown: string,
  into: (entry: Entry) => { typed: string; said: string; afterSave?: () => Promise<unknown> },
): Promise<string> {
  const { text, isTaken } = await changeShownQueue($, ctx, async list => {
    if (list.length === 0) {
      return { value: { text: 'The queue is empty.', isTaken: false } }
    }
    if (!isPlace(n, list.length)) {
      return { value: { text: askPlaces(1, list.length, 'number', shown), isTaken: false } }
    }
    const entry = list[n - 1]!
    const { typed, said, afterSave } = into(entry)
    const filled = await $.prompt.fill({ text: typed, mode: 'insert' })
    if (!filled.isFilled) {
      return { value: { text: 'The prompt box cannot take it now; the entry stays in the queue.', isTaken: false } }
    }

    return { list: list.filter((_entry, i) => i !== n - 1), value: { text: said, isTaken: true }, ...(afterSave ? { afterSave } : {}) }
  })
  if (isTaken) await refreshBand($)

  return text
}

// The entry back in the box as it was typed, to change and send again: it goes back to the
// place it had, still pointing where it did.
export async function editEntry($: Kit, ctx: Context, n: number): Promise<string> {
  const keys = await projectKeys($)

  return takeIntoBox($, ctx, n, '/aside list', entry => ({
    typed: entry.raw ?? `+ ${entry.text}`,
    said: `Entry ${n} is in the prompt box: change it and press Enter; it goes back to place ${n}, still pointing where it did.`,
    afterSave: () => saveEditing($, keys.editing, { index: n - 1, idea: entry }),
  }))
}

export async function moveEntry($: Kit, ctx: Context, from: number, to: number): Promise<string> {
  const { root } = await projectKeys($)

  return changeShownQueue($, ctx, list => {
    if (list.length < 2) {
      return { value: 'Nothing to move.' }
    }
    if (!isPlace(from, list.length) || !isPlace(to, list.length)) {
      return { value: askTwoPlaces(list.length) }
    }
    const [entry] = list.splice(from - 1, 1)
    list.splice(to - 1, 0, entry!)

    return { list, value: listingText([queueSection(list, root)]) }
  })
}

// The first entry, or entry `n`, taken out of the queue into the box, ready to send: no
// "+" in front, a comment with what it is about.
export async function popEntry($: Kit, ctx: Context, n?: number): Promise<string> {
  const { root } = await projectKeys($)

  return takeIntoBox($, ctx, n ?? 1, '/aside', entry => ({
    typed: popPrompt(entry, root),
    said: `In the prompt box, ready to send: ${shortenText(entry.text, 60)}`,
  }))
}

// Removes the entries at places `numbers`, all of them or none when one is out of range.
export async function removeEntries($: Kit, ctx: Context, numbers: readonly number[]): Promise<string> {
  const gone = await changeShownQueue<string | Entry[]>($, ctx, list => {
    if (list.length === 0) {
      return { value: 'The queue is empty.' }
    }
    if (!numbers.every(n => isPlace(n, list.length))) {
      return { value: askPlaces(numbers.length, list.length, 'number', '/aside list') }
    }
    const places = new Set(numbers)

    return { list: list.filter((_entry, i) => !places.has(i + 1)), value: list.filter((_entry, i) => places.has(i + 1)) }
  })
  if (typeof gone === 'string') {
    return gone
  }
  await refreshBand($)

  return gone.length === 1 ? `Removed: ${gone[0]!.text}` : `Removed ${formatCount(gone.length, 'entry')}: ${gone.map(entry => shortenText(entry.text, 40)).join('; ')}`
}

export async function clearQueue($: Kit): Promise<string> {
  const stored = await takeCleared($)
  if (stored.length === 0) {
    return 'The queue is already empty.'
  }
  await refreshBand($)

  return `Cleared ${stored.length} entries. /aside undo brings them back.`
}

// Brings back what plan, run or clear took, unless a step of the plan is running in this
// session, or waits for the person in any, so nothing is done twice.
export async function restoreTaken($: Kit): Promise<string> {
  const keys = await projectKeys($)
  const running = (await loadPlan($, keys.plan)).active
  if (running && (isWaiting(running) || running.sessionId === (await $.session.id()))) {
    const state = isWaiting(running) ? (running.is === 'answered' ? 'waits for your answer again or /aside continue' : 'waits for your answer') : 'is running'
    return `Step ${running.step + 1} of the plan ${state}; /aside stop first, so nothing is done twice.`
  }
  const { entries, tagIds } = await bringBackTake($)
  if (entries.length === 0 && tagIds.length === 0) {
    return 'Nothing to bring back.'
  }
  const now = await refreshBand($, (await tagsInFiles($, true)).length)
  const back = [entries.length > 0 ? formatCount(entries.length, 'entry') : '', tagIds.length > 0 ? formatCount(tagIds.length, 'tag') : '']

  return `Brought back ${back.filter(Boolean).join(' and ')}, ${now.ideas + now.comments + now.tags} waiting.`
}

// Adds a file Claude did not write in this session to the files whose tags /aside reads.
export async function scanFile($: Kit, name: string): Promise<string> {
  if (name === '') {
    return 'Name a file: /aside scan docs/report.md'
  }
  const { root } = await projectKeys($)
  const file = await resolveFile($, name, root, await readTrackedFiles($))
  const source = await tryReadFile($, file)
  if (source === undefined) {
    return `Cannot read ${name}.`
  }
  if (isExportText(source)) {
    return `${relativePath(file, root)} is an aside export; its tags are read from the files it lists.`
  }
  await trackFile($, file)
  const found = findTags(source).length
  await refreshBand($, (await tagsInFiles($, true)).length)

  return `${relativePath(file, root)}: ${formatCount(found, 'tag')}; /aside includes the file from now on.`
}
