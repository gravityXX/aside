// /aside itself: the table of its commands, the one switch that calls them, the help and the
// Tab hints. The table holds data only, since `$` may not be passed to a method call (3.2), and
// the help and the hints are built from it, so neither can drift from what runs.

import type { CatchHandler, Hook, MatchedHook } from 'claude-code'

import { currentOutput, currentTask } from '../context'
import type { Context } from '../context'
import { KINDS } from '../core/entries'
import { MARKDOWN_PATH } from '../core/markdown'
import { describeFailure, formatCount, shortenText } from '../core/text'
import { readQueue } from '../io/queue'
import { loadPlan, projectKeys, refreshBand } from '../io/store'
import { GLOBAL, countQueues, isHiddenHere, isLocalQueue, loadIdeas, queueName, resolveQueue } from '../io/queues'
import type { Kit } from '../kit'
import { addEntries } from './capture'
import { findEntries } from './find'
import { showLog } from './history'
import { importFile } from './importing'
import { handOverQueue, runChosen, runEntries, runNext, runPlan, stopPlan } from './plan'
import { nameOldSteps } from './planner'
import { registerPlanTool, registerWaitTool } from './plantool'
import { runGlobal, runNamed } from './global'
import { clearQueue, editEntry, exportListing, moveEntry, popEntry, removeEntries, restoreTaken, scanFile, showHelp, showListing } from './queue'

type Name = 'list' | 'plan' | 'run' | 'continue' | 'stop' | 'log' | 'pop' | 'edit' | 'move' | 'remove' | 'clear' | 'undo' | 'find' | 'import' | 'scan' | 'export' | 'g' | 'q' | 'help'

// A command's row: what it accepts and how help and Tab show it. runCommand does the work.
type Command = {
  name: Name
  aliases?: readonly string[]
  // Whether the words after the name have this command's shape. Anything else is text to
  // queue, so "/aside send a summary to the team" queues that sentence.
  takes: (args: readonly string[]) => boolean
  // How the command is written in the argument hint, and the lines /aside help gives it.
  usage?: string
  help: readonly string[]
  // What Tab shows beside the name, and the numbers it offers after it: entries, or what
  // /aside run counts (the steps while the plan has steps to do, else the entries).
  about: string
  completes?: 'entries' | 'run'
}

const isNumber = (word: string | undefined) => word !== undefined && /^\d+$/.test(word)
const none = (args: readonly string[]) => args.length === 0
const oneNumber = (args: readonly string[]) => args.length === 1 && isNumber(args[0])

const COMMANDS: readonly Command[] = [
  {
    name: 'list',
    aliases: ['ls'],
    takes: none,
    help: ['/aside - show the queue and the plan'],
    about: 'show the queue and the plan',
  },
  {
    name: 'plan',
    takes: none,
    usage: 'plan',
    help: ['/aside plan - have Claude organize the queue into steps (related entries merged); while a step runs, the new steps go after the plan\'s own'],
    about: 'organize the queue into steps',
  },
  {
    name: 'run',
    takes: args => none(args) || (args.length === 1 && args[0] === 'all') || args.every(isNumber),
    usage: 'run [N ... | all]',
    help: [
      '/aside run - run the next step of the plan; with no step left, the first entry of the queue; a step that waits for you ends and its run goes on, as with /aside continue',
      '/aside run all - run the rest of the plan step by step; with no step left, each entry as its own step',
      '/aside run N [M ...] - run those steps of the plan, or those entries once no step is left to do',
    ],
    about: 'run the next step or entry, or all of them one by one',
    completes: 'run',
  },
  {
    name: 'continue',
    takes: none,
    help: ['/aside continue - end the step that waits for your answer without one and go on, or go on with a paused run, as /aside run all does'],
    about: 'go on with the plan',
  },
  {
    name: 'stop',
    takes: none,
    usage: 'stop',
    help: ['/aside stop - stop after the current step'],
    about: 'stop after the current step',
  },
  {
    name: 'log',
    takes: args => none(args) || oneNumber(args),
    usage: 'log [N]',
    help: ['/aside log [N] - the plans run to their end, the last 5 with what each step did, or plan N of them'],
    about: 'the plans run to their end',
  },
  {
    name: 'pop',
    takes: args => none(args) || oneNumber(args),
    usage: 'pop [N]',
    help: ['/aside pop [N] - put the first entry (or entry N) in the prompt box, ready to send'],
    about: 'put an entry in the box, ready to send',
    completes: 'entries',
  },
  {
    name: 'edit',
    takes: oneNumber,
    usage: 'edit N',
    help: ['/aside edit N - put entry N in the prompt box to rework it and queue it again'],
    about: 'rework an entry and queue it again',
    completes: 'entries',
  },
  {
    name: 'move',
    aliases: ['mv'],
    takes: args => args.length === 2 && isNumber(args[0]) && isNumber(args[1]),
    usage: 'move N M',
    help: ['/aside move N M - move entry N to place M'],
    about: 'move an entry to another place',
    completes: 'entries',
  },
  {
    name: 'remove',
    aliases: ['rm'],
    takes: args => args.length > 0 && args.every(isNumber),
    usage: 'remove N [M ...]',
    help: ['/aside remove N [M ...] - remove entry N, or several at once'],
    about: 'remove entries',
    completes: 'entries',
  },
  {
    name: 'clear',
    takes: none,
    usage: 'clear',
    help: ['/aside clear - empty the queue'],
    about: 'empty the queue',
  },
  {
    name: 'undo',
    takes: none,
    usage: 'undo',
    help: ['/aside undo - bring back what the last clear, or an unanswered plan or run, took'],
    about: 'bring back what the last clear, or an unanswered plan or run, took',
  },
  {
    name: 'find',
    takes: args => args.length > 0,
    usage: 'find TEXT',
    help: ['/aside find TEXT - the entries, tags, steps and ideas of every queue that hold all the words, in any case and with or without accents, each with its number'],
    about: 'look for words in every queue and the plan',
  },
  {
    name: 'import',
    // A file name with spaces is one name, as for /aside scan.
    takes: args => args.length > 0 && MARKDOWN_PATH.test(args.join(' ')),
    usage: 'import FILE',
    help: ['/aside import FILE - queue the items of a markdown list in FILE, each an entry, leaving out ticked ones and those already queued; the file stays as it is'],
    about: 'queue the items of a markdown list',
  },
  {
    name: 'scan',
    // A file name with spaces is one name: the words are taken together.
    takes: args => args.length > 0 && MARKDOWN_PATH.test(args.join(' ')),
    usage: 'scan FILE',
    help: ['/aside scan FILE - read the tags of a file Claude did not write in this session'],
    about: 'read the tags of a markdown file',
  },
  {
    name: 'export',
    // One word: "/aside export the notes to report.md" is an idea, not a file to write.
    takes: args => args.length === 0 || (args.length === 1 && MARKDOWN_PATH.test(args[0]!)),
    usage: 'export [FILE]',
    help: ['/aside export [FILE] - save what /aside shows to aside.md, or to FILE (one word, ending in .md), as Markdown'],
    about: 'save the list to a markdown file',
  },
  {
    name: 'g',
    // Anything after it: a command on the global list, or an idea for it.
    takes: () => true,
    usage: 'g [TEXT | here N ... | add N ... | remove N ... | edit N | pop [N] | move N M | clear | undo | import FILE]',
    help: [
      '/aside g - show the global list: ideas that belong to no project',
      '/aside g TEXT - put TEXT on the global list, as "+g TEXT" would',
      '/aside g here N [M ...] - move ideas N of the global list to the end of this queue',
      '/aside g add N [M ...] - move ideas N of this queue (numbers as /aside shows them) to the global list',
      '/aside g remove N [M ...] | edit N | pop [N] | move N M | clear | undo | import FILE - the same as for the queue, on the global list',
    ],
    about: 'the global list: ideas for no project',
  },
  {
    name: 'q',
    // Anything after it: the queues for no project, a command on one of them, or an idea for it.
    takes: () => true,
    usage: 'q [NAME [TEXT | here N ... | add N ... | remove N ... | edit N | pop [N] | move N M | clear | undo | import FILE | rename NEW | local | global]]',
    help: [
      '/aside q - show the named queues, for every project or for this one alone, and the global list among them',
      '/aside q NAME [TEXT] - show the queue NAME, or put TEXT in it, as "+@NAME TEXT" would; the commands of /aside g work on it too',
      '/aside q NAME clear | undo | rename NEW - empty it, bring back what its last clear took, or move it all to the queue NEW',
      "/aside q NAME local | global - keep the queue for this project alone, which then hides one of its name for every project here, or share it with every project",
    ],
    about: 'the named queues: for every project or for this one',
  },
  {
    name: 'help',
    takes: none,
    usage: 'help',
    help: [],
    about: 'show every command',
  },
]

const TEXT_HELP = '/aside TEXT - queue TEXT, as "+ TEXT" would ("/aside + run 3" for text that looks like a command)'

const HELP = [
  'Queue an idea: start a message with "+". When every line starts with "+", each line is its own entry.',
  'Already typed it? End the message with the mark after a space ("... +", "... +?", "... +g", "... +@work") and it is queued whole.',
  'Beside this queue: "+g idea" goes to the global list, "+@work idea" to the queue named work, made by its first idea for every project, or for this one with newQueues on local.',
  'Comment on what the agents wrote: copy a fragment in the preview, then type',
  '  +? question   +! change   +- drop   ++ dig deeper',
  '  pin it yourself with @file, @file:42, @file#heading or #heading after the mark.',
  'In the editor, <!-- ? ... --> tags (? ! - +) in a markdown file count as comments too.',
  "With nothing new copied, a comment takes the text selected in Claude's reply, or the last tool output.",
  '',
  ...COMMANDS.flatMap(command => command.help),
  TEXT_HELP,
].join('\n')

const ARGUMENT_HINT = `[${[...COMMANDS.flatMap(command => command.usage ?? []), 'TEXT'].join(' | ')}]`

const commandNamed = (word: string) => COMMANDS.find(command => command.name === word || command.aliases?.includes(word))

async function runQueue($: Kit, ctx: Context, args: readonly string[]) {
  if (args[0] === 'all') {
    return (await runPlan($, ctx)) ?? runEntries($, ctx)
  }
  if (args.length > 0) {
    return runChosen($, ctx, args.map(Number))
  }

  return runNext($, ctx)
}

async function runCommand($: Kit, ctx: Context, name: Name, args: readonly string[]): Promise<string> {
  const [first, second] = args
  switch (name) {
    case 'list':
      await nameOldSteps($, ctx)
      return showListing($, ctx)
    case 'plan':
      return handOverQueue($, ctx)
    case 'run':
      return runQueue($, ctx, args)
    case 'continue':
      return runQueue($, ctx, ['all'])
    case 'stop':
      return stopPlan($, ctx)
    case 'log':
      return showLog($, ctx, first === undefined ? undefined : Number(first))
    case 'pop':
      return popEntry($, ctx, first === undefined ? undefined : Number(first))
    case 'edit':
      return editEntry($, ctx, Number(first))
    case 'move':
      return moveEntry($, ctx, Number(first), Number(second))
    case 'remove':
      return removeEntries($, ctx, args.map(Number))
    case 'clear':
      return clearQueue($)
    case 'undo':
      return restoreTaken($)
    case 'find':
      return findEntries($, ctx, args.join(' '))
    case 'import':
      return importFile($, args.join(' '))
    case 'scan':
      return scanFile($, args.join(' '))
    case 'export':
      return exportListing($, ctx, args.join(' '))
    case 'g':
      return runGlobal($, ctx, args)
    case 'q':
      return runNamed($, ctx, args)
    case 'help':
      return showHelp($, ctx, HELP)
  }
}

// Anything that is not a command is an entry to queue: "/aside add tests" as "+ add tests" would.
async function queueText($: Kit, ctx: Context, text: string) {
  return (await addEntries($, ctx, text.startsWith('+') ? text : `+ ${text}`, currentTask(ctx), currentOutput(ctx), { report: 'none' })) ?? HELP
}

type AsideEvent = Parameters<MatchedHook<'command.run', { readonly command: 'aside' }>>[1]

export async function runAside(ctx: Context, $: Kit, e: AsideEvent) {
  const [word = '', ...args] = e.args.trim().split(/\s+/)
  if (word === '') {
    // A step an earlier release titled with its text cut short gets a name, shown next time.
    await nameOldSteps($, ctx)
    return { text: await showListing($, ctx) }
  }
  const command = commandNamed(word.toLowerCase())

  return { text: command?.takes(args) ? await runCommand($, ctx, command.name, args) : await queueText($, ctx, e.args.trim()) }
}

// A /aside that failed says so in a sentence of its own, not in the engine's words; what it
// had done stays, and /aside shows it.
type AsideFailed = Parameters<CatchHandler<MatchedHook<'command.run', { readonly command: 'aside' }>>>

// It takes the failure alone, not `next`: it never passes the run on, and a hook on a command
// that holds `next` is one the plugin directory reads as able to change the command.
export function asideFailed($: Kit, e: AsideFailed[1], error: AsideFailed[2]['error']) {
  const typed = e.args.trim() === '' ? '/aside' : `/aside ${shortenText(e.args.trim(), 40)}`

  return { text: `${typed} did not finish (${describeFailure(error)}). /aside shows where the queue and the plan stand.` }
}

// The numbers Tab offers after a command: the entries as /aside shows them, or for /aside run
// while the plan has steps to do, the steps still to do.
async function numberRows($: Kit, ctx: Context, of: 'entries' | 'ideas' | 'run' | { queue: string }, digits: string) {
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  const isSteps = of === 'run' && plan.steps.some(step => !step.isDone)
  const listed = typeof of === 'object' ? await loadIdeas($, of.queue) : []
  const items =
    typeof of === 'object'
      ? (ctx.settings.order === 'newest' ? listed.reverse() : listed).map((idea, i) => ({ n: i + 1, label: idea.entry.text, isDone: false }))
      : isSteps
      ? plan.steps.map((step, i) => ({ n: i + 1, label: step.title, isDone: step.isDone === true }))
      : (await readQueue($, ctx.settings.order))
          .map((entry, i) => ({ n: i + 1, label: entry.kind === 'idea' ? entry.text : `${KINDS[entry.kind].label}: ${entry.text}`, isDone: false, isIdea: entry.kind === 'idea' }))
          .filter(item => of !== 'ideas' || item.isIdea)

  return items
    .filter(item => !item.isDone && String(item.n).startsWith(digits))
    .map(item => ({ text: String(item.n), description: shortenText(item.label, 60) }))
}

// Tab after "/aside ": the commands, then the entry or step numbers.
type Autocomplete = Parameters<Hook<'prompt.autocomplete'>>

// What Tab offers after "/aside g ": the commands on the global list.
const GLOBAL_VERBS = [
  { text: 'here', description: 'move global ideas into this queue' },
  { text: 'add', description: 'move ideas of this queue to the global list' },
  { text: 'remove', description: 'remove ideas from the global list' },
  { text: 'edit', description: 'rework a global idea' },
  { text: 'pop', description: 'put a global idea in the box, ready to send' },
  { text: 'move', description: 'move a global idea to another place' },
  { text: 'clear', description: 'empty the global list' },
  { text: 'undo', description: 'bring back what its last clear took' },
  { text: 'import', description: 'put the items of a markdown list on it' },
]

// What Tab offers after "/aside q NAME ": the same commands on that queue, and its rename, local
// and global.
const NAMED_VERBS = [
  { text: 'here', description: 'move its ideas into this queue' },
  { text: 'add', description: 'move ideas of this queue to it' },
  { text: 'remove', description: 'remove ideas from it' },
  { text: 'edit', description: 'rework one of its ideas' },
  { text: 'pop', description: 'put one of its ideas in the box, ready to send' },
  { text: 'move', description: 'move one of its ideas to another place' },
  { text: 'clear', description: 'empty it' },
  { text: 'undo', description: 'bring back what its last clear took' },
  { text: 'import', description: 'put the items of a markdown list in it' },
  { text: 'rename', description: 'move all of it to a queue of another name' },
  { text: 'local', description: 'keep it for this project alone' },
  { text: 'global', description: 'share it with every project' },
]

export async function completeAside(ctx: Context, $: Kit, e: Autocomplete[1], next: Autocomplete[2]) {
  const typed = e.text.slice(0, e.cursor)
  // The queues by name after "q", each with how many ideas it holds.
  const nameTyped = /^\/aside\s+q\s+@?([A-Za-z0-9_-]*)$/i.exec(typed)
  if (nameTyped) {
    const own = (await next(e)).suggestions
    const word = nameTyped[1]!.toLowerCase()
    // By the name typed: one of this project's hides one every project sees of its name.
    const queues = []
    for (const one of await countQueues($)) {
      const name = queueName(one.name)
      if (name.startsWith(word) && name !== word && !(await isHiddenHere($, one.name))) queues.push({ ...one, typed: name, isLocal: isLocalQueue(one.name) })
    }

    return {
      suggestions: [...own, ...queues.map(one => ({ text: one.typed, description: `${formatCount(one.count, 'idea')}${one.isLocal ? ", this project's" : ''}` }))],
    }
  }
  // On a queue: its commands after "g" or its name, then its numbers, as many as the command takes.
  const queueVerb = /^\/aside\s+(?:g|q\s+@?([A-Za-z0-9_-]{1,20}))\s+(\S*)$/i.exec(typed)
  const queueLater = /^\/aside\s+(?:g|q\s+@?([A-Za-z0-9_-]{1,20}))\s+(here|add|remove|rm|edit|pop|move|mv)\s+((?:\d+\s+)*)(\d*)$/i.exec(typed)
  if (queueVerb || queueLater) {
    const own = (await next(e)).suggestions
    if (queueVerb) {
      const word = queueVerb[2]!.toLowerCase()
      const verbs = queueVerb[1] === undefined || queueVerb[1].toLowerCase() === GLOBAL ? GLOBAL_VERBS : NAMED_VERBS
      return { suggestions: [...own, ...verbs.filter(row => row.text.startsWith(word) && row.text !== word)] }
    }
    const queue = await resolveQueue($, queueLater![1]?.toLowerCase() ?? GLOBAL, ctx.settings.newQueues === 'local')
    const verb = queueLater![2]!.toLowerCase()
    const count = queueLater![3]!.split(/\s+/).filter(Boolean).length
    const room = ['here', 'add', 'remove', 'rm'].includes(verb) ? Infinity : verb === 'move' || verb === 'mv' ? 2 : 1
    // "add" takes numbers of this project's queue, its ideas only; every other command those of the queue named.
    const rows = count < room ? await numberRows($, ctx, verb === 'add' ? 'ideas' : { queue }, queueLater![4]!) : []

    return { suggestions: [...own, ...rows] }
  }
  const first = /^\/aside\s+(\S*)$/.exec(typed)
  // A number after a command, with the numbers already typed before it: offered only where
  // one more number keeps the command's shape, so "/aside pop 2 " offers nothing.
  const later = /^\/aside\s+(\S+)\s+((?:\d+\s+)*)(\d*)$/.exec(typed)
  const command = later ? commandNamed(later[1]!) : undefined
  const typedNumbers = later ? later[2]!.split(/\s+/).filter(Boolean) : []
  const completes = command?.takes([...typedNumbers, '1']) ? command.completes : undefined
  if (!first && completes === undefined) {
    return next(e)
  }
  const own = (await next(e)).suggestions
  if (first) {
    const word = first[1]!.toLowerCase()
    const rows = COMMANDS.filter(({ name }) => name.startsWith(word) && name !== word).map(({ name, about }) => ({ text: name, description: about }))

    return { suggestions: [...own, ...rows] }
  }

  return { suggestions: [...own, ...(await numberRows($, ctx, completes!, later![3]!))] }
}

type SessionStart = Parameters<Hook<'session.start'>>

export async function startSession(ctx: Context, $: Kit, e: SessionStart[1], next: SessionStart[2]) {
  await $.command.register({
    name: 'aside',
    description: 'Show the ideas and comments queued with "+"; plan and run them',
    argumentHint: ARGUMENT_HINT,
    // Runs at once mid-turn, so a stop lands before the next step; the prompts it sends
    // still wait for the turn to end.
    immediate: true,
  })
  ctx.session.planTool = await registerPlanTool($)
  ctx.session.waitTool = await registerWaitTool($)
  await refreshBand($)

  return next(e)
}
