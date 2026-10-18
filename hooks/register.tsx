import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Band, Idea, Plan, Step } from '../types'
import type { Entry } from './queue'
import {
  KINDS,
  capture,
  commentsOf,
  headingLine,
  ideasOf,
  listed,
  locate,
  entryPrompt,
  plan as planPrompt,
  popText,
  quoteWords,
  relative,
  send as sendPrompt,
  snippet,
  stepPrompt,
  tags,
  where,
} from './queue'

const EMPTY: Band = { ideas: 0, comments: 0, tags: 0, steps: 0, done: 0 }
const band = atom({ plugin: 'idea-queue', key: 'band' } as const, EMPTY)
// The markdown files written in this session, agents' included, newest last.
const files = atom({ plugin: 'idea-queue', key: 'files' } as const, [])

const MARKDOWN = /\.(md|markdown|mdx)$/i
// The tools whose output a comment may be about when nothing else says so; any error counts.
const OUTPUT_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit'])
const OWN = 'sent by the idea-queue plugin'
// The system's own tools: a session's PATH may hold shell functions (rg) a child cannot run.
const ENV = { LC_ALL: 'C.UTF-8' }

const HELP = [
  'Queue an idea: start a message with "+". When every line starts with "+", each line is its own entry.',
  'Comment on what the agents wrote: copy a fragment in the preview, then type',
  '  +? question   +! change   +- drop   ++ dig deeper',
  '  pin it yourself with @file, @file:42, @file#heading or #heading after the mark.',
  'In the editor, <!-- ? ... --> tags (? ! - +) in a markdown file count as comments too.',
  'With nothing new copied, a comment takes the text selected in Claude\'s reply, or the last tool output.',
  '',
  '/queue - show the queue and the plan',
  '/queue plan - have Claude organize the queue into steps (related entries merged)',
  '/queue run - run the plan step by step; with no plan, each entry as its own step',
  '/queue run N - run step N alone       /queue run all - send everything at once, no plan',
  '/queue stop - stop after the current step',
  '',
  '/queue TEXT - queue TEXT, as "+ TEXT" would ("/queue + run 3" for text that looks like a command)',
  '/queue pop [N] - put the last entry (or entry N) in the prompt box, ready to send',
  '/queue edit N - put entry N in the prompt box to rework it and queue it again',
  '/queue move N M - move entry N to place M     /queue remove N - remove entry N',
  '/queue clear - empty the queue                /queue undo - bring back what plan, run or clear took',
  '/queue scan FILE - read the tags of a file Claude did not write in this session',
].join('\n')

// What Tab offers after "/queue ", with the dim line beside each.
const SUBCOMMANDS: readonly (readonly [string, string])[] = [
  ['plan', 'organize the queue into steps'],
  ['run', 'run the plan, or the queue entry by entry'],
  ['stop', 'stop after the current step'],
  ['pop', 'put an entry in the box, ready to send'],
  ['edit', 'rework an entry and queue it again'],
  ['move', 'move an entry to another place'],
  ['remove', 'remove an entry'],
  ['clear', 'empty the queue'],
  ['undo', 'bring back what plan, run or clear took'],
  ['scan', 'read the tags of a markdown file'],
  ['list', 'show the queue and the plan'],
  ['help', 'show every command'],
]

// Everything belongs to the project: each root keeps its own queue and plan.
const keys = async ($: Engine) => {
  const root = await $.session.root()

  return {
    root,
    queue: `queue:${root}`,
    taken: `taken:${root}`,
    plan: `plan:${root}`,
    handed: `handed:${root}`,
    editing: `editing:${root}`,
  }
}

const loadIdeas = async ($: Engine, key: string): Promise<Idea[]> => {
  const value = await $.store.get(key)

  return Array.isArray(value) ? (value as Idea[]).map(idea => ({ ...idea, kind: idea.kind ?? 'idea' })) : []
}

const saveIdeas = async ($: Engine, key: string, list: readonly Idea[]) => {
  if (list.length === 0) {
    await $.store.delete(key)
  } else {
    await $.store.set(key, list)
  }
}

const loadPlan = async ($: Engine, key: string): Promise<Plan> => {
  const value = (await $.store.get(key)) as Plan | undefined

  return value && Array.isArray(value.steps) ? value : { steps: [] }
}

const savePlan = async ($: Engine, key: string, plan: Plan) => {
  if (plan.steps.length === 0) {
    await $.store.delete(key)
  } else {
    await $.store.set(key, plan)
  }
}

const readFile = async ($: Engine, path: string): Promise<string | undefined> => {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

// A tag is known by its file and text: lines move as the file is edited.
const tagKey = (idea: Idea) => `${idea.file}\u0000${idea.text}`

// The <!-- ? --> tags in the session's markdown files, as entries of their own; `isNew`
// leaves out those an earlier /queue already handed over.
const fileTags = async ($: Engine, isNew = false): Promise<Idea[]> => {
  const { handed } = await keys($)
  const old = new Set(isNew ? ((await $.store.get(handed)) as string[] | undefined) ?? [] : [])
  const found: Idea[] = []
  for (const file of await read($, files)) {
    const source = await readFile($, file)
    for (const tag of source === undefined ? [] : tags(source)) {
      const idea: Idea = { text: tag.text, at: 0, kind: tag.kind, file, line: tag.line, isTag: true, ...(tag.quote ? { quote: tag.quote } : {}) }
      if (!old.has(tagKey(idea))) found.push(idea)
    }
  }

  return found
}

const refresh = async ($: Engine, tagCount?: number) => {
  const { queue, plan: planKey } = await keys($)
  const list = await loadIdeas($, queue)
  const plan = await loadPlan($, planKey)
  const ideas = list.filter(idea => idea.kind === 'idea').length
  const next: Band = {
    ideas,
    comments: list.length - ideas,
    tags: tagCount ?? (await read($, band)).tags,
    steps: plan.steps.length,
    done: plan.steps.filter(step => step.isDone).length,
    ...(plan.active ? { running: plan.active.step + 1 } : {}),
  }
  await update($, band, () => next)

  return next
}

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw']

// The clipboard readers to try, in order: Windows' own under WSL, then macOS, Wayland,
// X11 and native Windows. The first that runs is kept for the rest of the session.
const READERS: readonly (readonly string[])[] = [
  ['powershell.exe', ...POWERSHELL],
  ['pbpaste'],
  ['wl-paste', '--no-newline', '--type', 'text'],
  ['xclip', '-selection', 'clipboard', '-out'],
  ['xsel', '--clipboard', '--output'],
  ['powershell', ...POWERSHELL],
]
let reader: readonly string[] | undefined

const clipboard = async ($: Engine): Promise<string> => {
  const isWsl = (await $.env.get('WSL_DISTRO_NAME')) !== undefined
  const order = reader ? [reader] : READERS.filter(argv => isWsl || argv[0] !== 'powershell.exe')
  for (const argv of order) {
    try {
      const ran = await $.process.run([...argv], { timeoutMs: 5000, stdin: '' })
      // 126 and 127: the shell could not find or run it; any other exit means it is there.
      if (ran.exitCode === 126 || ran.exitCode === 127) continue
      reader = argv
      const text = ran.exitCode === 0 ? ran.stdout.replace(/\r\n/g, '\n').trim() : ''

      return text.length > 20_000 ? '' : text
    } catch {
      continue
    }
  }

  return ''
}

// The files under `root` that `accept` takes, walked through $.fs: no .git, node_modules or
// other dot folders, and a bound on how much is listed, so a huge tree stays cheap.
const walk = async ($: Engine, root: string, accept: (path: string, size: number) => boolean, limit = 400): Promise<string[]> => {
  const found: string[] = []
  const dirs = [root]
  let listed = 0
  while (dirs.length > 0 && found.length < limit && listed < 20_000) {
    const dir = dirs.shift()!
    let entries: Awaited<ReturnType<Engine['fs']['list']>>
    try {
      entries = await $.fs.list(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      listed += 1
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const path = `${dir.replace(/[\\/]$/, '')}/${entry.name}`
      if (entry.kind === 'dir') dirs.push(path)
      else if (entry.kind === 'file' && accept(path, entry.size)) found.push(path)
    }
  }

  return found
}

const branchOf = async ($: Engine, root: string): Promise<string | undefined> => {
  try {
    const ran = await $.process.run(['git', '-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 })
    const name = ran.stdout.trim()

    return ran.exitCode === 0 && name !== '' && name !== 'HEAD' ? name : undefined
  } catch {
    return undefined
  }
}

// The markdown files under the root holding a few words of the fragment in a row, across
// line breaks and markup. GNU grep with PCRE is the fast way; where it is missing (macOS,
// Windows) the walk through $.fs does the same, more slowly. rg is not used: in a Claude
// Code session it may be a shell function no child process can run.
const search = async ($: Engine, quote: string, root: string): Promise<string[]> => {
  const raw = quote.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (raw.length < 5) {
    return []
  }
  const at = [0, Math.max(0, Math.floor(raw.length / 2) - 2), Math.max(0, raw.length - 4)]
  const parts = [...new Set(at.map(i => raw.slice(i, i + 4).join('[^\\p{L}\\p{N}]+')))]
  const pattern = parts.map(p => `(?:${p})`).join('|')
  try {
    const ran = await $.process.run(
      [
        'grep', '-rlizP', '--include=*.md', '--include=*.markdown', '--include=*.mdx',
        '--exclude-dir=node_modules', '--exclude-dir=.?*', '-e', pattern, root,
      ],
      { timeoutMs: 8000, env: ENV, stdin: '' },
    )
    // 0: found, 1: nothing found; anything else is a grep that cannot do this.
    if (ran.exitCode === 0 || ran.exitCode === 1) {
      return ran.stdout.split('\n').filter(Boolean).slice(0, 20)
    }
  } catch {
    // No grep here: walk instead.
  }
  const regex = new RegExp(pattern, 'iu')
  const hits: string[] = []
  for (const file of await walk($, root, (path, size) => MARKDOWN.test(path) && size <= 2_000_000)) {
    const text = await readFile($, file)
    if (text !== undefined && regex.test(text)) hits.push(file)
    if (hits.length >= 20) break
  }

  return hits
}

// A file named after "@": as written from the root, else a session file ending with it,
// else the first one under the root at that path.
const resolve = async ($: Engine, name: string, root: string, seen: readonly string[]): Promise<string> => {
  const direct = name.startsWith('/') ? name : `${root}/${name}`
  if (await $.fs.exists(direct).catch(() => false)) {
    return direct
  }
  const own = [...seen].reverse().find(file => file.endsWith(`/${name}`))
  if (own) {
    return own
  }
  const [first] = await walk($, root, path => path.endsWith(`/${name}`), 1)

  return first ?? direct
}

// Where a comment points, and why it points nowhere when it does: `note` is said to the
// person at once, so a comment that missed its fragment never passes unnoticed.
type Pin = Pick<Idea, 'file' | 'line' | 'heading' | 'quote' | 'isLoose' | 'from' | 'output'> & { note?: string }

// What a comment can be about when it names no place: the clipboard (and whether it changed
// since the last comment), the text selected in a transcript row, the last tool output.
// Each is asked at most once per message.
type About = { selection: () => Promise<string>; clipboard: () => Promise<{ text: string; isNew: boolean }>; output?: string }

// The clipboard text the last comment saw: an unchanged clipboard is likely stale.
let lastClipboard: string | undefined

// Where a comment points: what it names; else a clipboard copied since the last comment;
// else the text selected in a transcript row (Claude's reply); else an older clipboard.
// Each is looked for in the session's files and the project's. Text no file holds is kept as
// a loose quote and said so, since the person sees it and can take the entry back with
// /queue pop. With nothing on the clipboard, or nothing found, the last tool output rides along.
const pin = async ($: Engine, entry: Entry, root: string, seen: readonly string[], about: About, source: (file: string) => Promise<string | undefined>): Promise<Pin> => {
  const { anchor } = entry
  const named = anchor.file ? await resolve($, anchor.file, root, seen) : undefined
  if (named && anchor.line) {
    return { file: named, line: anchor.line }
  }
  const candidates = named ? [named] : [...seen].reverse()

  if (anchor.heading) {
    for (const file of candidates) {
      const text = await source(file)
      const found = text === undefined ? undefined : headingLine(text, anchor.heading)
      if (found) {
        return { file, line: found.line, heading: found.title }
      }
    }
    const scope = named ? relative(named, root) : `the ${candidates.length} files written this session`

    return { heading: anchor.heading, ...(named ? { file: named } : {}), note: `no heading "${anchor.heading}" in ${scope}` }
  }

  const find = async (quote: string) => {
    if (quoteWords(quote).length < 5) return undefined
    const more = named ? [] : (await search($, quote, root)).filter(file => !candidates.includes(file))
    for (const file of [...candidates, ...more]) {
      const text = await source(file)
      const line = text === undefined ? undefined : locate(quote, text)
      if (line !== undefined) return { file, line, quote: snippet(quote, 300) }
    }

    return undefined
  }
  const base = named ? { file: named } : {}
  const output = about.output ? { output: about.output } : {}
  const withOutput = about.output ? '; the last tool output is attached' : ''

  const { text: quote, isNew } = await about.clipboard()
  const count = quoteWords(quote).length
  const selected = await about.selection()
  if (count > 0 && (isNew || quoteWords(selected).length === 0)) {
    const found = await find(quote)
    if (found) return found
  }
  if (quoteWords(selected).length > 0) {
    return (await find(selected)) ?? { ...base, quote: snippet(selected, 300), isLoose: true, from: 'terminal' }
  }

  if (count === 0) {
    return about.output ? { ...base, ...output, note: 'with the last tool output' } : { ...base, note: 'no text on the clipboard' }
  }
  const scope = named ? relative(named, root) : `any .md file under ${root}`
  const why = count < 5 ? `copied text too short to find (${count} words)` : `copied text not found in ${scope}`

  return { ...base, quote: snippet(quote, 300), isLoose: true, from: 'clipboard', ...output, note: `${why}${withOutput}` }
}

// Stores what a message (or /queue TEXT) holds and says what was queued and where it
// points, or returns null when the text is no entry at all.
// How enqueue reports what it queued: a line in the transcript (a typed "+", whose prompt has
// long been answered by then), or nothing (a command, which answers with the text itself).
type Report = 'log' | 'none'

const enqueue = async (
  $: Engine,
  text: string,
  task: string | undefined,
  output: string | undefined,
  options: { images?: number; selection?: string; report?: Report } = {},
): Promise<string | null> => {
  const { images = 0, report = 'none' } = options
  const entries = capture(text)
  if (entries === null) {
    return null
  }
  const { root, queue } = await keys($)
  const seen = await read($, files)
  const now = await $.clock.now()
  const branch = await branchOf($, root)
  let clip: Promise<{ text: string; isNew: boolean }> | undefined
  let sel: Promise<string> | undefined
  const about: About = {
    clipboard: () =>
      (clip ??= clipboard($).then(text => {
        const isNew = text !== lastClipboard
        lastClipboard = text

        return { text, isNew }
      })),
    // Only a selection inside one transcript row: one in the prompt box or a pane is not
    // about Claude's output.
    selection: () => (sel ??= options.selection !== undefined ? Promise.resolve(options.selection) : readSelection($)),
    ...(output ? { output } : {}),
  }
  // An entry taken out with /queue edit comes back where it was, keeping what it pointed at,
  // unless the reworked text names a place of its own.
  const { editing: editKey } = await keys($)
  const editing = (await $.store.get(editKey)) as { index: number; idea: Idea } | undefined
  await $.store.delete(editKey)
  const isRework = editing !== undefined && entries.length === 1 && entries[0]!.kind === editing.idea.kind && Object.keys(entries[0]!.anchor).length === 0
  const cache = new Map<string, Promise<string | undefined>>()
  const source = (file: string) => {
    if (!cache.has(file)) cache.set(file, readFile($, file))

    return cache.get(file)!
  }

  const added: Idea[] = []
  const notes: string[] = []
  for (const entry of entries) {
    if (isRework) {
      const { text: _text, raw: _raw, ...kept } = editing!.idea
      added.push({ ...kept, text: entry.text, raw: entry.raw })
      continue
    }
    const { note, ...spot } = entry.kind === 'idea' ? ({} as Pin) : await pin($, entry, root, seen, about, source)
    if (note) notes.push(note)
    added.push({
      text: entry.text,
      raw: entry.raw,
      at: now,
      kind: entry.kind,
      ...spot,
      ...(task ? { task } : {}),
      ...(branch ? { branch } : {}),
    })
  }

  const all = await loadIdeas($, queue)
  all.splice(isRework ? Math.min(editing!.index, all.length) : all.length, 0, ...added)
  await saveIdeas($, queue, all)
  await refresh($)
  if (images > 0) notes.push('the image was not kept')
  const said = queuedOf(added, notes, root, all.length)
  if (report === 'log') $.ui.log(said)

  return said
}

// The text selected in one transcript row: one in the prompt box or a pane is not about
// Claude's output.
const readSelection = ($: Engine): Promise<string> =>
  $.ui.selection().then(one => (one?.requestId ? one.text.trim() : ''), () => '')

// Hands the queue and the new file tags over: as one planning prompt ('plan'), or as it
// is, to be done now ('send'). The prompt goes out from a timer, since a command's hook may
// not submit one; a prompt dropped beneath gives everything back.
const handOver = async ($: Engine, mode: 'plan' | 'send'): Promise<string> => {
  const { root, queue, taken, handed } = await keys($)
  const list = await loadIdeas($, queue)
  // Tags already handed over stay in their files until a step removes them; they are
  // not handed over again.
  const inFiles = await fileTags($, true)
  const all = [...list, ...inFiles]
  if (all.length === 0) {
    return 'The queue is empty. Start a message with "+" to add an idea, or "+?" to comment on a copied fragment.'
  }

  // The entries leave the queue as they are handed over; /queue undo brings them back.
  if (list.length > 0) {
    await saveIdeas($, taken, list)
    await saveIdeas($, queue, [])
  }
  const before = ((await $.store.get(handed)) as string[] | undefined) ?? []
  await $.store.set(handed, [...new Set([...before, ...inFiles.map(tagKey)])].slice(-500))
  await refresh($, 0)
  const giveBack = async (why: string) => {
    await saveIdeas($, queue, [...list, ...(await loadIdeas($, queue))])
    await $.store.set(handed, before)
    await refresh($, inFiles.length)
    $.ui.toast(`Could not hand the queue over (${why}); the entries are back in it`)
  }
  const { plan: planKey } = await keys($)
  const pending = (await loadPlan($, planKey)).steps.filter(step => !step.isDone)
  const text = mode === 'plan' ? planPrompt(all, root, pending) : sendPrompt(all, root)
  $.clock.after(50, async () => {
    try {
      const sent = await $.prompt.submit({ text, asUser: true })
      if ('drop' in sent && sent.drop !== undefined) await giveBack(sent.drop)
    } catch (error) {
      await giveBack(String(error))
    }
  })
  const plain = all.filter(idea => idea.kind === 'idea').length
  const parts = [plain ? ideasOf(plain) : '', all.length - plain ? commentsOf(all.length - plain) : ''].filter(Boolean)

  return `${mode === 'plan' ? 'Organizing' : 'Sending'} ${parts.join(' and ')}.`
}

const parseSteps = (value: unknown): Step[] | null => {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }
  const steps = value.map(one => {
    const step = one as { title?: unknown; prompt?: unknown }

    return typeof step.title === 'string' && typeof step.prompt === 'string' && step.prompt.trim() !== ''
      ? { title: step.title.trim() || 'Step', prompt: step.prompt.trim() }
      : null
  })

  return steps.every(step => step !== null) ? (steps as Step[]) : null
}

// What was queued and where it points, said once as a toast and kept as the line the
// dropped prompt leaves in the transcript.
const queuedOf = (ideas: readonly Idea[], notes: readonly string[], root: string, waiting: number) => {
  const why = notes.length > 0 ? ` - ${[...new Set(notes)].join('; ')}` : ''
  if (ideas.length > 1) {
    return `queued ${ideas.length} entries${why} (${waiting} waiting)`
  }
  const idea = ideas[0]!
  if (idea.kind === 'idea') {
    return `queued "${snippet(idea.text)}" (${waiting} waiting)`
  }
  const at = where(idea, root)
  const quote = idea.quote ? ` "${snippet(idea.quote, 30)}"` : ''
  const spot = at || quote ? `${at}${quote}`.trimStart() : `"${snippet(idea.text, 30)}"`

  return `queued ${KINDS[idea.kind].mark} ${spot}${why} (${waiting} waiting)`
}

// Lets go of the step `index` that never started (its prompt was dropped or refused),
// unless something else took its place meanwhile.
const release = async ($: Engine, index: number, why: string) => {
  const { plan: planKey } = await keys($)
  const plan = await loadPlan($, planKey)
  if (plan.active?.step === index && plan.active.turnId === undefined) {
    delete plan.active
    await savePlan($, planKey, plan)
    await refresh($)
  }
  $.ui.toast(`Could not send step ${index + 1} of the plan: ${why}`)
}

// Runs step `index` of the plan. The prompt goes out from a timer, since neither a
// command's hook nor a turn's end may submit one while it holds the turn; a stop that
// lands before then keeps it from going out at all.
const start = async ($: Engine, index: number, isChain: boolean) => {
  const { plan: planKey } = await keys($)
  const plan = await loadPlan($, planKey)
  const step = plan.steps[index]!
  plan.active = { step: index, isChain, sessionId: await $.session.id() }
  await savePlan($, planKey, plan)
  await refresh($)
  $.clock.after(50, async () => {
    const now = await loadPlan($, planKey)
    if (now.active?.step !== index || now.active.turnId !== undefined) {
      return
    }
    try {
      const sent = await $.prompt.submit({ text: stepPrompt(step, index + 1, plan.steps.length), asUser: true })
      if ('drop' in sent && sent.drop !== undefined) await release($, index, sent.drop)
    } catch (error) {
      await release($, index, String(error))
    }
  })
}

// Stops the plan: a step that has not started yet does not start; a running one finishes
// and is the last. A step another session left behind is let go here.
const stopPlan = async ($: Engine): Promise<string> => {
  const { plan: planKey } = await keys($)
  const plan = await loadPlan($, planKey)
  const active = plan.active
  if (!active) {
    return 'Nothing is running.'
  }
  const n = active.step + 1
  let text: string
  if (active.turnId === undefined || active.sessionId !== (await $.session.id())) {
    delete plan.active
    text = `The plan stopped before step ${n}.`
  } else {
    active.isChain = false
    text = `The plan stops after step ${n}.`
  }
  await savePlan($, planKey, plan)
  await refresh($)

  return text
}

export const register: Register = (on, options) => {
  // What happens to the queue when Claude finishes a turn: wait for /queue (the default),
  // or hand it over at once as a plan or as it is.
  const whenTurnEnds = options.whenTurnEnds === 'plan' || options.whenTurnEnds === 'send' ? options.whenTurnEnds : 'wait'
  // Module variables start over on a reload; nothing in them has to last.
  let lastTask: string | undefined
  let nudged = 0
  // The main loop's current (or last) turn, whether it was the plugin's own, and the last
  // tool output in it: an error stays over a later success of the same turn.
  let turn: string | undefined
  let isOwnTurn = false
  // Whether a main-loop turn is in flight: only an entry queued then was made "while Claude
  // worked on" the last prompt; one queued at an idle prompt names no task. A typed "+" knows
  // it from its own turnId; /queue TEXT, which carries none, asks this.
  let isRunning = false
  const taskNow = () => (isRunning ? lastTask : undefined)
  // The last message queued, until the box it went back into has been emptied.
  let justQueued: string | undefined
  // Typed entries are stored one after another, so two quick ones never overwrite each other.
  let storing: Promise<unknown> = Promise.resolve()
  let output: { text: string; turnId: string | undefined; isError: boolean } | undefined
  const outputNow = () => (output && output.turnId === turn ? output.text : undefined)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'queue',
      description: 'Show the ideas and comments queued with "+"; plan and run them',
      argumentHint: '[plan | run [N | all] | stop | TEXT | pop [N] | edit N | move N M | remove N | clear | undo | scan FILE | help]',
      // Runs at once mid-turn, so a stop lands before the next step; the prompts it sends
      // still wait for the turn to end.
      immediate: true,
    })
    await $.tool.register({
      name: 'plan',
      description:
        "Saves the step plan you just proposed for the user's queue (the idea-queue plugin), so the user can run it with /queue run. " +
        'Call it only when the idea-queue plugin asked you to organize the queue. Each step: a short title and a prompt that stands on its own.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, prompt: { type: 'string' } },
              required: ['title', 'prompt'],
            },
          },
        },
        required: ['steps'],
      },
      isDeferred: false,
    })
    await refresh($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    // Only what a command or an edit printed, failed or not: a denied call, a missing file
    // on Read or a refused web fetch is not what a comment is about.
    const isError = ran.isError === true
    if (e.agentId === undefined && ran.deny === undefined && OUTPUT_TOOLS.has(e.tool)) {
      const keepsError = output?.isError === true && output.turnId === turn && !isError
      if (!keepsError) {
        const result = ran.deny === undefined ? ran.result : undefined
        const text = ran.deny ?? ran.text ?? (typeof result === 'string' ? result : JSON.stringify(result ?? ''))
        output = { text: `${e.tool}${isError ? ' failed' : ''}: ${snippet(text, 400)}`, turnId: turn, isError }
      }
    }

    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError && MARKDOWN.test(e.file_path)) {
      await update($, files, list => [...list.filter(file => file !== e.file_path), e.file_path].slice(-100))
    }

    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError && MARKDOWN.test(e.file_path)) {
      await update($, files, list => [...list.filter(file => file !== e.file_path), e.file_path].slice(-100))
    }

    return ran
  })

  // A RegExp matcher: the laid types know only the tools connected when they were written.
  on('tool.call', { tool: /^mcp__idea-queue__plan$/ }, async ($, e) => {
    const steps = parseSteps((e as unknown as { steps?: unknown }).steps)
    if (steps === null) {
      return { deny: 'steps must be a non-empty list of { title, prompt }, each prompt non-empty' }
    }
    const { plan: planKey } = await keys($)
    const old = await loadPlan($, planKey)
    if (old.active && old.active.sessionId === (await $.session.id())) {
      return { deny: `step ${old.active.step + 1} of the current plan is running; the user stops it with /queue stop first` }
    }
    await savePlan($, planKey, { steps })
    await refresh($)

    return {
      result: `Saved ${steps.length} steps. Tell the user: /queue run runs them all in order, /queue run N runs one, /queue shows them.`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const isTyped = e.origin.kind === 'composer' && e.command === undefined
    const entries = isTyped ? capture(e.text) : null
    if (entries === null) {
      if (isTyped && e.text.trim() !== '') lastTask = snippet(e.text, 200)
      void refresh($)

      return next(e)
    }

    // Answered at once, as Enter on a plain prompt is: the slow part (the clipboard, the
    // search, the store) runs right after, one message at a time, and says in a transcript
    // line where each entry points. Only the selection is read now, before it goes away.
    const text = e.text
    const task = e.turnId !== undefined ? lastTask : undefined
    const output = outputNow()
    const images = e.attachments?.length ?? 0
    const isComment = entries.some(entry => entry.kind !== 'idea' && Object.keys(entry.anchor).length === 0)
    const selection = isComment ? await readSelection($) : ''
    $.clock.after(1, () => {
      storing = storing
        .then(() => enqueue($, text, task, output, { images, selection, report: 'log' }))
        .catch(error => $.ui.log(`queue: could not store "${snippet(text, 40)}": ${String(error)}`))
    })

    // A dropped prompt goes back into the box; once queued it should not wait there to be
    // deleted by hand. The engine's put-back raises prompt.change, which empties the box at
    // once; the timer is the fallback. Either empties it only while it still holds exactly
    // that message, so a new draft typed meanwhile is left alone.
    const typed = e.text.trim()
    justQueued = typed
    $.clock.after(30, async () => {
      const box = await $.prompt.read().catch(() => undefined)
      if (box && box.text.trim() === typed) await $.prompt.fill({ text: '', mode: 'replace' }).catch(() => undefined)
    })

    return { drop: 'queued' }
  }).catch(($, e, next) =>
    // A queued entry that failed to store is dropped, not sent: it was meant to wait.
    next.called || !(e.origin.kind === 'composer' && e.command === undefined && capture(e.text))
      ? next(e)
      : { drop: 'queue: could not store this entry; nothing was sent' },
  )

  // Tab completion after "/queue ": the subcommands, then the entry or step numbers.
  on('prompt.autocomplete', async ($, e, next) => {
    const typed = e.text.slice(0, e.cursor)
    const first = /^\/queue\s+(\S*)$/.exec(typed)
    const second = /^\/queue\s+(pop|edit|remove|rm|run|move|mv)\s+(\d*)$/.exec(typed)
    if (!first && !second) {
      return next(e)
    }
    const own = (await next(e)).suggestions
    if (first) {
      const word = first[1]!.toLowerCase()
      const rows = SUBCOMMANDS.filter(([name]) => name.startsWith(word) && name !== word).map(([text, description]) => ({ text, description }))

      return { suggestions: [...own, ...rows] }
    }
    const [, verb, digits] = second!
    const { root, queue, plan: planKey } = await keys($)
    const items =
      verb === 'run'
        ? (await loadPlan($, planKey)).steps.map((step, i) => ({ n: i + 1, label: step.title, isDone: step.isDone === true }))
        : (await loadIdeas($, queue)).map((idea, i) => ({ n: i + 1, label: listed([idea], root).replace(/^\d+\. /, ''), isDone: false }))
    const rows = items
      .filter(item => !item.isDone && String(item.n).startsWith(digits!))
      .map(item => ({ text: String(item.n), description: snippet(item.label, 60) }))

    return { suggestions: [...own, ...rows] }
  })

  on('prompt.change', async ($, e, next) => {
    if (justQueued !== undefined && e.origin.kind === 'engine' && e.text.trim() === justQueued) {
      justQueued = undefined
      await $.prompt.fill({ text: '', mode: 'replace' }).catch(() => undefined)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turn = e.turnId
      isRunning = true
      isOwnTurn = e.text.includes(OWN) || e.text.includes('Composed by the idea-queue plugin')
    }
    if (e.agentId === undefined && e.text.includes(OWN)) {
      // The turn of a plan step: remember which, so its end runs the next one.
      const { plan: planKey } = await keys($)
      const plan = await loadPlan($, planKey)
      if (plan.active && plan.active.turnId === undefined && plan.active.sessionId === (await $.session.id())) {
        plan.active.turnId = e.turnId
        await savePlan($, planKey, plan)
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) {
      return done
    }
    isRunning = false

    const { plan: planKey } = await keys($)
    const plan = await loadPlan($, planKey)
    const active = plan.active
    if (active && active.turnId === e.turnId && active.sessionId === (await $.session.id())) {
      delete plan.active
      if (e.reason === 'answer') {
        plan.steps[active.step]!.isDone = true
        const after = plan.steps.findIndex((step, i) => i > active.step && !step.isDone)
        await savePlan($, planKey, plan)
        if (active.isChain && after >= 0) {
          await start($, after, true)
        } else {
          $.ui.toast(active.isChain ? 'Plan done' : `Step ${active.step + 1} done`)
        }
      } else {
        await savePlan($, planKey, plan)
        $.ui.toast(`Plan stopped: step ${active.step + 1} ${e.reason === 'aborted' ? 'was interrupted' : 'did not finish'}`)
      }
      await refresh($)

      return done
    }

    // Files the agents wrote may hold new tags; then the queue goes out by itself when the
    // setting says so (never after the plugin's own turn), or a nudge when more waits.
    const now = await refresh($, (await fileTags($, true)).length)
    const waiting = now.ideas + now.comments + now.tags
    // A saved plan with steps still to do is the person's to run first: nudge instead.
    const isPending = plan.steps.some(step => !step.isDone)
    if (!active && waiting > 0 && whenTurnEnds !== 'wait' && e.reason === 'answer' && !isOwnTurn && !isPending) {
      $.ui.toast(await handOver($, whenTurnEnds))
      nudged = 0

      return done
    }
    if (!active && waiting > nudged) {
      $.ui.toast(`Waiting in the queue: ${waiting} · /queue plan or /queue run`)
    }
    nudged = waiting

    return done
  })

  on('command.run', { command: 'queue' }, async ($, e) => {
    const { root, queue, taken, plan: planKey, handed, editing } = await keys($)
    const list = await loadIdeas($, queue)
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    // A command only when the words after it have its exact shape; anything else is text to
    // queue, so "/queue send a summary to the team" queues that sentence.
    const isInt = (one: string | undefined) => one !== undefined && /^\d+$/.test(one)
    const SHAPES: Record<string, (args: readonly string[]) => boolean> = {
      help: args => args.length === 0,
      list: args => args.length === 0,
      ls: args => args.length === 0,
      pop: args => args.length === 0 || (args.length === 1 && isInt(args[0])),
      clear: args => args.length === 0,
      undo: args => args.length === 0,
      plan: args => args.length === 0,
      stop: args => args.length === 0,
      edit: args => args.length === 1 && isInt(args[0]),
      remove: args => args.length === 1 && isInt(args[0]),
      rm: args => args.length === 1 && isInt(args[0]),
      move: args => args.length === 2 && isInt(args[0]) && isInt(args[1]),
      mv: args => args.length === 2 && isInt(args[0]) && isInt(args[1]),
      run: args => args.length === 0 || (args.length === 1 && (isInt(args[0]) || args[0] === 'all')),
      scan: args => args.length === 1 && MARKDOWN.test(args[0]!),
    }
    const shape = SHAPES[verb.toLowerCase()]
    const word = verb === '' || shape?.(rest.filter(Boolean)) ? verb.toLowerCase() : '+text'

    if (word === 'help') {
      return { text: HELP }
    }

    if (word === '' || word === 'list' || word === 'ls') {
      const plan = await loadPlan($, planKey)
      const steps = plan.steps.map((step, i) => {
        const state = plan.active?.step === i ? 'running' : step.isDone ? 'done' : 'todo'

        return `${i + 1}. [${state}] ${step.title}`
      })
      const planned = plan.steps.some(step => !step.isDone) ? `\n\nPlan (/queue run):\n${steps.join('\n')}` : ''
      const fresh = new Set((await fileTags($, true)).map(tagKey))
      const inFiles = await fileTags($)
      const own = list.length === 0 ? 'The queue is empty.' : listed(list, root)
      const shown = inFiles.map(tag => listed([tag], root).replace(/^\d+\. /, fresh.has(tagKey(tag)) ? '- ' : '- (handed over) '))
      const tagged = inFiles.length === 0 ? '' : `\n\nTags in files:\n${shown.join('\n')}`

      return { text: `${own}${tagged}${planned}` }
    }

    if (word === 'edit') {
      const n = Number(rest[0])
      if (list.length === 0) {
        return { text: 'The queue is empty.' }
      }
      if (!Number.isInteger(n) || n < 1 || n > list.length) {
        return { text: `Give a number from 1 to ${list.length}, as /queue list shows them.` }
      }
      const entry = list[n - 1]!
      const filled = await $.prompt.fill({ text: entry.raw ?? `+ ${entry.text}`, mode: 'insert' })
      if (!filled.isFilled) {
        return { text: 'The prompt box cannot take it now; the entry stays in the queue.' }
      }
      list.splice(n - 1, 1)
      await saveIdeas($, queue, list)
      await $.store.set(editing, { index: n - 1, idea: entry })
      await refresh($)

      return { text: `Entry ${n} is in the prompt box: change it and press Enter; it goes back to place ${n}, still pointing where it did.` }
    }

    if (word === 'move' || word === 'mv') {
      const [from, to] = [Number(rest[0]), Number(rest[1])]
      const isPlace = (n: number) => Number.isInteger(n) && n >= 1 && n <= list.length
      if (list.length < 2 || !isPlace(from) || !isPlace(to)) {
        return { text: list.length < 2 ? 'Nothing to move.' : `Give two places from 1 to ${list.length}: /queue move 3 1` }
      }
      const [entry] = list.splice(from - 1, 1)
      list.splice(to - 1, 0, entry!)
      await saveIdeas($, queue, list)

      return { text: listed(list, root) }
    }

    if (word === 'pop') {
      // The last entry, or entry N: taken out of the queue into the box, ready to send.
      if (list.length === 0) {
        return { text: 'The queue is empty.' }
      }
      const n = rest[0] === undefined ? list.length : Number(rest[0])
      if (n < 1 || n > list.length) {
        return { text: `Give a number from 1 to ${list.length}, as /queue shows them.` }
      }
      const last = list[n - 1]!
      // Ready to send: no "+" in front, a comment with what it is about.
      const filled = await $.prompt.fill({ text: popText(last, root), mode: 'insert' })
      if (!filled.isFilled) {
        return { text: 'The prompt box cannot take it now; the entry stays in the queue.' }
      }
      list.splice(n - 1, 1)
      await saveIdeas($, queue, list)
      await refresh($)

      return { text: `In the prompt box, ready to send: ${snippet(last.text, 60)}` }
    }

    if (word === 'clear') {
      if (list.length === 0) {
        return { text: 'The queue is already empty.' }
      }
      await saveIdeas($, taken, list)
      await saveIdeas($, queue, [])
      await refresh($)

      return { text: `Cleared ${list.length} entries. /queue undo brings them back.` }
    }

    if (word === 'remove' || word === 'rm') {
      if (list.length === 0) {
        return { text: 'The queue is empty.' }
      }
      const n = Number(rest[0])
      if (!Number.isInteger(n) || n < 1 || n > list.length) {
        return { text: `Give a number from 1 to ${list.length}, as /queue list shows them.` }
      }
      const [gone] = list.splice(n - 1, 1)
      await saveIdeas($, queue, list)
      await refresh($)

      return { text: `Removed: ${gone!.text}` }
    }

    if (word === 'undo') {
      const running = (await loadPlan($, planKey)).active
      if (running && running.sessionId === (await $.session.id())) {
        return { text: `Step ${running.step + 1} of the plan is running; /queue stop first, so nothing is done twice.` }
      }
      const back = await loadIdeas($, taken)
      if (back.length === 0) {
        return { text: 'Nothing to bring back.' }
      }
      await saveIdeas($, queue, [...back, ...list])
      await saveIdeas($, taken, [])
      const now = await refresh($)

      return { text: `Brought back ${back.length} entries, ${now.ideas + now.comments} waiting.` }
    }

    if (word === 'scan') {
      const name = rest.join(' ')
      if (name === '') {
        return { text: 'Name a file: /queue scan docs/report.md' }
      }
      const file = await resolve($, name, root, await read($, files))
      const source = await readFile($, file)
      if (source === undefined) {
        return { text: `Cannot read ${name}.` }
      }
      await update($, files, seen => [...seen.filter(one => one !== file), file].slice(-100))
      const found = tags(source).length
      await refresh($, (await fileTags($, true)).length)

      return { text: `${relative(file, root)}: ${found === 1 ? '1 tag' : `${found} tags`}; /queue includes the file from now on.` }
    }

    if (word === 'plan') {
      return { text: await handOver($, 'plan') }
    }

    if (word === 'run') {
      if (rest[0] === 'all') {
        return { text: await handOver($, 'send') }
      }
      const plan = await loadPlan($, planKey)
      const isMine = plan.active?.sessionId === (await $.session.id())
      if (plan.active && isMine) {
        return { text: `Step ${plan.active.step + 1} is running. /queue stop stops after it.` }
      }
      const note = plan.active ? ` (another session had step ${plan.active.step + 1} running; this one takes over)` : ''
      const first = plan.steps.findIndex(step => !step.isDone)
      if (rest[0] !== undefined) {
        const n = Number(rest[0])
        if (plan.steps.length === 0 || n < 1 || n > plan.steps.length) {
          return { text: plan.steps.length === 0 ? 'No plan: /queue run runs the queue entry by entry.' : `Give a step from 1 to ${plan.steps.length}, as /queue shows them.` }
        }
        await start($, n - 1, false)

        return { text: `Running step ${n}: ${plan.steps[n - 1]!.title}${note}` }
      }
      if (first >= 0) {
        await start($, first, true)
        const left = plan.steps.filter(step => !step.isDone).length

        return { text: `Running the plan: ${left === 1 ? '1 step' : `${left} steps`}, from step ${first + 1}. /queue stop stops after the current one.${note}` }
      }

      // No plan to run: every entry becomes a step of its own.
      const inFiles = await fileTags($, true)
      const all = [...list, ...inFiles]
      if (all.length === 0) {
        return { text: 'Nothing to run: the queue is empty and the plan is done.' }
      }
      const steps = all.map(idea => ({ title: snippet(idea.text || where(idea, root) || KINDS[idea.kind].label, 50), prompt: entryPrompt(idea, root) }))
      if (list.length > 0) {
        await saveIdeas($, taken, list)
        await saveIdeas($, queue, [])
      }
      const before = ((await $.store.get(handed)) as string[] | undefined) ?? []
      await $.store.set(handed, [...new Set([...before, ...inFiles.map(tagKey)])].slice(-500))
      await savePlan($, planKey, { steps })
      await refresh($, 0)
      await start($, 0, true)

      return { text: `Running ${steps.length === 1 ? '1 entry' : `${steps.length} entries`} one by one. /queue stop stops after the current one.${note}` }
    }

    if (word === 'stop') {
      return { text: await stopPlan($) }
    }

    // Anything else is an entry to queue: "/queue add tests" as "+ add tests" would.
    if (word === '+text') {
      const text = e.args.trim()
      const said = await enqueue($, text.startsWith('+') ? text : `+ ${text}`, taskNow(), outputNow(), { report: 'none' })

      return { text: said ?? HELP }
    }

    return { text: HELP }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, band)
    const waiting = now.ideas + now.comments + now.tags
    const left = now.steps - now.done
    if (e.props.hasSurvey || (waiting === 0 && left === 0 && now.running === undefined)) {
      return next(e)
    }

    const parts: string[] = []
    if (now.running !== undefined) parts.push(`step ${now.running}/${now.steps} running`)
    else if (left > 0) parts.push(`plan: ${left} of ${now.steps} steps left`)
    if (now.ideas) parts.push(ideasOf(now.ideas))
    if (now.comments + now.tags) parts.push(commentsOf(now.comments + now.tags))
    const action = now.running !== undefined ? 'stop' : waiting > 0 ? 'organize' : 'run plan'
    // A stop is applied here and now: $.command.run would wait for the turn to end.
    const press = async () => {
      if (action === 'stop') $.ui.toast(await stopPlan($))
      else await $.command.run({ command: 'queue', args: action === 'run plan' ? 'run' : 'plan' })
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>queue: {parts.join(', ')} · </Text>
        <Button key="queue" label={action} onPress={() => void press()} />
      </Box>
    )
  })
}
