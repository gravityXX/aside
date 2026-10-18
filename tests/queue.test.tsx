import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Idea } from '../types'
import { capture, headingLine, ideasOf, locate, looksLikeDiff, plan, snippet, stepPrompt, tags } from '../hooks/queue'

const SCREEN = { isFullscreen: true, columns: 120 }
const COMPOSER = { kind: 'composer' } as const

const REPORT = [
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

type World = {
  files: Record<string, string>
  clip: string
  grep: string
  branch: string
  // Which clipboard tool and grep the machine has: WSL with GNU grep unless said otherwise.
  system?: 'wsl' | 'mac'
  // What is selected with the mouse in the terminal, if anything.
  selection?: string
  // The next prompt the mod submits is dropped beneath it, as a settings hook or a limit would.
  isDropping?: boolean
}

// The world beneath the plugin: a project at /proj, a store and a clock in memory, files,
// a clipboard, rg and git answered from `w`, and a record of what reaches the bottom.
const world = (on: On, w: World = { files: {}, clip: '', grep: '', branch: 'main' }) => {
  const sent: string[] = []
  const toasts: string[] = []
  const filled: string[] = []
  mock.store(on)
  const clock = mock.clock(on, { now: 1000 })
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.selection', () => ({ value: w.selection ? { text: w.selection, requestId: 'row-1' } : undefined }) as never)
  mock.env(on, w.system === 'mac' ? { HOME: '/Users/me' } : { WSL_DISTRO_NAME: 'Ubuntu' })
  on('fs.list', ($, e) => {
    const dir = e.path.replace(/\/$/, '')
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of Object.keys(w.files)) {
      if (!path.startsWith(`${dir}/`)) continue
      const [head, ...rest] = path.slice(dir.length + 1).split('/')
      names.set(head!, rest.length > 0 ? 'dir' : 'file')
    }

    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 100, mtimeMs: 0, isLink: false })) } as never
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__queue__${e.name}` } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  // The transcript line a stored entry leaves, kept beside the toasts.
  on('ui.log', ($, e) => {
    toasts.push(e.text)

    return { value: undefined } as never
  })
  on('prompt.submit', ($, e) => {
    if (w.isDropping && e.origin.kind === 'plugin') {
      w.isDropping = false

      return { drop: 'blocked by a hook' }
    }
    sent.push(e.text)

    return { text: e.text }
  })
  on('prompt.fill', ($, e) => {
    filled.push(e.text)

    return { isFilled: true } as never
  })
  on('fs.read', ($, e) => (e.path in w.files ? { value: w.files[e.path]! } : { deny: 'ENOENT' }))
  on('fs.exists', ($, e) => ({ value: e.path in w.files }))
  on('process.run', ($, e) => {
    const out = (stdout: string) => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    const missing = { value: { exitCode: 127, stdout: '', stderr: 'not found', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'powershell.exe') return w.system === 'mac' ? missing : out(`${w.clip}\r\n`)
    if (e.argv[0] === 'pbpaste') return w.system === 'mac' ? out(w.clip) : missing
    if (e.argv[0] === 'git') return out(`${w.branch}\n`)
    // BSD grep has no -P: it fails with 2, and the walk takes over.
    if (e.argv[0] === 'grep') return w.system === 'mac' ? { value: { ...missing.value, exitCode: 2 } } : out(w.grep)

    return { deny: 'unknown command' }
  })
  on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'create' } as never }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  current = { toasts, clock }

  return { sent, toasts, filled, clock, w }
}

let current: { toasts: string[]; clock: { advance: (ms: number) => Promise<void>; settle: () => Promise<void> } } | undefined

const queue = ($: Engine, args = '') =>
  $.command.run({ command: 'queue', args, origin: COMPOSER, presentation: SCREEN })

// Enter at the prompt, then the moment it takes to store what was queued.
const type = async ($: Engine, text: string, turnId?: string) => {
  const sent = await $.prompt.submit({ text, origin: COMPOSER, wait: false, ...(turnId ? { turnId } : {}) })
  await current?.clock.advance(2)
  await current?.clock.settle()

  return sent
}

// The transcript line a typed entry leaves once stored.
const typed = async ($: Engine, text: string, turnId?: string) => {
  expect(await type($, text, turnId)).toEqual({ drop: 'queued' })

  return current?.toasts.at(-1)
}

const write = ($: Engine, path: string) =>
  $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)

const ends = async ($: Engine, turnId: string, reason: 'answer' | 'aborted' = 'answer') =>
  $.turn.complete({ turnId, reason, answer: '', durationMs: 1, isAborted: reason === 'aborted' } as never)

describe('capture', () => {
  test('a message starting with + is one idea, a plain one is not', () => {
    expect(capture('+ add tests for the parser')).toEqual([{ kind: 'idea', text: 'add tests for the parser', anchor: {}, raw: '+ add tests for the parser' }])
    expect(capture('fix the build')).toBeNull()
    expect(capture('a + b')).toBeNull()
    expect(capture('+   ')).toBeNull()
  })

  test('every line with + is its own entry, otherwise the message stays whole', () => {
    expect(capture('+ one\n\n+ two\n+three')?.map(one => one.text)).toEqual(['one', 'two', 'three'])
    expect(capture('+ an idea\nwith a second line')?.map(one => one.text)).toEqual(['an idea\nwith a second line'])
  })

  test('the mark after + names the kind, and only comments carry an anchor', () => {
    const kinds = capture('+? why\n+! as a table\n+- drop it\n++ dig into X\n+ @x.md plain')
    expect(kinds?.map(one => one.kind)).toEqual(['question', 'change', 'drop', 'deeper', 'idea'])
    expect(kinds?.[4]).toMatchObject({ text: '@x.md plain', anchor: {} })
    expect(capture('+? @docs/r.md:42 why')?.[0]).toMatchObject({ text: 'why', anchor: { file: 'docs/r.md', line: 42 } })
    expect(capture('+! @r.md#results shorter')?.[0]).toMatchObject({ anchor: { file: 'r.md', heading: 'results' } })
    expect(capture('+- #zrodla')?.[0]).toMatchObject({ kind: 'drop', text: '', anchor: { heading: 'zrodla' } })
    expect(capture('+?')).toBeNull()
  })

  test('a pasted diff is a prompt, not an idea', () => {
    expect(looksLikeDiff('+ added line\n-removed line\n context')).toBe(true)
    expect(capture('+++ b/file.ts\n+ x')).toBeNull()
    expect(capture('+ added line\n-removed line\n context')).toBeNull()
    expect(capture('+ an idea\nmore about it\n-ish')).not.toBeNull()
    expect(capture('+ refactor the parser\n- split the lexer\n- add tests')?.[0]?.text).toBe('refactor the parser\n- split the lexer\n- add tests')
    expect(capture('+? does this diff look right\n```diff\n--- a/x\n+++ b/x\n```')).not.toBeNull()
  })
})

describe('finding a fragment', () => {
  test('a fragment copied from the preview finds its line through markup, wraps and numbers', () => {
    expect(locate('Revenue grew by 12% in the third quarter, mostly thanks to the new pricing.', REPORT)).toBe(5)
    expect(locate('thanks to the new pricing', REPORT)).toBe(6)
    expect(locate('Costs stayed flat across all regions.', REPORT)).toBe(8)
    expect(locate('Something written somewhere else entirely, not here at all', REPORT)).toBeUndefined()
    expect(locate('Revenue', REPORT)).toBeUndefined()
    expect(locate('Install uv first.\nRun the tests.\nPush the branch.', '1. Install uv first.\n2. Run the tests.\n3. Push the branch.')).toBe(1)
    expect(locate('Write the report draft today', 'Notes\n\n- [x] Write the report draft today')).toBe(3)
  })

  test('too little evidence pins nothing', () => {
    expect(locate('npm run build', 'Run `npm run build` first.')).toBeUndefined()
    const source = 'Intro.\n\nTo start, run the following command in the root of the repository and wait.'
    expect(locate('Elsewhere on the web: run the following command in the root of the repository, then open the browser and log in with your account', source)).toBeUndefined()
    expect(locate('To start, run the following command in the root of the repository and wait for it', source)).toBe(3)
  })

  test('a heading is found by its slug, Polish letters folded, code blocks skipped', () => {
    expect(headingLine(REPORT, 'results')).toEqual({ line: 3, title: 'Results' })
    expect(headingLine(REPORT, 'zrodla')).toEqual({ line: 11, title: 'Źródła danych' })
    expect(headingLine(REPORT, 'danych')?.line).toBe(11)
    expect(headingLine(REPORT, 'not-a')).toBeUndefined()
    expect(headingLine('````\n```\n# fake\n```\n````\n# Real', 'fake')).toBeUndefined()
  })

  test('tags in a file are comments with their line and the text above them', () => {
    expect(tags('```md\n<!-- ? shown as an example -->\n```\nText\n<!-- - real -->')).toEqual([{ kind: 'drop', text: 'real', line: 5, quote: 'Text' }])
    expect(tags(REPORT)).toEqual([{ kind: 'question', text: 'is this the same for Poland', line: 9, quote: 'Costs stayed flat across all regions.' }])
    expect(tags('Write `<!-- ? question -->` above a line.')).toEqual([])
    expect(tags('````md\n```\n<!-- ? inside -->\n```\n````\n<!-- ! outside -->')).toEqual([{ kind: 'change', text: 'outside', line: 6 }])
  })

  test('counts and snippets read well', () => {
    expect([1, 2].map(ideasOf)).toEqual(['1 idea', '2 ideas'])
    expect(snippet('a'.repeat(50), 10)).toBe(`${'a'.repeat(9)}…`)
  })
})

describe('prompts', () => {
  test('the plan prompt groups ideas and comments per file and asks for the plan tool', () => {
    const entries: Idea[] = [
      { text: 'dark mode', at: 0, kind: 'idea', task: 'build the parser', branch: 'feat' },
      { text: 'where from', at: 0, kind: 'question', file: '/proj/docs/r.md', line: 5, quote: 'Revenue grew' },
      { text: 'same for Poland', at: 0, kind: 'question', file: '/proj/docs/r.md', line: 9, isTag: true },
      { text: 'shorter', at: 0, kind: 'change' },
    ]
    const text = plan(entries, '/proj')

    expect(text).toContain('Ideas:\n1. dark mode (while you worked on "build the parser", branch feat)')
    expect(text).toContain('docs/r.md:\n  2. [question] line 5, on "Revenue grew": where from')
    expect(text).toContain('3. [question] line 9 [a <!-- --> tag in the file]: same for Poland')
    expect(text).toContain('Not tied to a file:\n  4. [change]: shorter')
    expect(text).toContain('mcp__idea-queue__plan')
    expect(text).toContain('Composed by the idea-queue plugin')
  })

  test('a step prompt says which step it is and who sent it', () => {
    expect(stepPrompt({ title: 'Tests', prompt: 'Add tests.' }, 2, 3)).toBe(
      'Add tests.\n\n(Step 2 of 3 of the queue plan, "Tests", sent by the idea-queue plugin.)',
    )
  })
})

describe('queue', () => {
  test('an idea typed mid-turn is dropped before the model and kept, with its task and branch', async ($, on) => {
    const { sent, toasts, clock } = world(on)
    await type($, 'build the parser')

    expect(await typed($, '+ dark mode', 't1')).toBe('queued "dark mode" (1 waiting)')
    expect(toasts).toEqual(['queued "dark mode" (1 waiting)'])
    await type($, '+ added\n-removed\n kept')
    expect(sent).toEqual(['build the parser', '+ added\n-removed\n kept'])
    expect((await queue($, 'list')).text).toBe('1. dark mode')

    await queue($, 'plan')
    await clock.advance(100)
    expect(sent.at(-1)).toContain('1. dark mode (while you worked on "build the parser", branch main)')
  })

  test('a comment pins itself to the fragment on the clipboard', async ($, on) => {
    const w = { files: { '/proj/docs/report.md': REPORT }, clip: 'Revenue grew by 12% in the third quarter', grep: '', branch: 'main' }
    const { toasts } = world(on, w)
    await write($, '/proj/docs/report.md')

    await type($, '+? where does this come from')
    expect(toasts.at(-1)).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (1 waiting)')
    expect((await queue($, 'list')).text).toBe(
      '1. [?] docs/report.md:5 "Revenue grew by 12% in the third quarter": where does this come from\n\nTags in files:\n- [?] docs/report.md:9 "Costs stayed flat across all regions.": is this the same for Poland',
    )
  })

  test('copied text no file holds is kept loose and said so; grep finds a file from an earlier session', async ($, on) => {
    const w = { files: { '/proj/old.md': REPORT }, clip: 'nothing like this is written anywhere at all', grep: '', branch: 'main' }
    const { toasts } = world(on, w)

    expect(await typed($, '+! make it shorter')).toBe('queued ! "nothing like this is written…" - copied text not found in any .md file under /proj (1 waiting)')
    expect((await queue($, 'list')).text).toBe('1. [!] "nothing like this is written anywhere at all" (not in a file): make it shorter')

    w.clip = 'Costs stayed flat across all regions.'
    w.grep = '/proj/old.md\n'
    await type($, '+- drop this')
    expect(toasts.at(-1)).toBe('queued - old.md:8 "Costs stayed flat across all…" (2 waiting)')

    w.clip = ''
    expect(await typed($, '+? and this')).toBe('queued ? "and this" - no text on the clipboard (3 waiting)')
    w.clip = '1. Costs stayed flat\n2. across all regions.'
    await type($, '+? a list copied with its numbers')
    expect(toasts.at(-1)).toBe('queued ? old.md:8 "1. Costs stayed flat 2. acros…" (4 waiting)')
  })

  test('on a Mac: pbpaste for the clipboard, and the walk finds the file BSD grep cannot', async ($, on) => {
    const w: World = { files: { '/proj/notes/deep/old.md': REPORT, '/proj/node_modules/x/old.md': REPORT, '/proj/.git/old.md': REPORT }, clip: 'Costs stayed flat across all regions.', grep: '', branch: 'main', system: 'mac' }
    const { toasts } = world(on, w)

    await type($, '+- drop this')
    expect(toasts.at(-1)).toBe('queued - notes/deep/old.md:8 "Costs stayed flat across all…" (1 waiting)')
    expect(await typed($, '+? @old.md where')).toBe('queued ? notes/deep/old.md:8 "Costs stayed flat across all…" (2 waiting)')
  })

  test('a heading or a line named after the mark pins without the clipboard', async ($, on) => {
    const w = { files: { '/proj/docs/report.md': REPORT }, clip: '', grep: '', branch: 'main' }
    const { toasts } = world(on, w)
    await write($, '/proj/docs/report.md')

    await type($, '+- #zrodla')
    expect(toasts.at(-1)).toBe('queued - docs/report.md:11 (1 waiting)')
    await type($, '+? @docs/report.md:3 why this order')
    expect(toasts.at(-1)).toBe('queued ? docs/report.md:3 (2 waiting)')
    expect(await typed($, '+! #nowhere shorter')).toBe('queued ! #nowhere - no heading "nowhere" in the 1 files written this session (3 waiting)')
  })

  test('/queue hands everything over as one planning prompt, undo and pop bring entries back', async ($, on) => {
    const { sent, filled, clock } = world(on)
    await type($, '+ a\n+? b')

    expect((await queue($, 'plan')).text).toBe('Organizing 1 idea and 1 comment.')
    await clock.advance(100)
    await clock.settle()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('Ideas:\n1. a')
    expect((await queue($, 'list')).text).toBe('The queue is empty.')
    expect((await queue($, 'undo')).text).toBe('Brought back 2 entries, 2 waiting.')

    expect((await queue($, 'pop')).text).toBe('In the prompt box, ready to send: b')
    expect(filled).toEqual(['Question:\nb'])
    expect((await queue($, 'list')).text).toBe('1. a')
  })

  test('a planning prompt dropped beneath the mod gives the entries back', async ($, on) => {
    const { sent, toasts, clock, w } = world(on)
    await type($, '+ a')
    w.isDropping = true

    await queue($, 'plan')
    await clock.advance(100)
    expect(sent).toEqual([])
    expect(toasts.at(-1)).toBe('Could not hand the queue over (blocked by a hook); the entries are back in it')
    expect((await queue($, 'list')).text).toBe('1. a')
  })

  test('file tags handed over once are not handed over again, and the band then offers the plan', async ($, on) => {
    const w = { files: { '/proj/docs/report.md': REPORT }, clip: '', grep: '', branch: 'main' }
    const { sent, clock } = world(on, w)
    await write($, '/proj/docs/report.md')

    expect((await queue($, 'plan')).text).toBe('Organizing 1 comment.')
    await clock.advance(100)
    expect(sent.at(-1)).toContain('[a <!-- --> tag in the file]: is this the same for Poland')
    expect((await queue($, 'plan')).text).toContain('The queue is empty.')
    expect((await queue($, 'list')).text).toContain('- (handed over) [?] docs/report.md:9')
  })

  test('remove and clear, and clearing an empty queue keeps what undo can bring back', async ($, on) => {
    world(on)
    await type($, '+ a\n+ b\n+ c')

    expect((await queue($, 'remove 2')).text).toBe('Removed: b')
    expect((await queue($, 'rm 9')).text).toContain('from 1 to 2')
    expect((await queue($, 'Clear')).text).toBe('Cleared 2 entries. /queue undo brings them back.')
    expect((await queue($, 'clear')).text).toBe('The queue is already empty.')
    expect((await queue($, 'undo')).text).toBe('Brought back 2 entries, 2 waiting.')
  })
})

describe('from the issues', () => {
  const REPORT_FILES = { '/proj/docs/report.md': REPORT }

  test('/queue TEXT queues TEXT, as + would, and a known word still runs its command', async ($, on) => {
    const { toasts } = world(on)

    expect((await queue($, 'add tests for the parser')).text).toBe('queued "add tests for the parser" (1 waiting)')
    expect((await queue($, '+? why this order')).text).toContain('queued ? "why this order"')
    // A command answers with the text itself: no toast or log line on top of it.
    expect(toasts).toEqual([])
    expect((await queue($, 'list')).text).toBe('1. add tests for the parser\n2. [?] why this order')
  })

  test('/queue send hands everything over as it is, to be done now; undo brings it back', async ($, on) => {
    const { sent, clock } = world(on)
    await type($, '+ a\n+? b')

    expect((await queue($, 'run all')).text).toBe('Sending 1 idea and 1 comment.')
    await clock.advance(100)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('Ideas:\n1. a')
    expect(sent[0]).toContain('Work through all of it now')
    expect(sent[0]).not.toContain('mcp__idea-queue__plan')
    expect((await queue($, 'undo')).text).toBe('Brought back 2 entries, 2 waiting.')
  })

  test('/queue each runs every entry as its own prompt, one after another', async ($, on) => {
    const { sent, clock } = world(on, { files: REPORT_FILES, clip: '', grep: '', branch: 'main' })
    await write($, '/proj/docs/report.md')
    await type($, '+ dark mode\n+! @docs/report.md:5 as a table')

    expect((await queue($, 'run')).text).toContain('Running 3 entries one by one')
    expect((await queue($)).text).toContain('1. [running] dark mode\n2. [todo] as a table\n3. [todo] is this the same for Poland')
    await clock.advance(100)
    expect(sent[0]).toContain('dark mode (branch main)')
    await $.turn.start({ text: sent[0]!, turnId: 'e1' })
    await ends($, 'e1')
    await clock.advance(100)
    expect(sent[1]).toContain('Change - In docs/report.md: line 5:\nas a table')
    await $.turn.start({ text: sent[1]!, turnId: 'e2' })
    await ends($, 'e2')
    await clock.advance(100)
    expect(sent[2]).toContain('remove the tag once it is handled')
    expect((await queue($, 'list')).text).toContain('The queue is empty.')
  })

  test('/queue edit N puts an entry back in the box, /queue move N M reorders', async ($, on) => {
    const { filled } = world(on)
    await type($, '+ a\n+ b\n+? c')

    expect((await queue($, 'move 3 1')).text).toBe('1. [?] c\n2. a\n3. b')
    expect((await queue($, 'move 9 1')).text).toBe('Give two places from 1 to 3: /queue move 3 1')
    expect((await queue($, 'edit 2')).text).toBe('Entry 2 is in the prompt box: change it and press Enter; it goes back to place 2, still pointing where it did.')
    expect(filled).toEqual(['+ a'])
    expect((await queue($, 'list')).text).toBe('1. [?] c\n2. b')
  })

  test('a fresh copy comes first; with the clipboard unchanged, the selection in Claude\'s reply wins', async ($, on) => {
    const w: World = { files: REPORT_FILES, clip: 'Costs stayed flat across all regions.', grep: '', branch: 'main', selection: 'Revenue grew by 12% in the third quarter' }
    const { toasts } = world(on, w)
    await write($, '/proj/docs/report.md')

    await type($, '+? why flat')
    expect(toasts.at(-1)).toBe('queued ? docs/report.md:8 "Costs stayed flat across all…" (1 waiting)')
    await type($, '+? where from')
    expect(toasts.at(-1)).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (2 waiting)')
    w.selection = 'I chose the async path because the sync one blocks'
    await type($, '+! use the sync path')
    expect((await queue($, 'list')).text).toContain('3. [!] "I chose the async path because the sync one blocks" (from the terminal): use the sync path')
  })

  test('a word that looks like a command but has the wrong shape is queued as text', async ($, on) => {
    const { sent, clock } = world(on)
    await type($, '+ a')

    expect((await queue($, 'send a summary to the team')).text).toBe('queued "send a summary to the team" (2 waiting)')
    expect((await queue($, 'run the tests before merge')).text).toContain('queued "run the tests before merge"')
    expect((await queue($, 'clear the cache docs')).text).toContain('(4 waiting)')
    expect((await queue($, '+ run 3')).text).toBe('queued "run 3" (5 waiting)')
    await clock.advance(100)
    expect(sent).toEqual([])
  })

  test('an edited entry comes back to its place, still pointing where it did', async ($, on) => {
    const w: World = { files: REPORT_FILES, clip: 'Revenue grew by 12% in the third quarter', grep: '', branch: 'main' }
    world(on, w)
    await write($, '/proj/docs/report.md')
    await type($, '+? where from')
    await type($, '+ b')

    await queue($, 'edit 1')
    w.clip = 'Something else entirely, copied later from a web page'
    await type($, '+? where does 12% come from')
    expect((await queue($, 'list')).text).toMatch(/^1\. \[\?\] docs\/report\.md:5 "Revenue grew by 12% in the third quarter": where does 12% come from\n2\. b\n/)
  })

  test('only Bash and edit output counts, and a denial or a missing file is not it', async ($, on) => {
    world(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: '3 tests failed' }) as never)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'File does not exist', isError: true }) as never)
    await $.turn.start({ text: 'test it', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/proj/nope.md' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.tool.call({ tool: 'Read', file_path: '/proj/nope2.md' } as never)

    await type($, '+? why')
    expect((await queue($, 'list')).text).toBe('1. [?] [after: Bash: 3 tests failed]: why')
  })

  test('with nothing copied, a comment takes the last tool output of the turn, an error first', async ($, on) => {
    const w: World = { files: {}, clip: '', grep: '', branch: 'main' }
    world(on, w)
    on('tool.call', { tool: 'Bash' }, ($e, e) =>
      (e.command === 'fail' ? { result: 'exit 1: boom', isError: true } : { result: 'ok' }) as never,
    )
    await $.turn.start({ text: 'build it', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'fail' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pass' } as never)

    expect(await typed($, '+? why did it fail')).toBe('queued ? "why did it fail" - with the last tool output (1 waiting)')
    expect((await queue($, 'list')).text).toContain('[after: Bash failed: exit 1: boom]: why did it fail')
    await $.turn.start({ text: 'next thing', turnId: 't2' })
    expect(await typed($, '+? and now')).toBe('queued ? "and now" - no text on the clipboard (2 waiting)')
  })
})

describe('the prompt box', () => {
  test('a queued message leaves the box empty, but a new draft typed meanwhile stays', async ($, on) => {
    const { filled, clock } = world(on)
    let box = ''
    on('prompt.read', () => ({ value: { text: box, cursor: box.length } }) as never)

    box = '+ dark mode'
    await type($, '+ dark mode')
    await clock.advance(50)
    expect(filled).toEqual([''])

    box = 'something new'
    await type($, '+ another')
    await clock.advance(50)
    expect(filled).toEqual([''])
  })
})

test('the box the engine puts a queued message back into is emptied at once', async ($, on) => {
  const { filled } = world(on)
  on('prompt.change', ($e, e) => ({ text: e.text }))
  await type($, '+ dark mode')
  // Raised as the engine raises it; the test kit's types leave this event out.
  const change = ($.prompt as unknown as { change: (e: unknown) => Promise<unknown> }).change

  await change({ text: 'something else', cursor: 0, origin: { kind: 'engine' } })
  expect(filled).toEqual([])
  await change({ text: '+ dark mode', cursor: 11, origin: { kind: 'engine' } })
  expect(filled).toEqual([''])
})

test('Enter is answered at once; two quick entries are both stored, in order', async ($, on) => {
  const { clock } = world(on)

  const first = $.prompt.submit({ text: '+ one', origin: COMPOSER, wait: false })
  const second = $.prompt.submit({ text: '+? two', origin: COMPOSER, wait: false })
  expect(await first).toEqual({ drop: 'queued' })
  expect(await second).toEqual({ drop: 'queued' })
  await clock.advance(5)
  await clock.settle()
  expect((await queue($, 'list')).text).toBe('1. one\n2. [?] two')
})

describe('tab completion', () => {
  const complete = ($: Engine, text: string) => {
    const token = /\S*$/.exec(text)![0]

    return ($.prompt as unknown as { autocomplete: (e: unknown) => Promise<{ suggestions: { text: string; description?: string }[] }> })
      .autocomplete({ text, cursor: text.length, token: token || text.slice(-1), start: text.length - token.length })
      .then(result => result.suggestions.map(row => `${row.text}: ${row.description ?? ''}`))
  }

  test('after "/queue " Tab offers the subcommands, then the entry numbers', async ($, on) => {
    world(on)
    on('prompt.autocomplete', () => ({ suggestions: [] }))
    await type($, '+ dark mode\n+? why so slow')

    expect(await complete($, '/queue cl')).toEqual(['clear: empty the queue'])
    expect(await complete($, '/queue p')).toEqual(['plan: organize the queue into steps', 'pop: put an entry in the box, ready to send'])
    expect(await complete($, '/queue pop ')).toEqual(['1: dark mode', '2: [?] why so slow'])
    expect(await complete($, 'just text')).toEqual([])
  })
})

describe('the task an idea came with', () => {
  test('queued while a turn runs, an idea names its task; queued at an idle prompt, none', async ($, on) => {
    const { sent, clock } = world(on)
    await type($, 'build the parser')
    await $.turn.start({ text: 'build the parser', turnId: 't1' })
    await type($, '+ dark mode', 't1')
    await queue($, 'and its tests')
    await ends($, 't1')
    await type($, '+ rename the loader')
    await queue($, 'and the docs')
    await queue($, 'run all')
    await clock.advance(100)

    expect(sent.at(-1)).toContain('1. dark mode (while you worked on "build the parser", branch main)')
    expect(sent.at(-1)).toContain('2. and its tests (while you worked on "build the parser", branch main)')
    expect(sent.at(-1)).toContain('3. rename the loader (branch main)')
    expect(sent.at(-1)).toContain('4. and the docs (branch main)')
  })
})

describe('when a turn ends', () => {
  test('whenTurnEnds: plan hands the queue over by itself, but not after its own turn', { options: { whenTurnEnds: 'plan' } }, async ($, on) => {
    const { sent, clock } = world(on)
    await type($, 'build the parser')
    await $.turn.start({ text: 'build the parser', turnId: 't1' })
    await type($, '+ dark mode', 't1')

    await ends($, 't1')
    await clock.advance(100)
    expect(sent.at(-1)).toContain('Organize all of it')
    await $.turn.start({ text: sent.at(-1)!, turnId: 'p1' })
    await type($, '+ another', 'p1')
    await ends($, 'p1')
    await clock.advance(100)
    expect(sent.filter(text => text.includes('Organize all of it'))).toHaveLength(1)
  })

  test('a saved plan with steps to do holds the automatic hand-over back', { options: { whenTurnEnds: 'plan' } }, async ($, on) => {
    const { sent, toasts, clock } = world(on)
    await $.tool.call({ tool: 'mcp__idea-queue__plan', steps: [{ title: 'One', prompt: 'Do one.' }] } as never)
    await $.turn.start({ text: 'build', turnId: 't1' })
    await type($, '+ c', 't1')
    await ends($, 't1')
    await clock.advance(100)
    expect(sent).toEqual([])
    expect(toasts.at(-1)).toBe('Waiting in the queue: 1 · /queue plan or /queue run')

    await queue($, 'plan')
    await clock.advance(100)
    expect(sent[0]).toContain('The saved plan still has these steps to do. Keep them')
    expect(sent[0]).toContain('1. One: Do one.')
  })

  test('the default waits for /queue', async ($, on) => {
    const { sent, clock } = world(on)
    await $.turn.start({ text: 'build', turnId: 't1' })
    await type($, '+ dark mode', 't1')
    await ends($, 't1')
    await clock.advance(100)
    expect(sent).toEqual([])
  })
})

describe('plan', () => {
  const STEPS = [
    { title: 'One', prompt: 'Do one.' },
    { title: 'Two', prompt: 'Do two.' },
    { title: 'Three', prompt: 'Do three.' },
  ]

  test('the model saves the plan; /queue run sends each step when the one before ends', async ($, on) => {
    const { sent, toasts, clock } = world(on)
    const saved = await $.tool.call({ tool: 'mcp__idea-queue__plan', steps: STEPS } as never)
    expect(saved.result).toContain('Saved 3 steps')
    expect((await queue($)).text).toContain('1. [todo] One\n2. [todo] Two\n3. [todo] Three')

    expect((await queue($, 'run')).text).toContain('3 steps, from step 1')
    await clock.advance(100)
    expect(sent).toEqual([stepPrompt(STEPS[0]!, 1, 3)])

    await $.turn.start({ text: sent[0]!, turnId: 's1' })
    await ends($, 's1')
    await clock.advance(100)
    expect(sent.at(-1)).toBe(stepPrompt(STEPS[1]!, 2, 3))

    await $.turn.start({ text: sent.at(-1)!, turnId: 's2' })
    expect((await queue($, 'stop')).text).toBe('The plan stops after step 2.')
    await ends($, 's2')
    await clock.advance(100)
    expect(sent).toHaveLength(2)
    expect(toasts.at(-1)).toBe('Step 2 done')
    expect((await queue($)).text).toContain('1. [done] One\n2. [done] Two\n3. [todo] Three')
  })

  test('a stop before the next step goes out keeps it from going out', async ($, on) => {
    const { sent, clock } = world(on)
    await $.tool.call({ tool: 'mcp__idea-queue__plan', steps: STEPS } as never)
    await queue($, 'run')
    await clock.advance(100)
    await $.turn.start({ text: sent[0]!, turnId: 's1' })
    expect((await $.tool.call({ tool: 'mcp__idea-queue__plan', steps: STEPS } as never)).deny).toContain('is running')

    await ends($, 's1')
    expect((await queue($, 'stop')).text).toBe('The plan stopped before step 2.')
    await clock.advance(100)
    expect(sent).toHaveLength(1)
    expect((await queue($)).text).toContain('1. [done] One\n2. [todo] Two\n3. [todo] Three')
  })

  test('a step prompt dropped beneath the mod lets the plan go', async ($, on) => {
    const { toasts, clock, w } = world(on)
    await $.tool.call({ tool: 'mcp__idea-queue__plan', steps: STEPS } as never)
    w.isDropping = true

    await queue($, 'run')
    await clock.advance(100)
    await clock.settle()
    expect(toasts.at(-1)).toBe('Could not send step 1 of the plan: blocked by a hook')
    expect((await queue($, 'stop')).text).toBe('Nothing is running.')
  })

  test('/queue run runs the saved plan first; with the plan done, the queue entry by entry', async ($, on) => {
    const { sent, clock } = world(on)
    await $.tool.call({ tool: 'mcp__idea-queue__plan', steps: [{ title: 'One', prompt: 'Do one.' }] } as never)
    await type($, '+ extra')

    expect((await queue($, 'run')).text).toBe('Running the plan: 1 step, from step 1. /queue stop stops after the current one.')
    await clock.advance(100)
    await $.turn.start({ text: sent[0]!, turnId: 'x1' })
    expect((await queue($, 'undo')).text).toBe('Step 1 of the plan is running; /queue stop first, so nothing is done twice.')
    await ends($, 'x1')

    expect((await queue($, 'run')).text).toBe('Running 1 entry one by one. /queue stop stops after the current one.')
    await clock.advance(100)
    expect(sent.at(-1)).toContain('extra')
  })

  test('/queue pop N takes entry N into the box, ready to send', async ($, on) => {
    const { filled } = world(on)
    await type($, '+ a\n+ b\n+ c')

    expect((await queue($, 'pop 2')).text).toBe('In the prompt box, ready to send: b')
    expect(filled).toEqual(['b'])
    expect((await queue($, 'pop 9')).text).toBe('Give a number from 1 to 2, as /queue shows them.')
    expect((await queue($)).text).toBe('1. a\n2. c')
  })

  test('/queue alone shows the queue and the plan; nothing is sent', async ($, on) => {
    const { sent, clock } = world(on)
    await type($, '+ a')
    await $.tool.call({ tool: 'mcp__idea-queue__plan', steps: [{ title: 'One', prompt: 'Do one.' }] } as never)

    expect((await queue($)).text).toBe('1. a\n\nPlan (/queue run):\n1. [todo] One')
    await clock.advance(100)
    expect(sent).toEqual([])
  })

  test('an interrupted step stops the plan; a bad plan is refused', async ($, on) => {
    const { sent, toasts, clock } = world(on)
    expect((await $.tool.call({ tool: 'mcp__idea-queue__plan', steps: [] } as never)).deny).toContain('non-empty')
    await $.tool.call({ tool: 'mcp__idea-queue__plan', steps: STEPS } as never)

    expect((await queue($, 'run 3')).text).toBe('Running step 3: Three')
    await clock.advance(100)
    await $.turn.start({ text: sent[0]!, turnId: 's3' })
    expect((await queue($, 'run')).text).toBe('Step 3 is running. /queue stop stops after it.')
    await ends($, 's3', 'aborted')
    expect(toasts.at(-1)).toBe('Plan stopped: step 3 was interrupted')
    expect((await queue($)).text).toContain('1. [todo] One\n2. [todo] Two\n3. [todo] Three')
  })

  test('the band shows what waits and offers the next move', async ($, on) => {
    world(on)
    on('ui.render', { component: 'AbovePrompt' }, ($e, e) => {
      const { Text } = $e.ui.resolve(e)

      return <Text>engine</Text>
    })
    const band = async () => {
      const ui = await $.ui.mount({
        plugin: 'idea-queue',
        surface: 'terminal',
        component: 'AbovePrompt',
        props: { hasSurvey: false } as never,
        viewport: { columns: 120, rows: 30 },
      })
      const text = (await ui.find({ type: 'Text', text: /queue|engine/ }))?.text
      const button = (await ui.find({ key: 'queue' }))?.props.label
      await ui.unmount()

      return [text, button]
    }

    expect(await band()).toEqual(['engine', undefined])
    await type($, '+ x\n+? y')
    expect(await band()).toEqual(['queue: 1 idea, 1 comment · ', 'organize'])
    await queue($, 'plan')
    await $.tool.call({ tool: 'mcp__idea-queue__plan', steps: STEPS } as never)
    expect(await band()).toEqual(['queue: plan: 3 of 3 steps left · ', 'run plan'])
  })
})
