import { describe, expect, test } from 'claude-code/testing'

import { REPORT, REPORT_PATH, world } from './world'

const REPORT_FILES = { [REPORT_PATH]: REPORT }

describe('where a comment points', () => {
  test('a comment lands on the fragment copied from a file Claude wrote', async ($, on) => {
    const { write, queue, shown } = world($, on, { files: REPORT_FILES, clip: 'Revenue grew by 12% in the third quarter' })
    await write(REPORT_PATH)

    expect(await queue('+? where does this come from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (1 waiting)')
    expect(await shown()).toEqual([
      '1 comment waiting',
      '1 question where does this come from',
      '↳ docs/report.md:5 · "Revenue grew by 12% in the third quarter"',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions."',
    ])
  })

  test('a draft that ends with a mark takes what was copied too', async ($, on) => {
    const { write, queue, type, shown } = world($, on, { files: REPORT_FILES, clip: 'Revenue grew by 12% in the third quarter' })
    await write(REPORT_PATH)

    expect(await queue('where does this number come from +?')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (1 waiting)')
    expect(await type('and this one goes to Claude')).not.toEqual({ drop: 'queued' })
    expect(await shown()).toEqual([
      '1 comment waiting',
      '1 question where does this number come from',
      '↳ docs/report.md:5 · "Revenue grew by 12% in the third quarter"',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions."',
    ])
  })

  test('copied text that no file holds is kept loose, and the comment says so', async ($, on) => {
    const { queue, shown } = world($, on, { files: { '/proj/old.md': REPORT }, clip: 'nothing like this is written anywhere at all' })

    expect(await queue('+! make it shorter')).toBe(
      'queued ! "nothing like this is written…" - copied text not found in any .md file under /proj (1 waiting)',
    )
    expect(await shown()).toEqual(['1 comment waiting', '1 change make it shorter', '↳ not in a file · "nothing like this is written anywhere at all"'])
  })

  test('grep finds the copied text in a file from an earlier session, list numbers and all', async ($, on) => {
    const { w, queue } = world($, on, { files: { '/proj/old.md': REPORT }, clip: 'Costs stayed flat across all regions.', grep: '/proj/old.md\n' })

    expect(await queue('+- drop this')).toBe('queued - old.md:8 "Costs stayed flat across all…" (1 waiting)')
    w.clip = '1. Costs stayed flat\n2. across all regions.'
    expect(await queue('+? a list copied with its numbers')).toBe('queued ? old.md:8 "1. Costs stayed flat 2. acros…" (2 waiting)')
  })

  test('on a Mac, pbpaste reads the clipboard and a walk finds the file BSD grep cannot', async ($, on) => {
    const { queue } = world($, on, {
      files: { '/proj/notes/deep/old.md': REPORT, '/proj/node_modules/x/old.md': REPORT, '/proj/.git/old.md': REPORT },
      clip: 'Costs stayed flat across all regions.',
      system: 'mac',
    })

    expect(await queue('+- drop this')).toBe('queued - notes/deep/old.md:8 "Costs stayed flat across all…" (1 waiting)')
    expect(await queue('+? @old.md where')).toBe('queued ? notes/deep/old.md:8 "Costs stayed flat across all…" (2 waiting)')
  })

  test('on Linux, a clipboard reader that runs but fails gives way to the next one, and is asked again next time', async ($, on) => {
    const { w, runs, write, queue } = world($, on, { system: 'linux', readers: { 'wl-paste': 1, xclip: 0 }, files: REPORT_FILES, clip: 'Revenue grew by 12% in the third quarter' })
    await write(REPORT_PATH)

    expect(await queue('+? where does this come from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (1 waiting)')
    w.clip = 'Costs stayed flat across all regions.'
    expect(await queue('+? and this')).toBe('queued ? docs/report.md:8 "Costs stayed flat across all…" (2 waiting)')
    // Which reader is asked shows nowhere the person sees, so the commands run are checked.
    expect(runs.filter(name => !['git', 'grep'].includes(name))).toEqual(['powershell.exe', 'pbpaste', 'wl-paste', 'xclip', 'powershell.exe', 'pbpaste', 'wl-paste', 'xclip'])
  })

  test('on Linux, the first clipboard reader that works is kept for the session', async ($, on) => {
    const { w, runs, write, queue } = world($, on, { system: 'linux', readers: { 'wl-paste': 0, xclip: 0 }, files: REPORT_FILES, clip: 'Revenue grew by 12% in the third quarter' })
    await write(REPORT_PATH)

    await queue('+? where does this come from')
    w.clip = 'Costs stayed flat across all regions.'
    expect(await queue('+? and this')).toBe('queued ? docs/report.md:8 "Costs stayed flat across all…" (2 waiting)')
    // As above: the readers asked are seen only in the commands run.
    expect(runs.filter(name => !['git', 'grep'].includes(name))).toEqual(['powershell.exe', 'pbpaste', 'wl-paste', 'wl-paste'])
  })

  test('on WSL with no WSL_DISTRO_NAME, as over ssh, the clipboard is still read through powershell.exe', async ($, on) => {
    const { write, queue } = world($, on, { env: {}, files: REPORT_FILES, clip: 'Revenue grew by 12% in the third quarter' })
    await write(REPORT_PATH)

    expect(await queue('+? where does this come from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (1 waiting)')
  })

  test('with no clipboard reader installed, a comment says so rather than that nothing was copied', async ($, on) => {
    const { queue } = world($, on, { system: 'linux', readers: {} })

    expect(await queue('+? where from')).toBe('queued ? "where from" - no clipboard reader here (wl-clipboard, xclip or xsel) (1 waiting)')
  })

  test('grep that found the file but could not read some folder still pins the comment', async ($, on) => {
    // The file sits where the walk never goes, so only grep's own hit can find it.
    const files = { '/proj/.notes/old.md': REPORT }
    const { queue } = world($, on, { files, grep: '/proj/.notes/old.md\n', grepExit: 2, clip: 'Revenue grew by 12% in the third quarter' })

    expect(await queue('+? where from')).toBe('queued ? .notes/old.md:5 "Revenue grew by 12% in the th…" (1 waiting)')
  })

  test('a heading on the first line is found behind a byte-order mark', async ($, on) => {
    const { write, queue } = world($, on, { files: { [REPORT_PATH]: `\uFEFF${REPORT}` } })
    await write(REPORT_PATH)

    expect(await queue('+! #report shorter')).toBe('queued ! docs/report.md:1 (1 waiting)')
  })

  test('a comment names a Windows file by its drive, and /aside scan reads one, spaces and all', async ($, on) => {
    const files = { 'C:\\proj\\docs\\report.md': REPORT, 'C:\\notes\\todo.md': 'notes', '/proj/My Notes.md': '<!-- ? why this -->' }
    const { queue, aside, shown } = world($, on, { files })

    expect(await queue('+? @C:\\proj\\docs\\report.md:5 why')).toBe('queued ? C:/proj/docs/report.md:5 (1 waiting)')
    expect(await aside('scan C:\\notes\\todo.md')).toBe('C:/notes/todo.md: 0 tags; /aside includes the file from now on.')
    expect(await aside('scan My Notes.md')).toContain('My Notes.md')
    expect((await shown()).slice(-3)).toEqual(['Tags in files', '· question why this', '↳ My Notes.md:1'])
  })

  test('on Windows, a file is one file however its path is spelled: its tags show once, under its path in the project', async ($, on) => {
    const { write, queue, aside, shown } = world($, on, {
      system: 'windows',
      files: { 'C:\\proj\\docs\\report.md': REPORT },
      clip: 'Revenue grew by 12% in the third quarter',
    })
    await write('c:\\proj\\docs\\report.md')

    expect(await queue('+? where from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (1 waiting)')
    for (const name of ['docs\\report.md', 'C:/proj/docs/report.md', '.\\Docs\\Report.md', 'docs\\..\\docs\\report.md']) {
      expect(await aside(`scan ${name}`)).toBe('docs/report.md: 1 tag; /aside includes the file from now on.')
    }
    expect(await shown()).toEqual([
      '1 comment waiting',
      '1 question where from',
      '↳ docs/report.md:5 · "Revenue grew by 12% in the third quarter"',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions."',
    ])
  })

  test('on Windows, a file Claude writes under two letter cases is one file, shown as last written', async ($, on) => {
    const { write, shown } = world($, on, { system: 'windows', files: { 'C:\\proj\\docs\\report.md': REPORT } })
    await write('C:\\proj\\docs\\report.md')
    await write('C:\\proj\\Docs\\Report.md')

    expect(await shown()).toEqual([
      'The queue is empty.',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ Docs/Report.md:9 · "Costs stayed flat across all regions."',
    ])
  })

  test('on Windows, a file named by the end of its path is found in any letter case', async ($, on) => {
    const files = { 'C:\\proj\\docs\\report.md': REPORT, 'C:\\proj\\sub\\Notes.md': '# Notes' }
    const { write, queue } = world($, on, { system: 'windows', files })
    await write('C:\\proj\\docs\\report.md')

    expect(await queue('+? @Report.md:5 why')).toBe('queued ? docs/report.md:5 (1 waiting)')
    expect(await queue('+? @notes.md:1 and this')).toBe('queued ? sub/Notes.md:1 (2 waiting)')
  })

  test('on Windows, a project at the root of a drive shows its files by their path from there', async ($, on) => {
    const { write, queue, aside, shown } = world($, on, { system: 'windows', root: 'c:\\', files: { 'C:\\docs\\report.md': REPORT } })
    await write('C:\\docs\\report.md')

    expect(await aside('scan docs\\report.md')).toBe('docs/report.md: 1 tag; /aside includes the file from now on.')
    expect(await queue('+? @Report.md:5 why')).toBe('queued ? docs/report.md:5 (1 waiting)')
    expect(await shown()).toEqual([
      '1 comment waiting',
      '1 question why',
      '↳ docs/report.md:5',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions."',
    ])
  })

  test('on Windows, a project on a share shows its files by their path from there', async ($, on) => {
    const root = '\\\\host\\share\\proj'
    const { write, queue, aside } = world($, on, { system: 'windows', root, files: { [`${root}\\docs\\report.md`]: REPORT } })
    await write(`${root}\\docs\\report.md`)

    expect(await aside('scan .\\docs\\report.md')).toBe('docs/report.md: 1 tag; /aside includes the file from now on.')
    expect(await queue('+? @Docs\\Report.md:5 why')).toBe('queued ? docs/report.md:5 (1 waiting)')
  })

  test('a comment sent from a phone or the web is queued, without this machine\'s clipboard', async ($, on) => {
    const { runs, shown, fromPhone, idle } = world($, on, { clip: 'Revenue grew by 12% in the third quarter' })

    expect(await fromPhone('+ dark mode')).toEqual({ drop: 'queued' })
    expect(await fromPhone('+? where from')).toEqual({ drop: 'queued' })
    await idle()
    expect(runs.filter(name => !['git', 'grep'].includes(name))).toEqual([])
    expect((await shown()).slice(0, 3)).toEqual(['1 idea and 1 comment waiting', '1 idea dark mode', '2 question where from'])
  })

  test('with nothing copied, a comment points nowhere and says so', async ($, on) => {
    const { queue, shown } = world($, on)

    expect(await queue('+? and this')).toBe('queued ? "and this" - no text on the clipboard (1 waiting)')
    expect(await shown()).toEqual(['1 comment waiting', '1 question and this'])
  })

  test('a heading or a line named after the mark needs no clipboard', async ($, on) => {
    const { write, queue } = world($, on, { files: REPORT_FILES })
    await write(REPORT_PATH)

    expect(await queue('+- #zrodla')).toBe('queued - docs/report.md:11 (1 waiting)')
    expect(await queue('+? @docs/report.md:3 why this order')).toBe('queued ? docs/report.md:3 (2 waiting)')
    expect(await queue('+! @docs/report.md#results shorter')).toBe('queued ! docs/report.md:3 (3 waiting)')
    expect(await queue('@docs/report.md:5 where from +?')).toBe('queued ? docs/report.md:5 (4 waiting)')
    expect(await queue('+! #nowhere shorter')).toBe('queued ! #nowhere - no heading "nowhere" in the 1 files written this session (5 waiting)')
  })

  test('a comment that names only a place has no text of its own', async ($, on) => {
    const { write, queue, shown } = world($, on, { files: REPORT_FILES })
    await write(REPORT_PATH)

    expect(await queue('+- #zrodla')).toBe('queued - docs/report.md:11 (1 waiting)')
    expect((await shown()).slice(0, 3)).toEqual(['1 comment waiting', '1 drop (no text)', '↳ docs/report.md:11'])
  })

  test("a fresh copy comes first; with the clipboard unchanged, the selection in Claude's reply wins", async ($, on) => {
    const { w, write, queue, shown } = world($, on, {
      files: REPORT_FILES,
      clip: 'Costs stayed flat across all regions.',
      selection: 'Revenue grew by 12% in the third quarter',
    })
    await write(REPORT_PATH)

    expect(await queue('+? why flat')).toBe('queued ? docs/report.md:8 "Costs stayed flat across all…" (1 waiting)')
    expect(await queue('+? where from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (2 waiting)')
    w.selection = 'I chose the async path because the sync one blocks'
    await queue('+! use the sync path')
    expect(await shown()).toEqual([
      '3 comments waiting',
      '1 question why flat',
      '↳ docs/report.md:8 · "Costs stayed flat across all regions."',
      '2 question where from',
      '↳ docs/report.md:5 · "Revenue grew by 12% in the third quarter"',
      '3 change use the sync path',
      '↳ terminal · "I chose the async path because the sync one blocks"',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions."',
    ])
  })
})

describe('the tool output a comment comes with', () => {
  test('only what Bash and the edit tools printed counts, not a denial or a missing file', async ($, on) => {
    const { queue, shown, startTurn, endTurn } = world($, on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: '3 tests failed' }) as never)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'File does not exist', isError: true }) as never)
    await startTurn('test it', 't1')
    await $.tool.call({ tool: 'Read', file_path: '/proj/nope.md' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.tool.call({ tool: 'Read', file_path: '/proj/nope2.md' } as never)

    await queue('+? why')
    await endTurn('t1')
    expect(await shown()).toEqual(['1 comment waiting', '1 question why', '↳ after Bash · 3 tests failed'])
  })

  test('with nothing copied, a comment takes the last tool output of its turn, an error first', async ($, on) => {
    const { queue, shown, startTurn, endTurn } = world($, on)
    on('tool.call', { tool: 'Bash' }, ($e, e) => (e.command === 'fail' ? { result: 'exit 1: boom', isError: true } : { result: 'ok' }) as never)
    await startTurn('build it', 't1')
    await $.tool.call({ tool: 'Bash', command: 'fail' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pass' } as never)

    expect(await queue('+? why did it fail')).toBe('queued ? "why did it fail" - with the last tool output (1 waiting)')
    await endTurn('t1')
    expect(await shown()).toEqual(['1 comment waiting', '1 question why did it fail', '↳ after Bash failed · exit 1: boom'])

    await startTurn('next thing', 't2')
    expect(await queue('+? and now')).toBe('queued ? "and now" - no text on the clipboard (2 waiting)')
  })
})
