import { describe, expect, test } from 'claude-code/testing'

import { REPORT, REPORT_PATH, world } from './world'

describe('what is queued', () => {
  test('a message that starts with + is queued, and every line with + is an entry of its own', async ($, on) => {
    const { sent, type, shown } = world($, on)
    await type('+ add tests for the parser')
    await type('+ one\n\n+ two\n+three')
    await type('+ an idea\nwith a second line')

    expect(sent).toEqual([])
    expect(await shown()).toEqual([
      '5 ideas waiting',
      '1 idea add tests for the parser',
      '2 idea one',
      '3 idea two',
      '4 idea three',
      '5 idea an idea',
      'with a second line',
    ])
  })

  test('the mark after + names the kind; a plain idea keeps an @ as text', async ($, on) => {
    const { type, shown } = world($, on)
    await type('+? why\n+! as a table\n+- drop it\n++ dig into X\n+ @x.md plain')

    expect(await shown()).toEqual([
      '1 idea and 4 comments waiting',
      '1 question why',
      '2 change as a table',
      '3 drop drop it',
      '4 dig deeper dig into X',
      '5 idea @x.md plain',
    ])
  })

  test('a draft that ends with a mark is queued whole, as if the mark came first', async ($, on) => {
    const { sent, filled, type, aside, shown } = world($, on)
    await type('why is the build so slow +?')
    await type('a long draft\n- over two lines\n+')
    await type('look into the cache ++')

    expect(sent).toEqual([])
    expect(await shown()).toEqual([
      '1 idea and 2 comments waiting',
      '1 question why is the build so slow',
      '2 idea a long draft',
      '- over two lines',
      '3 dig deeper look into the cache',
    ])
    await aside('edit 1')
    await type(filled.at(-1)!)
    await aside('edit 2')
    expect(filled).toEqual(['+? why is the build so slow', '+ a long draft\n- over two lines'])
  })

  test('plain text, a + inside it and a mark with nothing after it go to Claude, and nothing is said', async ($, on) => {
    const { sent, toasts, logged, type, shown } = world($, on)
    const prompts = ['fix the build', 'a + b', 'I love C++', 'what is 2 + 2', '+?', '+   ']
    for (const text of prompts) await type(text)

    expect(sent).toEqual(prompts)
    expect(toasts).toEqual([])
    expect(logged).toEqual([])
    expect(await shown()).toEqual(['The queue is empty.'])
  })

  test('a pasted diff goes to Claude; a list under an idea, or a diff in a code block, does not make one', async ($, on) => {
    const { sent, type, shown } = world($, on)
    const diffs = ['+ added line\n-removed line\n context', '+++ b/file.ts\n+ x', '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+']
    for (const text of diffs) await type(text)
    await type('+ refactor the parser\n- split the lexer\n- add tests')
    await type('+ an idea\nmore about it\n-ish')
    await type('+? does this diff look right\n```diff\n--- a/x\n+++ b/x\n```')

    expect(sent).toEqual(diffs)
    expect(await shown()).toEqual([
      '2 ideas and 1 comment waiting',
      '1 idea refactor the parser',
      '- split the lexer',
      '- add tests',
      '2 idea an idea',
      'more about it',
      '-ish',
      '3 question does this diff look right',
      '```diff',
      '--- a/x',
      '+++ b/x',
      '```',
    ])
  })
})

describe('while an entry is on its way to the store', () => {
  test('an entry removed while the next one waits on git stays removed', async ($, on) => {
    const { w, clock, type, enter, aside, shown } = world($, on)
    await type('+ first')
    // The second entry waits for its branch while the first one is removed.
    let release = () => {}
    w.gitHeld = new Promise<void>(resolve => {
      release = resolve
    })
    await enter('+ second')
    await clock.advance(2)

    await aside('rm 1')
    release()
    await clock.settle()
    expect(await shown()).toEqual(['1 idea waiting', '1 idea second'])
  })

  test('entries handed over while the next one waits on git are not left in the queue too', async ($, on) => {
    const { w, clock, type, enter, aside, shown } = world($, on)
    await type('+ first')
    let release = () => {}
    w.gitHeld = new Promise<void>(resolve => {
      release = resolve
    })
    await enter('+ second')
    await clock.advance(2)

    expect(await aside('plan')).toBe('Organizing 1 idea.')
    release()
    await clock.settle()
    expect(await shown()).toEqual(['1 idea waiting', '1 idea second'])
    expect(await aside('undo')).toBe('Brought back 1 entry, 2 waiting.')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea first', '2 idea second'])
  })

  test('an entry typed as a hand-over starts lands in the queue, and undo brings back the rest', async ($, on) => {
    const { w, clock, type, enter, aside, shown } = world($, on)
    await type('+ first')
    // The hand-over's take is a moment on its way to the store, and the entry typed just before
    // it is stored meanwhile.
    w.beforeWrite = async key => {
      if (!key.startsWith('taken:')) return
      w.beforeWrite = undefined
      await clock.sleep(2)
    }
    await enter('+ second')
    const planning = aside('plan')
    await clock.settle()
    await clock.advance(5)

    expect(await planning).toBe('Organizing 1 idea.')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea second'])
    expect(await aside('undo')).toBe('Brought back 1 entry, 2 waiting.')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea first', '2 idea second'])
  })

  test('an entry typed as a clear starts lands in the queue, and undo brings back what was cleared', async ($, on) => {
    const { w, clock, type, enter, aside, shown } = world($, on)
    await type('+ first\n+ second')
    // The clear's take is a moment on its way to the store, as the hand-over's is above.
    w.beforeWrite = async key => {
      if (!key.startsWith('taken:')) return
      w.beforeWrite = undefined
      await clock.sleep(2)
    }
    await enter('+ third')
    const clearing = aside('clear')
    await clock.settle()
    await clock.advance(5)

    expect(await clearing).toBe('Cleared 2 entries. /aside undo brings them back.')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea third'])
    expect(await aside('undo')).toBe('Brought back 2 entries, 3 waiting.')
    expect(await shown()).toEqual(['3 ideas waiting', '1 idea first', '2 idea second', '3 idea third'])
  })

  test('an entry typed as /aside run 1 starts stays in the queue beside the rest', async ($, on) => {
    const { w, clock, type, enter, aside, shown } = world($, on)
    await type('+ first\n+ second')
    w.beforeWrite = async key => {
      if (!key.startsWith('taken:')) return
      w.beforeWrite = undefined
      await clock.sleep(2)
    }
    await enter('+ third')
    const running = aside('run 1')
    await clock.settle()
    await clock.advance(5)

    expect(await running).toBe('Running entry 1: first')
    expect((await shown()).slice(-3)).toEqual(['2 ideas waiting', '1 idea second', '2 idea third'])
  })

  test('an entry stored as a hand-over starts is handed over with the rest, and Claude is told of it', async ($, on) => {
    const { w, clock, sent, type, enter, aside, shown, idle } = world($, on)
    await type('+ first')
    // The second entry is a moment on its way to the store as the hand-over starts.
    w.beforeWrite = async key => {
      if (!key.startsWith('queue:')) return
      w.beforeWrite = undefined
      await clock.sleep(2)
    }
    await enter('+ second')
    await clock.advance(2)
    const planning = aside('plan')
    await clock.settle()
    await clock.advance(5)

    expect(await planning).toBe('Organizing 2 ideas.')
    await idle()
    expect(sent.at(-1)).toContain('1. first')
    expect(sent.at(-1)).toContain('2. second')
    expect(await shown()).toEqual(['The queue is empty.'])
  })

  test('an entry that waits long on git is still stored before the one sent after it', async ($, on) => {
    const { w, clock, enter, shown } = world($, on)
    // Only the first entry's branch is slow to come.
    let release = () => {}
    w.gitHeld = new Promise<void>(resolve => {
      release = resolve
    })
    await enter('+ one')
    await clock.advance(2)
    w.gitHeld = undefined
    await enter('+ two')
    await clock.advance(2)
    release()
    await clock.settle()

    expect(await shown()).toEqual(['2 ideas waiting', '1 idea one', '2 idea two'])
  })

  test('an entry sent back the moment /aside edit answers goes back to its place, though the store is slow to note it out', async ($, on) => {
    const { w, clock, enter, type, aside, shown, idle } = world($, on)
    await type('+ one\n+ two')
    w.beforeWrite = async key => {
      if (!key.startsWith('editing:')) return
      w.beforeWrite = undefined
      await clock.sleep(2)
    }
    const back = aside('edit 1').then(() => enter('+ one, reworked'))
    await clock.settle()
    await idle()
    await back
    await idle()

    expect(await shown()).toEqual(['2 ideas waiting', '1 idea one, reworked', '2 idea two'])
  })

  test('a message sent right after an entry back from /aside edit is a new entry, though the store is slow to forget the edit', async ($, on) => {
    const { w, clock, enter, type, aside, shown, idle } = world($, on)
    await type('+ one\n+ two')
    await aside('edit 1')
    w.beforeDelete = async key => {
      if (!key.startsWith('editing:')) return
      w.beforeDelete = undefined
      await clock.sleep(2)
    }
    await enter('+ one, reworked')
    await enter('+ three')
    await clock.settle()
    await idle()

    expect(await shown()).toEqual(['3 ideas waiting', '1 idea one, reworked', '2 idea two', '3 idea three'])
  })

  test('an entry typed as undo starts lands in the queue after what undo brings back', async ($, on) => {
    const { w, clock, type, enter, aside, shown } = world($, on)
    await type('+ first')
    await aside('clear')
    // Undo's write of the queue is a moment on its way to the store.
    w.beforeWrite = async key => {
      if (!key.startsWith('queue:')) return
      w.beforeWrite = undefined
      await clock.sleep(2)
    }
    await enter('+ second')
    const undoing = aside('undo')
    await clock.settle()
    await clock.advance(5)

    expect(await undoing).toBe('Brought back 1 entry, 2 waiting.')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea first', '2 idea second'])
  })
})

describe('the prompt box', () => {
  test('a queued entry never reaches Claude and leaves a line in the transcript, not a toast', async ($, on) => {
    const { sent, toasts, logged, queue } = world($, on)

    expect(await queue('+ dark mode')).toBe('queued "dark mode" · 1 waiting')
    expect(logged).toEqual(['queued "dark mode" · 1 waiting'])
    expect(toasts).toEqual([])
    expect(sent).toEqual([])
  })

  test('the transcript line quotes a long idea up to 30 characters', async ($, on) => {
    const { queue } = world($, on)

    expect(await queue('+ rename the loader and update every caller of it')).toBe('queued "rename the loader and update…" · 1 waiting')
  })

  test('Enter is answered at once, and two quick entries are both stored, in order', async ($, on) => {
    const { clock, shown } = world($, on)

    const first = $.prompt.submit({ text: '+ one', origin: { kind: 'composer' }, wait: false })
    const second = $.prompt.submit({ text: '+? two', origin: { kind: 'composer' }, wait: false })
    expect(await first).toEqual({ drop: 'queued' })
    expect(await second).toEqual({ drop: 'queued' })
    await clock.advance(5)
    await clock.settle()

    expect(await shown()).toEqual(['1 idea and 1 comment waiting', '1 idea one', '2 question two'])
  })

  test('a queued message leaves the box empty, but a new draft typed meanwhile stays', async ($, on) => {
    const { filled, clock, type } = world($, on)
    let box = ''
    on('prompt.read', () => ({ value: { text: box, cursor: box.length } }) as never)

    box = '+ dark mode'
    await type('+ dark mode')
    await clock.advance(50)
    expect(filled).toEqual([''])

    box = 'something new'
    await type('+ another')
    await clock.advance(50)
    expect(filled).toEqual([''])
  })

  test('the box the engine puts a queued message back into is emptied at once', async ($, on) => {
    const { filled, type } = world($, on)
    on('prompt.change', ($e, e) => ({ text: e.text }))
    await type('+ dark mode')
    // Raised as the engine raises it; the test kit's types leave this event out.
    const change = ($.prompt as unknown as { change: (e: unknown) => Promise<unknown> }).change

    await change({ text: 'something else', cursor: 0, origin: { kind: 'engine' } })
    expect(filled).toEqual([])
    await change({ text: '+ dark mode', cursor: 11, origin: { kind: 'engine' } })
    expect(filled).toEqual([''])
  })
})

describe('when the store refuses an entry', () => {
  test('a typed entry goes back into the empty prompt box, and stays there, and the transcript says why', async ($, on) => {
    const { w, filled, logged, type, shown, idle } = world($, on, { isStoreFull: true })
    on('prompt.read', () => ({ value: { text: filled.at(-1) ?? '', cursor: 0 } }) as never)

    expect(await type('+ dark mode for the pane')).toEqual({ drop: 'queued' })
    await idle()
    expect(filled).toEqual(['+ dark mode for the pane'])
    expect(logged.at(-1)).toBe('Could not queue "+ dark mode for the pane" (the store is full); it is back in the prompt box.')
    w.isStoreFull = false
    expect(await shown()).toEqual(['The queue is empty.'])
  })

  test('with a new draft in the box, the transcript line gives the entry whole', async ($, on) => {
    const { filled, logged, type } = world($, on, { isStoreFull: true })
    on('prompt.read', () => ({ value: { text: 'a new draft', cursor: 11 } }) as never)

    await type('+ a long idea\nwith a second line')
    expect(filled.filter(text => text !== '')).toEqual([])
    expect(logged.at(-1)).toBe('Could not queue this entry (the store is full); here it is to queue again:\n+ a long idea\nwith a second line')
  })

  test('an entry taken out with /aside edit stays taken until it is stored again', async ($, on) => {
    const { w, filled, type, aside, shown } = world($, on)
    on('prompt.read', () => ({ value: { text: '', cursor: 0 } }) as never)
    await type('+ one\n+ two')
    await aside('edit 1')
    expect(filled.at(-1)).toBe('+ one')

    w.isStoreFull = true
    await type('+ one, reworked')
    w.isStoreFull = false
    await type('+ one, reworked')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea one, reworked', '2 idea two'])
  })
})

describe('what an entry remembers', () => {
  test('an entry queued while Claude works names the task; one queued at an idle prompt does not', async ($, on) => {
    const { sent, type, aside, startTurn, endTurn, idle } = world($, on)
    await type('build the parser')
    await startTurn('build the parser', 't1')
    await type('+ dark mode', 't1')
    await aside('and its tests')
    await endTurn('t1')
    await type('+ rename the loader')
    await aside('and the docs')

    await aside('plan')
    await idle()
    expect(sent.at(-1)).toContain(
      [
        'Ideas:',
        '1. dark mode (while you worked on "build the parser", branch main)',
        '2. and its tests (while you worked on "build the parser", branch main)',
        '3. rename the loader (branch main)',
        '4. and the docs (branch main)',
      ].join('\n'),
    )
  })
})

describe('tidying what was typed', () => {
  test('an entry is queued as typed, then tidied; the copied quote is neither sent nor changed', async ($, on) => {
    const { asked, filled, write, type, aside, shown, idle } = world($, on, {
      files: { [REPORT_PATH]: REPORT },
      clip: 'Revenue grew by 12% in the third quarter',
      tidy: { 'moze zrobic moze nie': '<note>Może zrobić, może nie.</note>' },
    })
    await write(REPORT_PATH)
    await type('+? moze zrobic moze nie')
    await idle()

    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('moze zrobic moze nie')
    expect(asked[0]).not.toContain('Revenue')
    expect(await shown()).toEqual([
      '1 comment waiting',
      '1 question Może zrobić, może nie.',
      '↳ docs/report.md:5 · "Revenue grew by 12% in the third quarter"',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions."',
    ])
    await aside('edit 1')
    expect(filled).toEqual(['+? Może zrobić, może nie.'])
  })

  test('a reply that is not a correction is ignored, and the typed text stays', async ($, on) => {
    const answer = 'It is slow because the parser reads the whole config again on every call; cache it once at start-up.'
    const { type, shown, idle } = world($, on, { tidy: { 'why so slow': `<note>${answer}</note>`, 'dark mode': 'Dark mode.' } })
    await type('+ why so slow')
    await type('+ dark mode')
    await type('+ no reply for this one')
    await idle()

    expect(await shown()).toEqual(['3 ideas waiting', '1 idea why so slow', '2 idea dark mode', '3 idea no reply for this one'])
  })

  test('an entry gone from the queue before the reply comes is not brought back', async ($, on) => {
    const { w, type, aside, shown, idle } = world($, on, { tidy: { 'dark mode': '<note>Dark mode.</note>' } })
    w.meanwhile = () => aside('clear')
    await type('+ dark mode')
    await idle()

    expect(await shown()).toEqual(['The queue is empty.'])
  })

  test('an entry removed while a tidy reply is on its way to the store stays removed, and the tidied text is kept', async ($, on) => {
    const { w, clock, type, aside, shown, idle } = world($, on, { tidy: { 'dark mod': '<note>Dark mode.</note>' } })
    await type('+ fix the login bug')
    await idle()
    // The tidied text is a moment on its way to the store while the first entry is removed.
    let removing: Promise<string> | undefined
    w.meanwhile = async () => {
      w.meanwhile = undefined
      w.beforeWrite = async key => {
        if (!key.startsWith('queue:')) return
        w.beforeWrite = undefined
        removing = aside('rm 1')
        await clock.sleep(2)
      }
    }
    await type('+ dark mod')
    await idle()

    expect(await removing).toBe('Removed: fix the login bug')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea Dark mode.'])
  })

  test('an entry taken to edit while a tidy reply is on its way to the store goes back to its place, and the tidied text is kept', async ($, on) => {
    const { w, clock, filled, type, aside, shown, idle } = world($, on, { tidy: { 'dark mod': '<note>Dark mode.</note>' } })
    await type('+ fix the login bug')
    await idle()
    // The tidied text is a moment on its way to the store while the first entry is taken out.
    let editing: Promise<string> | undefined
    w.meanwhile = async () => {
      w.meanwhile = undefined
      w.beforeWrite = async key => {
        if (!key.startsWith('queue:')) return
        w.beforeWrite = undefined
        editing = aside('edit 1')
        await clock.sleep(2)
      }
    }
    await type('+ dark mod')
    await idle()

    expect(await editing).toBe('Entry 1 is in the prompt box: change it and press Enter; it goes back to place 1, still pointing where it did.')
    expect(filled).toEqual(['+ fix the login bug'])
    expect(await shown()).toEqual(['1 idea waiting', '1 idea Dark mode.'])
    await type('+ fix the login bug today')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea fix the login bug today', '2 idea Dark mode.'])
  })

  test('an entry popped while a tidy reply is on its way to the store stays out, and the tidied text is kept', async ($, on) => {
    const { w, clock, filled, type, aside, shown, idle } = world($, on, { tidy: { 'dark mod': '<note>Dark mode.</note>' } })
    await type('+ fix the login bug')
    await idle()
    // The tidied text is a moment on its way to the store while the first entry is popped.
    let popping: Promise<string> | undefined
    w.meanwhile = async () => {
      w.meanwhile = undefined
      w.beforeWrite = async key => {
        if (!key.startsWith('queue:')) return
        w.beforeWrite = undefined
        popping = aside('pop')
        await clock.sleep(2)
      }
    }
    await type('+ dark mod')
    await idle()

    expect(await popping).toBe('In the prompt box, ready to send: fix the login bug')
    expect(filled).toEqual(['fix the login bug'])
    expect(await shown()).toEqual(['1 idea waiting', '1 idea Dark mode.'])
  })

  test('entries moved while a tidy reply is on its way to the store keep their new places, and the tidied text is kept', async ($, on) => {
    const { w, clock, type, aside, shown, idle } = world($, on, { tidy: { 'dark mod': '<note>Dark mode.</note>' } })
    await type('+ fix the login bug')
    await type('+ write the docs')
    await idle()
    // The tidied text is a moment on its way to the store while the first two entries swap.
    let moving: Promise<string> | undefined
    w.meanwhile = async () => {
      w.meanwhile = undefined
      w.beforeWrite = async key => {
        if (!key.startsWith('queue:')) return
        w.beforeWrite = undefined
        moving = aside('move 2 1')
        await clock.sleep(2)
      }
    }
    await type('+ dark mod')
    await idle()

    await moving
    expect(await shown()).toEqual(['3 ideas waiting', '1 idea write the docs', '2 idea fix the login bug', '3 idea Dark mode.'])
  })

  test('with tidy off, nothing is sent to the model', { options: { tidy: 'off' } }, async ($, on) => {
    const { asked, type, shown, idle } = world($, on, { tidy: { 'dark mode': '<note>Dark mode.</note>' } })
    await type('+ dark mode')
    await idle()

    expect(asked).toEqual([])
    expect(await shown()).toEqual(['1 idea waiting', '1 idea dark mode'])
  })
})
