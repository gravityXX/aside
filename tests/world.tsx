import { expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

export const REPORT = [
  '# Report', //                                      1
  '', //                                              2
  '## Results', //                                    3
  '', //                                              4
  'Revenue **grew by 12%** in the third quarter, mostly', // 5
  'thanks to [the new pricing](https://example.com/p).', //  6
  '', //                                              7
  '1. Costs stayed flat across all regions.', //      8
  '<!-- ? is this the same for Poland -->', //        9
  '', //                                              10
  '## Źródła danych', //                              11
  '```', //                                           12
  '## not a heading', //                              13
  '```', //                                           14
].join('\n')

export const REPORT_PATH = '/proj/docs/report.md'

export const STEPS = [
  { title: 'One', prompt: 'Do one.' },
  { title: 'Two', prompt: 'Do two.' },
  { title: 'Three', prompt: 'Do three.' },
]

// The machine under the plugin. Unless a test says otherwise: WSL with GNU grep, an empty
// clipboard, no files, the branch main and a store that takes every write.
export type Machine = {
  files: Record<string, string>
  clip: string
  // What grep prints for any search.
  grep: string
  branch: string
  system: 'wsl' | 'mac' | 'linux'
  // On Linux, how each clipboard reader there exits: 0 reads the clipboard, any other code fails
  // as wl-paste does with no Wayland. A reader left out is not installed.
  readers?: Record<string, number>
  // The environment, in place of the system's own (WSL_DISTRO_NAME on WSL, HOME elsewhere).
  env?: Record<string, string>
  // How grep exits; 2 with output is a search that found files but could not read a folder.
  grepExit?: number
  // The store refuses every write, as when it is full.
  isStoreFull?: boolean
  // The store refuses the n-th write from now, once, as a store that fills up half-way.
  refuseWrite?: number
  // The text selected in a transcript row.
  selection?: string
  // The terminal is too narrow to seat a pane.
  isNarrow?: boolean
  // The open panes are out of sight, tabs behind another pane.
  isPaneHidden?: boolean
  // The next prompt the plugin submits is dropped beneath it, as a settings hook would.
  isDropping?: boolean
  // The small model's reply to each note it is asked to tidy; a note with none fails.
  tidy?: Record<string, string>
  // Runs while the small model thinks.
  meanwhile?: () => Promise<unknown>
}

const SCREEN = { isFullscreen: true, columns: 120 }
const COMPOSER = { kind: 'composer' } as const
const VIEWPORT = { columns: 120, rows: 30 }

const ran = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

// A project at /proj with the plugin loaded, and what reaches the person and Claude:
// `sent` the prompts Claude got, `toasts` the notices in the corner, `logged` the lines in
// the transcript, `filled` what went into the prompt box, `asked` the notes the small model
// was asked to tidy, `panes` the panes open, `runs` the commands the plugin ran.
export const world = ($: Engine, on: On, given: Partial<Machine> = {}) => {
  const w: Machine = { files: {}, clip: '', grep: '', branch: 'main', system: 'wsl', ...given }
  const sent: string[] = []
  const toasts: string[] = []
  const logged: string[] = []
  const filled: string[] = []
  const asked: string[] = []
  const panes: string[] = []
  const runs: string[] = []

  // The plugin's store, as mock.store keeps it, but one that can refuse a write.
  const store = new Map<string, unknown>()
  on('store.get', ($e, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', ($e, e) => {
    if (w.refuseWrite !== undefined && --w.refuseWrite === 0) {
      w.refuseWrite = undefined
      return { deny: 'the store is full' }
    }
    if (w.isStoreFull) return { deny: 'the store is full' }
    store.set(e.key, structuredClone(e.value))
    return { value: undefined }
  })
  on('store.delete', ($e, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, w.env ?? (w.system === 'mac' ? { HOME: '/Users/me' } : w.system === 'linux' ? { HOME: '/home/me' } : { WSL_DISTRO_NAME: 'Ubuntu' }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('command.register', ($e, e) => ({ value: { command: e.name } }))
  on('tool.register', ($e, e) => ({ value: { tool: `mcp__aside__${e.name}` } }))

  on('ui.selection', () => ({ value: w.selection ? { text: w.selection, requestId: 'row-1' } : undefined }) as never)
  on('ui.toast', ($e, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($e, e) => {
    logged.push(e.text)
    return { value: undefined } as never
  })
  on('ui.open', ($e, e) => {
    if (w.isNarrow) return { value: { isPlaced: false, reason: 'the terminal is too narrow' } }
    if (!panes.includes(e.id)) panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($e, e) => {
    if (panes.includes(e.id)) panes.splice(panes.indexOf(e.id), 1)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: panes.map(id => ({ id, title: id, isShown: !w.isPaneHidden, isFocused: false, isPlaced: true })) }) as never)

  on('prompt.submit', ($e, e) => {
    if (w.isDropping && e.origin.kind === 'plugin') {
      w.isDropping = false
      return { drop: 'blocked by a hook' }
    }
    sent.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', ($e, e) => {
    filled.push(e.text)
    return { isFilled: true } as never
  })
  on('model.complete', async ($e, e) => {
    asked.push(e.prompt)
    await w.meanwhile?.()
    const reply = w.tidy?.[/<note>\n([\s\S]*)\n<\/note>/.exec(e.prompt)?.[1] ?? '']
    return {
      value: (reply === undefined
        ? { isAnswered: false, reason: 'api-error', status: null, kind: 'unknown' }
        : { isAnswered: true, text: reply, usage: { input_tokens: 1, output_tokens: 1 } }) as never,
    }
  })

  // The kit runs on Linux and resolves a Windows path ("C:\\x") against its own folder; a
  // Windows machine would read it as it is, so the folder the kit put before it is taken off.
  // A path the plugin built under the project is left alone.
  const onDisk = (path: string) => (path.startsWith('/proj/') ? path : path.replace(/^.*\/(?=[A-Za-z]:[\\/])/, ''))
  on('fs.read', ($e, e) => (onDisk(e.path) in w.files ? { value: w.files[onDisk(e.path)]! } : { deny: 'ENOENT' }))
  on('fs.exists', ($e, e) => ({ value: onDisk(e.path) in w.files }))
  on('fs.list', ($e, e) => {
    const dir = e.path.replace(/\/$/, '')
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of Object.keys(w.files)) {
      if (!path.startsWith(`${dir}/`)) continue
      const [head, ...rest] = path.slice(dir.length + 1).split('/')
      names.set(head!, rest.length > 0 ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 100, mtimeMs: 0, isLink: false })) } as never
  })
  on('process.run', ($e, e) => {
    runs.push(e.argv[0]!)
    const isMac = w.system === 'mac'
    // The engine refuses a command that is not installed.
    const missing = { deny: 'not installed' }
    const reader = w.system === 'linux' ? w.readers?.[e.argv[0]!] : undefined
    switch (e.argv[0]) {
      case 'powershell.exe':
        return w.system === 'wsl' ? ran(`${w.clip}\r\n`) : missing
      case 'pbpaste':
        return isMac ? ran(w.clip) : missing
      case 'wl-paste':
      case 'xclip':
      case 'xsel':
        return reader === undefined ? missing : ran(reader === 0 ? w.clip : '', reader)
      case 'git':
        return ran(`${w.branch}\n`)
      case 'grep':
        // BSD grep has no -P and fails with 2.
        return isMac ? ran('', 2) : ran(w.grep, w.grepExit ?? 0)
      default:
        return { deny: 'unknown command' }
    }
  })

  on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'create' } as never }))
  on('turn.start', ($e, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  // Lets every timer the plugin set run: a prompt it submits, a step it starts.
  const idle = async () => {
    await clock.advance(100)
    await clock.settle()
  }

  // Enter at the prompt, then the moment it takes to store what was queued.
  const type = async (text: string, turnId?: string) => {
    const result = await $.prompt.submit({ text, origin: COMPOSER, wait: false, ...(turnId ? { turnId } : {}) })
    await clock.advance(2)
    await clock.settle()
    return result
  }

  // Enter on an entry: it must be queued, and the line it leaves in the transcript comes back.
  const queue = async (text: string, turnId?: string) => {
    expect(await type(text, turnId)).toEqual({ drop: 'queued' })
    return logged.at(-1)
  }

  const aside = async (args = '') =>
    (await $.command.run({ command: 'aside', args, origin: COMPOSER, presentation: SCREEN })).text ?? ''

  // /aside as a reader takes it in: each line trimmed, the columns one space apart.
  const shown = async (args = '') =>
    (await aside(args))
      .split('\n')
      .map(line => line.trim().replace(/ {2,}/g, ' '))
      .filter(line => line !== '')

  const write = (path: string, content = 'x') => $.tool.call({ tool: 'Write', file_path: path, content } as never)

  // Claude saving a plan with the plan tool, and the items it leaves out, if any.
  const savePlan = (steps: unknown, unclear?: unknown) =>
    $.tool.call({ tool: 'mcp__aside__plan', steps, ...(unclear === undefined ? {} : { unclear }) } as never)

  // Claude pausing the plan from a step with the wait tool.
  const wait = (reason: string) => $.tool.call({ tool: 'mcp__aside__wait', reason } as never)

  const startTurn = (text: string, turnId: string) => $.turn.start({ text, turnId })

  // The end of a turn: how it ended, Claude's answer and how long it ran.
  const endTurn = (turnId: string, reason: 'answer' | 'aborted' = 'answer', text = '', durationMs = 1) =>
    $.turn.complete({ turnId, reason, answer: text, durationMs, isAborted: reason === 'aborted' } as never)

  // A turn the plugin started with the last prompt it sent, run to its end, and what Claude
  // answered in it.
  const answer = async (turnId: string, text = '', durationMs = 1) => {
    await startTurn(sent.at(-1)!, turnId)
    await endTurn(turnId, 'answer', text, durationMs)
    await idle()
  }

  const mount = (component: 'AbovePrompt' | 'Pane' | 'CommandOutput' | 'ToolUse' | 'ToolResult', props: unknown) =>
    $.ui.mount({
      plugin: 'aside',
      surface: 'terminal',
      component,
      props: props as never,
      ...(component === 'Pane' ? { requestId: 'aside' } : {}),
      viewport: VIEWPORT,
    })

  const band = () => mount('AbovePrompt', { hasSurvey: false })

  const pane = () => mount('Pane', { title: 'aside', isFocused: true, bodyColumns: 100, placement: 'inline' })

  // The framed listing drawn from the text a command printed.
  const output = (text: string, command = 'aside') => mount('CommandOutput', { command, args: '', text, isErrored: false })

  // A press of the band's list button, or of the plan's button beside it ('action').
  const pressBand = async (key: 'list' | 'action' = 'list') => {
    const ui = await band()
    await ui.press({ key })
    await ui.unmount()
    await idle()
  }

  return {
    w,
    sent,
    toasts,
    logged,
    filled,
    asked,
    panes,
    runs,
    clock,
    idle,
    type,
    queue,
    aside,
    shown,
    write,
    savePlan,
    wait,
    startTurn,
    endTurn,
    answer,
    mount,
    band,
    pane,
    output,
    pressBand,
  }
}
