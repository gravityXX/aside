import { describe, expect, test } from 'claude-code/testing'

import { world } from './world'

describe('the global list', () => {
  test('+g puts an idea on the global list: /aside leaves it out, /aside g shows it, the band reminds of it', async ($, on) => {
    const { type, queue, aside, shown, band } = world($, on)
    await type('+ local work')

    expect(await queue('+g read the RFC')).toBe('queued "read the RFC" to the global list · 1 global')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea local work'])
    expect(await aside('g')).toBe(['1 idea on the global list', '', '  1  idea  read the RFC'].join('\n'))
    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 1 idea, 1 in another queue · ')
  })

  test('a draft that ends with +g, /aside g TEXT and a +g line among others go there too; "+go" stays an idea here', async ($, on) => {
    const { type, queue, aside, shown } = world($, on)

    expect(await queue('read it later +g')).toBe('queued "read it later" to the global list · 1 global')
    expect(await aside('g write the post')).toBe('queued "write the post" to the global list · 2 global')
    expect(await queue('+ fix the build\n+g learn Rust')).toBe('queued "fix the build" · 1 waiting; queued "learn Rust" to the global list · 3 global')
    await type('+go home')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea fix the build', '2 idea go home'])
    expect((await aside('g')).split('\n').slice(2)).toEqual(['  1  idea  read it later', '  2  idea  write the post', '  3  idea  learn Rust'])
  })

  test('/aside g here moves global ideas to the end of the queue, and /aside g add moves ideas back; a comment stays', async ($, on) => {
    const { type, aside, shown } = world($, on)
    await type('+g a\n+g b\n+g c')
    await type('+ x\n+? y')

    expect(await aside('g here 1 3')).toBe('Moved here 2 ideas: a; c (4 waiting)')
    expect(await shown()).toEqual(['3 ideas and 1 comment waiting', '1 idea x', '2 question y', '3 idea a', '4 idea c'])
    expect(await aside('g add 2')).toBe('Only ideas go to the global list; 2 is a comment.')
    expect(await aside('g add 1 4')).toBe('Moved to the global list 2 ideas: x; c')
    expect(await shown()).toEqual(['1 idea and 1 comment waiting', '1 question y', '2 idea a'])
    expect((await aside('g')).split('\n').slice(2)).toEqual(['  1  idea  b', '  2  idea  x', '  3  idea  c'])
  })

  test('remove, move, pop and edit work on the global list with the sign g, in any letter case', async ($, on) => {
    const { filled, type, queue, aside } = world($, on)
    await type('+g a\n+g b\n+g c\n+g d\n+g e')

    expect((await aside('g move 3 1')).split('\n').slice(2)).toEqual(['  1  idea  c', '  2  idea  a', '  3  idea  b', '  4  idea  d', '  5  idea  e'])
    expect(await aside('g Remove 2 3')).toBe('Removed from the global list 2 ideas: a; b')
    expect(await aside('g pop')).toBe('In the prompt box, ready to send: c')
    expect(await aside('g edit 1')).toBe('Global idea 1 is in the prompt box: change it and press Enter; it goes back to place 1.')
    expect(filled).toEqual(['c', '+g d'])
    expect(await aside('g')).toBe(['1 idea on the global list', '', '  1  idea  e'].join('\n'))
    expect(await queue('+g d, sharper')).toBe('queued "d, sharper" to the global list · 2 global')
    expect((await aside('g')).split('\n').slice(2)).toEqual(['  1  idea  d, sharper', '  2  idea  e'])
  })

  test('an idea out with g edit waits for a message of one +g idea, and comes back across a reload', async ($, on) => {
    const { type, queue, aside, fromAnotherSession } = world($, on)
    await type('+g a\n+g b')
    await aside('g edit 1')
    await type('+g x\n+g y')
    expect((await aside('g')).split('\n').slice(2)).toEqual(['  1  idea  b', '  2  idea  x', '  3  idea  y'])
    await fromAnotherSession('unrelated', 'value')

    expect(await queue('+g a, sharper')).toBe('queued "a, sharper" to the global list · 4 global')
    expect((await aside('g')).split('\n').slice(2)).toEqual(['  1  idea  a, sharper', '  2  idea  b', '  3  idea  x', '  4  idea  y'])
  })

  test('a move between ideas of one message is the order stored, and many ideas keep the order typed', async ($, on) => {
    const { type, aside } = world($, on)
    await type('+g a\n+g b\n+g c')
    await aside('g move 1 2')
    expect((await aside('g')).split('\n').slice(2)).toEqual(['  1  idea  b', '  2  idea  a', '  3  idea  c'])

    await type(Array.from({ length: 12 }, (_, i) => `+g n${i + 1}`).join('\n'))
    expect((await aside('g')).split('\n').slice(-12).map(line => line.trim().split(/\s+/).at(-1))).toEqual(Array.from({ length: 12 }, (_, i) => `n${i + 1}`))
  })

  test('a move between ideas another session added at one moment is the order stored too', async ($, on) => {
    const { aside, fromAnotherSession } = world($, on)
    for (const [n, text] of ['p', 'q', 'r'].entries()) await fromAnotherSession(`global:idea:1000:session-2:${n}`, { text, at: 1000, kind: 'idea' })

    await aside('g move 1 2')
    expect((await aside('g')).split('\n').slice(2)).toEqual(['  1  idea  q', '  2  idea  p', '  3  idea  r'])
  })

  test('a message is kept whole or not at all: a store that refuses half-way leaves nothing behind', async ($, on) => {
    const { w, type, aside, shown } = world($, on)
    w.refuseWrite = 2
    await type('+ x\n+g y')
    expect(await shown()).toEqual(['The queue is empty.'])
    expect(await aside('g')).toBe('The global list is empty. Start a message with "+g" to add an idea to it.')

    w.refuseWrite = 2
    await type('+g a\n+g b')
    expect(await aside('g')).toBe('The global list is empty. Start a message with "+g" to add an idea to it.')
  })

  test('moving an idea that is already in the other place adds it there once, as after a move cut short', async ($, on) => {
    const idea = { text: 'dark mode', at: 1000, kind: 'idea' }
    const { aside, shown, fromAnotherSession } = world($, on, { stored: { 'queue:/proj': [idea] } })
    await fromAnotherSession('global:idea:1000:session-2:0', idea)

    expect(await aside('g here 1')).toBe('Moved here: dark mode (1 waiting)')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea dark mode'])
    await fromAnotherSession('global:idea:1000:session-2:0', idea)
    await aside('g add 1')
    expect(await aside('g')).toBe(['1 idea on the global list', '', '  1  idea  dark mode'].join('\n'))
  })

  test('an idea out with /aside edit and sent as +g has moved to the global list', async ($, on) => {
    const { type, aside, shown } = world($, on)
    await type('+ a\n+ b')
    await aside('edit 1')
    await type('+g a')
    await type('+ c')

    expect(await shown()).toEqual(['2 ideas waiting', '1 idea b', '2 idea c'])
    expect(await aside('g')).toBe(['1 idea on the global list', '', '  1  idea  a'].join('\n'))
  })

  test('an idea moved here is edited as one of the queue, and the list shows at once while Claude works', async ($, on) => {
    const { filled, logged, type, aside, startTurn, pane } = world($, on)
    await type('+g read the RFC')
    await aside('g here 1')
    await aside('edit 1')
    expect(filled.at(-1)).toBe('+ read the RFC')

    await type('+g learn Rust')
    await startTurn('build the parser', 't1')
    expect(await aside('g')).toBe('Opened the global list in the pane while Claude was working.')
    const ui = await pane()
    expect((await ui.find({ type: 'Text', text: '1 idea on the global list' }))?.text).toBe('1 idea on the global list')
    expect((await ui.find({ type: 'Text', text: 'learn Rust' }))?.text).toBe('learn Rust')
    // Only the lines that say what was queued go into the transcript, no list.
    expect(logged.filter(line => line.includes('\n'))).toEqual([])
    await ui.unmount()
  })

  test('plan and run take only this project\'s queue', async ($, on) => {
    const { sent, type, aside, idle } = world($, on)
    await type('+g far away\n+ near')

    expect(await aside('plan')).toBe('Organizing 1 idea.')
    await idle()
    expect(sent.at(-1)).toContain('1. near')
    expect(sent.at(-1)).not.toContain('far away')
  })

  test('ideas another session adds at the same moment stay apart from this one\'s', async ($, on) => {
    const { type, aside, fromAnotherSession } = world($, on)
    await fromAnotherSession('global:idea:1000:session-2:0', { text: 'from elsewhere', at: 1000, kind: 'idea' })
    await type('+g mine')
    await type('+g mine too')

    expect((await aside('g')).split('\n').slice(2)).toEqual(['  1  idea  from elsewhere', '  2  idea  mine', '  3  idea  mine too'])
  })

  test('an empty list, and a number it does not have, say so', async ($, on) => {
    const { type, aside } = world($, on)

    expect(await aside('g')).toBe('The global list is empty. Start a message with "+g" to add an idea to it.')
    expect(await aside('g here 1')).toBe('The global list is empty. Start a message with "+g" to add an idea to it.')
    await type('+g a')
    expect(await aside('g here 5')).toBe('Give a number from 1 to 1, as /aside g shows them.')
    expect(await aside('g remove 1 7')).toBe('Give numbers from 1 to 1, as /aside g shows them.')
  })

  test('a global idea is tidied as it is stored', async ($, on) => {
    const { aside, type, idle } = world($, on, { tidy: { 'read teh rfc': '<note>Read the RFC.</note>' } })
    await type('+g read teh rfc')
    await idle()

    expect((await aside('g')).split('\n').at(-1)).toBe('  1  idea  Read the RFC.')
  })

  test('an idea moved here while a tidy reply is on its way to the store stays in the queue beside the tidied one', async ($, on) => {
    const { w, clock, type, aside, shown, idle } = world($, on, { tidy: { 'dark mod': '<note>Dark mode.</note>' } })
    await type('+g read it later')
    await idle()
    // The tidied text is a moment on its way to the store while the global idea is moved here.
    let moving: Promise<string> | undefined
    w.meanwhile = async () => {
      w.meanwhile = undefined
      w.beforeWrite = async key => {
        if (!key.startsWith('queue:')) return
        w.beforeWrite = undefined
        moving = aside('g here 1')
        await clock.sleep(2)
      }
    }
    await type('+ dark mod')
    await idle()

    expect(await moving).toBe('Moved here: read it later (2 waiting)')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea Dark mode.', '2 idea read it later'])
    expect(await aside('g')).toBe('The global list is empty. Start a message with "+g" to add an idea to it.')
  })

  test('an idea moved to the global list while a tidy reply is on its way to the store leaves the queue', async ($, on) => {
    const { w, clock, type, aside, shown, idle } = world($, on, { tidy: { 'dark mod': '<note>Dark mode.</note>' } })
    await type('+ read it later')
    await idle()
    let moving: Promise<string> | undefined
    w.meanwhile = async () => {
      w.meanwhile = undefined
      w.beforeWrite = async key => {
        if (!key.startsWith('queue:')) return
        w.beforeWrite = undefined
        moving = aside('g add 1')
        await clock.sleep(2)
      }
    }
    await type('+ dark mod')
    await idle()

    expect(await moving).toBe('Moved to the global list: read it later')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea Dark mode.'])
    expect(await aside('g')).toBe(['1 idea on the global list', '', '  1  idea  read it later'].join('\n'))
  })

  test('a move the store refuses on the side it goes to leaves the idea where it was, here or on the global list', async ($, on) => {
    const { w, type, aside, shown } = world($, on)
    await type('+g read the RFC')
    w.refuseWriteTo = 'queue:'
    expect(await aside('g here 1')).toBe('/aside g here 1 did not finish (the store is full). /aside shows where the queue and the plan stand.')
    expect(await shown()).toEqual(['The queue is empty.'])
    expect(await aside('g')).toBe(['1 idea on the global list', '', '  1  idea  read the RFC'].join('\n'))

    await type('+ dark mode')
    w.refuseWriteTo = 'global:idea:'
    expect(await aside('g add 1')).toBe('/aside g add 1 did not finish (the store is full). /aside shows where the queue and the plan stand.')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea dark mode'])
    expect(await aside('g')).toBe(['1 idea on the global list', '', '  1  idea  read the RFC'].join('\n'))
  })
})

describe('named queues', () => {
  test('+@work puts an idea in the queue work, made by its first idea: /aside leaves it out, /aside q work shows it, the band counts it', async ($, on) => {
    const { type, queue, aside, shown, band } = world($, on)
    await type('+ local work')

    expect(await queue('+@work write the report')).toBe('queued "write the report" to @work, a new queue for every project; /aside q work local keeps it for this one')
    expect(await queue('+@Work call the bank')).toBe('queued "call the bank" to @work · 2 in @work')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea local work'])
    expect(await aside('q work')).toBe(['2 ideas in @work', '', '  1  idea  write the report', '  2  idea  call the bank'].join('\n'))
    expect(await aside('q @WORK')).toBe(await aside('q work'))
    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 1 idea, 2 in another queue · ')
  })

  test('a draft that ends with +@work, /aside q work TEXT and lines among others go there too', async ($, on) => {
    const { queue, aside, shown } = world($, on)

    expect(await queue('read it later +@work')).toBe('queued "read it later" to @work, a new queue for every project; /aside q work local keeps it for this one')
    expect(await aside('q work send the invoice')).toBe('queued "send the invoice" to @work · 2 in @work')
    expect(await queue('+ fix the build\n+@home water the plants\n+g learn Rust\n+@work book the room')).toBe(
      'queued "fix the build" · 1 waiting; queued "water the plants" to @home, a new queue for every project; /aside q home local keeps it for this one; queued "learn Rust" to the global list · 1 global; queued "book the room" to @work · 3 in @work',
    )
    expect(await shown()).toEqual(['1 idea waiting', '1 idea fix the build'])
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  read it later', '  2  idea  send the invoice', '  3  idea  book the room'])
  })

  test('+@ is a queue only before a name and a space: a comment\'s @file, a longer word and a bare @ stay as they are', async ($, on) => {
    const { w, write, type, aside, shown } = world($, on, { files: { '/proj/docs/report.md': '# Report\n\nThe total.\n' } })
    await write('/proj/docs/report.md')
    w.clip = ''
    await type("+@john's idea")
    await type('+@a-name-longer-than-twenty x')
    await type('+@ alone')
    await type('+? @docs/report.md:3 why')

    expect(await shown()).toEqual([
      '3 ideas and 1 comment waiting',
      "1 idea @john's idea",
      '2 idea @a-name-longer-than-twenty x',
      '3 idea @ alone',
      '4 question why',
      '↳ docs/report.md:3',
    ])
    expect(await aside('q')).toBe('The global list and the named queues are empty. Start a message with "+@work" to add an idea to the queue work, or with "+g" to the global list.')
  })

  test('+@global is the global list, and /aside q global works as /aside g does', async ($, on) => {
    const { queue, aside } = world($, on)

    expect(await queue('+@global read the RFC')).toBe('queued "read the RFC" to the global list · 1 global')
    expect(await aside('q global')).toBe(await aside('g'))
    expect(await aside('q global here 1')).toBe('Moved here: read the RFC (1 waiting)')
  })

  test('/aside q lists every queue for no project with its newest idea: the global list first, then the one added to last', async ($, on) => {
    const { type, aside, band } = world($, on)
    await type('+@work a')
    await type('+@home b')
    await type('+g c')
    await type('+@work d')

    expect(await aside('q')).toBe(["3 queues beside this project's queue", '', 'global · 1 idea', '', '  1  idea  c', '', '@work · 2 ideas', '', '  1  idea  a', '  2  idea  d', '', '@home · 1 idea', '', '  1  idea  b'].join('\n'))
    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 4 in other queues · ')
  })

  test('here, add, remove, move and pop work on a named queue as on the global list', async ($, on) => {
    const { filled, type, aside, shown } = world($, on)
    await type('+@work a\n+@work b\n+@work c')
    await type('+ x\n+? y')

    expect(await aside('q work here 1')).toBe('Moved here: a (3 waiting)')
    expect(await aside('q work add 2')).toBe('Only ideas go to @work; 2 is a comment.')
    expect(await aside('q work add 1')).toBe('Moved to @work: x')
    expect((await aside('q work move 3 1')).split('\n').slice(2)).toEqual(['  1  idea  x', '  2  idea  b', '  3  idea  c'])
    expect(await aside('q work remove 2')).toBe('Removed from @work: b')
    expect(await aside('q work pop')).toBe('In the prompt box, ready to send: x')
    expect(filled).toEqual(['x'])
    expect(await shown()).toEqual(['1 idea and 1 comment waiting', '1 question y', '2 idea a'])
    expect(await aside('q work here 5')).toBe('Give a number from 1 to 1, as /aside q work shows them.')
    expect(await aside('q home')).toBe('@home is empty. Start a message with "+@home" to add an idea to it.')
  })

  test('an idea out with q edit comes back to its place as +@work, or moves to the queue its new mark names', async ($, on) => {
    const { filled, type, queue, aside } = world($, on)
    await type('+@work a\n+@work b')

    expect(await aside('q work edit 1')).toBe('Idea 1 of @work is in the prompt box: change it and press Enter; it goes back to place 1.')
    expect(filled).toEqual(['+@work a'])
    expect(await queue('+@work a, sharper')).toBe('queued "a, sharper" to @work · 2 in @work')
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  a, sharper', '  2  idea  b'])

    await aside('q work edit 1')
    expect(await queue('+@home a, at home')).toBe('queued "a, at home" to @home, a new queue for every project; /aside q home local keeps it for this one')
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  b'])
    await type('+@work c')
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  b', '  2  idea  c'])
  })

  test('an idea edited out of a queue it was alone in comes back to that queue, not to a new one', async ($, on) => {
    const { queue, aside } = world($, on)
    await queue('+@solo a')
    await aside('q solo edit 1')

    expect(await queue('+@solo a, sharper')).toBe('queued "a, sharper" to @solo · 1 in @solo')
  })

  test('an idea sent back after q edit, or brought back by undo, never writes over another idea at its old key', async ($, on) => {
    const { queue, aside, fromAnotherSession } = world($, on)
    // Added by the command at the clock's 1000, so its key is named:office:idea:1000:session-1:0.
    await aside('q office b')
    await aside('q office edit 1')
    // An idea this session wrote since, under the key the edited one left.
    await fromAnotherSession('named:office:idea:1000:session-1:0', { text: 'a', at: 1000, kind: 'idea' })
    await queue('+@office b, sharper')
    expect((await aside('q office')).split('\n').slice(2)).toEqual(['  1  idea  a', '  2  idea  b, sharper'])

    await aside('q office clear')
    await fromAnotherSession('named:office:idea:1000:session-1:0', { text: 'c', at: 1000, kind: 'idea' })
    expect(await aside('q office undo')).toBe('Brought back 2 ideas to @office (3 in @office).')
    expect((await aside('q office')).split('\n').slice(2)).toEqual(['  1  idea  c', '  2  idea  b, sharper', '  3  idea  a'])
  })

  test('an entry out with /aside edit and sent as +@work has moved to that queue', async ($, on) => {
    const { type, aside, shown } = world($, on)
    await type('+ a\n+ b')
    await aside('edit 1')
    await type('+@work a')
    await type('+ c')

    expect(await shown()).toEqual(['2 ideas waiting', '1 idea b', '2 idea c'])
    expect(await aside('q work')).toBe(['1 idea in @work', '', '  1  idea  a'].join('\n'))
  })

  test('an idea moved here from a named queue is edited as one of the queue', async ($, on) => {
    const { filled, type, aside } = world($, on)
    await type('+@work read the RFC')
    await aside('q work here 1')

    await aside('edit 1')
    expect(filled.at(-1)).toBe('+ read the RFC')
  })

  test('/aside q work clear empties the queue, which then is gone, and undo brings it back once', async ($, on) => {
    const { type, aside, band } = world($, on)
    await type('+@work a\n+@work b')

    expect(await aside('q work clear')).toBe('Cleared 2 ideas from @work. /aside q work undo brings them back.')
    expect(await aside('q')).toBe('The global list and the named queues are empty. Start a message with "+@work" to add an idea to the queue work, or with "+g" to the global list.')
    expect(await aside('q home undo')).toBe('Nothing to bring back to @home.')
    expect(await aside('q work undo')).toBe('Brought back 2 ideas to @work (2 in @work).')
    expect(await aside('q work undo')).toBe('Nothing to bring back to @work.')
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  a', '  2  idea  b'])
    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 2 in another queue · ')
    await type('+g x')
    expect(await aside('g clear')).toBe('Cleared 1 idea from the global list. /aside g undo brings it back.')
    expect(await aside('g undo')).toBe('Brought back 1 idea to the global list (1 global).')
  })

  test('/aside q work rename moves it all to a new name, or into a queue that has one, and the global list keeps its name', async ($, on) => {
    const { type, aside } = world($, on)
    await type('+@work a\n+@work b')
    await type('+@job c')

    expect(await aside('q work rename office')).toBe('@work is now @office: 2 ideas.')
    expect(await aside('q work')).toBe('@work is empty. Start a message with "+@work" to add an idea to it.')
    expect(await aside('q office rename @Job')).toBe('Moved 2 ideas from @office to @job, which now has 3.')
    expect((await aside('q job')).split('\n').slice(2)).toEqual(['  1  idea  a', '  2  idea  b', '  3  idea  c'])
    expect(await aside('q job rename job')).toBe('@job has that name already.')
    expect(await aside('q job rename no/slash')).toBe('A queue\'s name has letters, digits, "-" and "_", at most 20 of them: /aside q job rename office')
    await type('+g x')
    expect(await aside('q global rename other')).toBe('The global list keeps its name; /aside g here N ... moves its ideas into this queue.')
    expect(await aside('q no/slash')).toBe('A queue\'s name has letters, digits, "-" and "_", at most 20 of them: /aside q work')
  })

  test('a rename run again after one cut short moves each idea once, and one the store refuses moves none', async ($, on) => {
    const { w, aside, fromAnotherSession } = world($, on)
    await fromAnotherSession('named:work:idea:900:session-1:0', { text: 'a', at: 900, kind: 'idea' })
    await fromAnotherSession('named:work:idea:900:session-1:1', { text: 'b', at: 900, kind: 'idea' })
    // A rename cut short after its first write left the copy of a there.
    await fromAnotherSession('named:job:idea:900:session-1:0', { text: 'a', at: 900, kind: 'idea' })

    expect(await aside('q work rename job')).toBe('Moved 2 ideas from @work to @job, which now has 2.')
    expect((await aside('q job')).split('\n').slice(2)).toEqual(['  1  idea  a', '  2  idea  b'])

    w.refuseWrite = 2
    expect(await aside('q job rename home')).toMatch(/^\/aside q job rename home did not finish/)
    expect((await aside('q job')).split('\n').slice(2)).toEqual(['  1  idea  a', '  2  idea  b'])
    expect(await aside('q home')).toBe('@home is empty. Start a message with "+@home" to add an idea to it.')
  })

  test('ideas another session adds to a named queue show here, and a rename takes them too', async ($, on) => {
    const { type, aside, fromAnotherSession } = world($, on)
    await fromAnotherSession('named:work:idea:1000:session-2:0', { text: 'from elsewhere', at: 1000, kind: 'idea' })
    await type('+@work mine')

    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  from elsewhere', '  2  idea  mine'])
    await aside('q work rename job')
    expect((await aside('q job')).split('\n').slice(2)).toEqual(['  1  idea  from elsewhere', '  2  idea  mine'])
  })

  test('each queue keeps its own undo: clearing a second does not end the first one\'s', async ($, on) => {
    const { type, aside } = world($, on)
    await type('+@work a\n+@work b')
    await type('+@home c')

    await aside('q work clear')
    await aside('q home clear')
    expect(await aside('q work undo')).toBe('Brought back 2 ideas to @work (2 in @work).')
    expect(await aside('q home undo')).toBe('Brought back 1 idea to @home (1 in @home).')
  })

  test('a second clear of a queue takes the place of the first in what undo brings back', async ($, on) => {
    const { type, aside } = world($, on)
    await type('+@work a\n+@work b')
    await aside('q work clear')
    await type('+@work c')
    await aside('q work clear')

    expect(await aside('q work undo')).toBe('Brought back 1 idea to @work (1 in @work).')
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  c'])
  })

  test('a clear the store refuses keeps the queue whole, and an undo cut short, run again, brings each idea back once', async ($, on) => {
    const { w, type, aside } = world($, on)
    await type('+@work a\n+@work b')
    w.refuseWrite = 1
    expect(await aside('q work clear')).toMatch(/^\/aside q work clear did not finish/)
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  a', '  2  idea  b'])

    await aside('q work clear')
    w.refuseWrite = 2
    expect(await aside('q work undo')).toMatch(/^\/aside q work undo did not finish/)
    expect(await aside('q work undo')).toBe('Brought back 1 idea to @work (2 in @work).')
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  a', '  2  idea  b'])
  })

  test('an undo cut short leaves out of its second run what its first brought back, even once it changed', async ($, on) => {
    const { w, type, queue, aside } = world($, on)
    await type('+@work a\n+@work b')
    await aside('q work clear')
    w.refuseWrite = 2
    await aside('q work undo')

    await aside('q work edit 1')
    await queue('+@work a, sharper')
    expect(await aside('q work undo')).toBe('Brought back 1 idea to @work (2 in @work).')
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  a, sharper', '  2  idea  b'])
  })

  test('a tidy that lands as its idea is taken out with q edit does not bring a second copy back', async ($, on) => {
    const { w, clock, type, queue, aside, idle } = world($, on, { tidy: { 'read teh rfc': '<note>Read the RFC.</note>' } })
    // The idea's first write is the message's; its second, the tidy's.
    let writes = 0
    w.beforeWrite = async key => {
      if (!key.startsWith('named:work:idea:') || ++writes < 2) return
      w.beforeWrite = undefined
      void aside('q work edit 1')
      await clock.settle()
    }
    await type('+@work read teh rfc')
    await idle()
    expect(writes).toBe(2)

    await queue('+@work read the RFC first')
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  read the RFC first'])
  })

  test('a message of several ideas for a queue whose only idea is out with q edit does not call it new', async ($, on) => {
    const { queue, aside } = world($, on)
    await queue('+@solo a')
    await aside('q solo edit 1')

    expect(await queue('+@solo b\n+@solo c')).toBe('queued 2 ideas to @solo · 2 in @solo')
  })

  test('the band sums the ideas of every other queue into one count, and /aside q lists them, the one added to last first', async ($, on) => {
    const { type, aside, band } = world($, on)
    await type('+@a one')
    await type('+@b one\n+@b two')
    await type('+@c one')
    await type('+@d one')

    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 5 in other queues · ')
    expect((await aside('q')).split('\n').filter(line => line.startsWith('@'))).toEqual(['@d · 1 idea', '@c · 1 idea', '@b · 2 ideas', '@a · 1 idea'])
  })

  test('/aside q shows the first three ideas of a queue, and says how to see them all', async ($, on) => {
    const { type, aside } = world($, on)
    await type('+@work a\n+@work b\n+@work c\n+@work d')
    await type('+g e')

    expect(await aside('q')).toBe(
      ["2 queues beside this project's queue", '', 'global · 1 idea', '', '  1  idea  e', '', '@work · 4 ideas', '', '  1  idea  a', '  2  idea  b', '  3  idea  c', '', '/aside q NAME lists all the ideas of a queue.'].join('\n'),
    )
  })

  test('/aside q adds no line when every queue shows all its ideas', async ($, on) => {
    const { type, aside } = world($, on)
    await type('+@work a\n+@work b\n+@work c')

    expect((await aside('q')).split('\n').at(-1)).toBe('  3  idea  c')
  })

  test('/aside q work add makes @work the queue added to last', async ($, on) => {
    const { type, aside, band } = world($, on)
    await type('+ x')
    await type('+@work a')
    await type('+@home b')
    await aside('q work add 1')

    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 3 in other queues · ')
    expect((await aside('q')).split('\n')[2]).toBe('@work · 2 ideas')
  })

  test('a queue whose name starts another\'s holds only its own ideas', async ($, on) => {
    const { type, aside } = world($, on)
    await type('+@work a\n+@work-2 b\n+@workshop c')

    expect(await aside('q work')).toBe(['1 idea in @work', '', '  1  idea  a'].join('\n'))
    expect(await aside('q work clear')).toBe('Cleared 1 idea from @work. /aside q work undo brings it back.')
    expect(await aside('q work-2')).toBe(['1 idea in @work-2', '', '  1  idea  b'].join('\n'))
    expect(await aside('q workshop')).toBe(['1 idea in @workshop', '', '  1  idea  c'].join('\n'))
  })

  test('a name of 20 characters makes a queue, one of 21 stays the idea\'s text', async ($, on) => {
    const { type, aside, shown } = world($, on)
    await type('+@abcdefghijklmnopqrst x')
    await type('+@abcdefghijklmnopqrstu y')

    expect(await shown()).toEqual(['1 idea waiting', '1 idea @abcdefghijklmnopqrstu y'])
    expect(await aside('q abcdefghijklmnopqrst')).toBe(['1 idea in @abcdefghijklmnopqrst', '', '  1  idea  x'].join('\n'))
  })

  test('/aside q and /aside q work show at once while Claude works on a narrow terminal', async ($, on) => {
    const { logged, type, aside, startTurn } = world($, on, { isNarrow: true })
    await type('+@work a')
    await startTurn('build the parser', 't1')

    expect(await aside('q')).toBe('Wrote the queues above while Claude was working.')
    expect(logged.at(-1)).toBe(["1 queue beside this project's queue", '', '@work · 1 idea', '', '  1  idea  a'].join('\n'))
    expect(await aside('q work')).toBe('Wrote @work above while Claude was working.')
    expect(logged.at(-1)).toBe(['1 idea in @work', '', '  1  idea  a'].join('\n'))
  })

  test('/aside run runs only this project\'s queue, and the named one keeps its idea', async ($, on) => {
    const { sent, type, aside, idle } = world($, on)
    await type('+@work far away\n+ near')

    expect(await aside('run')).toBe('Running entry 1: near')
    await idle()
    expect(sent.at(-1)).toContain('near')
    expect(sent.at(-1)).not.toContain('far away')
    expect(await aside('q work')).toBe(['1 idea in @work', '', '  1  idea  far away'].join('\n'))
  })

  test('plan and run take only this project\'s queue, not a named one', async ($, on) => {
    const { sent, type, aside, idle } = world($, on)
    await type('+@work far away\n+ near')

    expect(await aside('plan')).toBe('Organizing 1 idea.')
    await idle()
    expect(sent.at(-1)).toContain('1. near')
    expect(sent.at(-1)).not.toContain('far away')
  })

  test('a named queue\'s idea is tidied as it is stored, and a message cut short half-way leaves nothing behind', async ($, on) => {
    const { w, aside, type, idle } = world($, on, { tidy: { 'read teh rfc': '<note>Read the RFC.</note>' } })
    await type('+@work read teh rfc')
    await idle()
    expect((await aside('q work')).split('\n').at(-1)).toBe('  1  idea  Read the RFC.')

    w.refuseWrite = 2
    await type('+@home a\n+@work b')
    expect(await aside('q home')).toBe('@home is empty. Start a message with "+@home" to add an idea to it.')
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  Read the RFC.'])
  })
})

describe('importing into a queue of no project', () => {
  const IDEAS = '- read the RFC\n- +? why is it slow\n- try zellij'

  test('/aside g import and /aside q NAME import put a list\'s items on those queues, ideas only, once', async ($, on) => {
    const { aside, shown } = world($, on, { files: { '/proj/ideas.md': IDEAS } })

    expect(await aside('g import ideas.md')).toBe('Imported 2 ideas from ideas.md to the global list (2 global). Left out: 1 comment, as the global list holds ideas only.')
    expect(await shown('g')).toEqual(['2 ideas on the global list', '1 idea read the RFC', '2 idea try zellij'])
    expect(await aside('q work import ideas.md')).toBe('Imported 2 ideas from ideas.md to @work (a new queue for every project; /aside q work local keeps it for this one). Left out: 1 comment, as @work holds ideas only.')
    expect(await aside('q work import ideas.md')).toBe('Nothing new in ideas.md for @work. Left out: 2 already there, 1 comment, as @work holds ideas only.')
    expect((await shown())[0]).toBe('The queue is empty.')
  })
})

describe('queues for this project alone', () => {
  test('with newQueues on local, a new +@later is this project\'s: other projects never see it, and it says how to share it', { options: { newQueues: 'local' } }, async ($, on) => {
    const { w, aside, queue, shown, band } = world($, on)
    const read = async () => {
      const ui = await band()
      const text = (await ui.find({ type: 'Text', text: /^aside: / }))?.text
      await ui.unmount()
      return text
    }

    expect(await queue('+@later read the RFC')).toBe('queued "read the RFC" to @later, a new queue of this project\'s; /aside q later global shares it with every project')
    expect(await shown('q')).toEqual(["1 queue beside this project's queue", "@later · 1 idea, this project's", '1 idea read the RFC'])
    expect(await shown('q later')).toEqual(["1 idea in @later, this project's", '1 idea read the RFC'])
    expect(await read()).toBe('aside: 1 in another queue · ')

    w.root = '/other'
    expect(await aside('q')).toBe('The global list and the named queues are empty. Start a message with "+@work" to add an idea to the queue work, or with "+g" to the global list.')
    expect(await queue('+@later for the other one')).toBe('queued "for the other one" to @later, a new queue of this project\'s; /aside q later global shares it with every project')
    w.root = '/proj'
    expect(await shown('q later')).toEqual(["1 idea in @later, this project's", '1 idea read the RFC'])
    expect(await aside('q nothing local')).toBe('@nothing holds no ideas yet: "+@nothing" starts it, for every project or, with the newQueues setting on local, for this one.')
  })

  test('/aside q NAME local keeps a queue for this project, and global shares it again, joining the one of its name', async ($, on) => {
    const { w, aside, queue, shown, band } = world($, on)
    await queue('+@work a')

    expect(await aside('q work local')).toBe("@work is now this project's, with 1 idea; other projects no longer see it.")
    expect(await aside('q work local')).toBe("@work is this project's already.")
    w.root = '/other'
    expect(await queue('+@work b')).toBe('queued "b" to @work, a new queue for every project; /aside q work local keeps it for this one')
    w.root = '/proj'
    expect(await shown('q')).toEqual([
      "2 queues beside this project's queue",
      "@work · 1 idea, for every project; hidden here by this project's @work",
      '1 idea b',
      "@work · 1 idea, this project's",
      '1 idea a',
    ])
    expect(await shown('find b')).toEqual(["In @work for every project, hidden here by this project's", '1 idea b'])
    expect(await queue('+@work c')).toBe('queued "c" to @work · 2 in @work')
    // The line above the prompt counts this project's @work, not the one it hides.
    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 2 in another queue · ')
    await ui.unmount()

    expect(await aside('q work global')).toBe('Moved 2 ideas into @work for every project, which now has 3.')
    expect(await shown('q work')).toEqual(['3 ideas in @work', '1 idea a', '2 idea b', '3 idea c'])
    expect(await aside('q work global')).toBe('@work is for every project already.')
    expect(await aside('g local')).toBe('The global list is for every project; /aside q NAME local keeps a named queue for this one.')
    expect(await aside('q nothing local')).toBe('@nothing holds no ideas yet: "+@nothing" starts it, for every project or, with the newQueues setting on local, for this one.')
    expect(await aside('q nothing global')).toBe('@nothing holds no ideas yet: "+@nothing" starts it, for every project or, with the newQueues setting on local, for this one.')
  })

  test('a queue of this project\'s keeps being its own through clear and undo, edit, rename and import', { options: { newQueues: 'local', tidy: 'off' } }, async ($, on) => {
    const { w, filled, type, aside, queue, shown } = world($, on, { files: { '/proj/ideas.md': '- from a file' } })
    await queue('+@later a')

    expect(await aside('q later clear')).toBe('Cleared 1 idea from @later. /aside q later undo brings it back.')
    expect(await aside('q later undo')).toBe('Brought back 1 idea to @later (1 in @later).')
    await aside('q later edit 1')
    expect(filled.at(-1)).toBe('+@later a')
    await type('+@later a, reworked')
    expect(await shown('q later')).toEqual(["1 idea in @later, this project's", '1 idea a, reworked'])
    await queue('+@later b')
    expect(await aside('q later move 2 1')).toBe(["2 ideas in @later, this project's", '', '  1  idea  b', '  2  idea  a, reworked'].join('\n'))
    await aside('q later remove 1')
    expect(await aside('q later rename bad.name')).toBe('A queue\'s name has letters, digits, "-" and "_", at most 20 of them: /aside q later rename office')
    expect(await aside('q later rename soon')).toBe('@later is now @soon: 1 idea.')
    expect(await aside('q soon import ideas.md')).toBe('Imported 1 idea from ideas.md to @soon (2 in @soon).')
    expect(await shown('q')).toEqual(["1 queue beside this project's queue", "@soon · 2 ideas, this project's", '1 idea a, reworked', '2 idea from a file'])
    w.root = '/other'
    expect((await shown('q'))[0]).toBe('The global list and the named queues are empty. Start a message with "+@work" to add an idea to the queue work, or with "+g" to the global list.')
  })

  test('a queue made this project\'s with /aside q NAME local stays its own through a clear and undo, and an edit of its only idea', async ($, on) => {
    const { filled, type, aside, queue, shown } = world($, on)
    await queue('+@later a')
    await aside('q later local')

    expect(await aside('q later clear')).toBe('Cleared 1 idea from @later. /aside q later undo brings it back.')
    expect(await aside('q later')).toBe('@later is empty. Start a message with "+@later" to add an idea to it.')
    expect(await aside('q later undo')).toBe('Brought back 1 idea to @later (1 in @later).')
    expect(await shown('q later')).toEqual(["1 idea in @later, this project's", '1 idea a'])
    await aside('q later edit 1')
    await type(`${filled.at(-1)!}, reworked`)
    expect(await shown('q later')).toEqual(["1 idea in @later, this project's", '1 idea a, reworked'])
  })

  test('a move to this project cut short after its writes leaves each idea in a queue, and run again takes in the rest once', async ($, on) => {
    const { w, aside, queue, shown } = world($, on)
    await queue('+@work a')
    await queue('+@work b')
    w.refuseDelete = 2

    expect(await aside('q work local')).toBe('/aside q work local did not finish (the store is busy). /aside shows where the queue and the plan stand.')
    expect(await aside('q work local')).toBe("Moved 1 idea into this project's @work, which now has 2.")
    expect(await shown('q')).toEqual(["1 queue beside this project's queue", "@work · 2 ideas, this project's", '1 idea a', '2 idea b'])
  })

  test('a move to every project cut short after its writes is finished by running it again, each idea once', async ($, on) => {
    const { w, aside, queue, shown } = world($, on)
    await queue('+@work a')
    await queue('+@work b')
    await aside('q work local')
    w.refuseDelete = 2

    expect(await aside('q work global')).toBe('/aside q work global did not finish (the store is busy). /aside shows where the queue and the plan stand.')
    expect(await aside('q work global')).toBe('Moved 1 idea into @work for every project, which now has 2.')
    expect(await shown('q')).toEqual(["1 queue beside this project's queue", '@work · 2 ideas', '1 idea a', '2 idea b'])
    w.root = '/other'
    expect(await shown('q')).toEqual(["1 queue beside this project's queue", '@work · 2 ideas', '1 idea a', '2 idea b'])
  })

  test('an idea out for editing and what a clear took go with a queue to its other scope, and come back there', async ($, on) => {
    const { filled, type, aside, queue, shown } = world($, on)
    await queue('+@work a')
    await queue('+@work b')
    await queue('+@work c')
    await aside('q work local')

    expect(await aside('q work edit 1')).toBe('Idea 1 of @work is in the prompt box: change it and press Enter; it goes back to place 1.')
    expect(await aside('q work global')).toBe('@work is now for every project, with 2 ideas.')
    expect(await shown('q work')).toEqual(['2 ideas in @work', '1 idea b', '2 idea c'])
    await type(`${filled.at(-1)!}, changed`)
    expect(await shown('q work')).toEqual(['3 ideas in @work', '1 idea a, changed', '2 idea b', '3 idea c'])

    expect(await aside('q work clear')).toBe('Cleared 3 ideas from @work. /aside q work undo brings them back.')
    await queue('+@work d')
    expect(await aside('q work local')).toBe("@work is now this project's, with 1 idea; other projects no longer see it.")
    expect(await aside('q work undo')).toBe('Brought back 3 ideas to @work (4 in @work).')
    expect((await shown('q work'))[0]).toBe("4 ideas in @work, this project's")
    // What the clear took came back once: none of it stays behind to come back again.
    expect(await aside('q work global')).toBe('@work is now for every project, with 4 ideas.')
    expect(await aside('q work undo')).toBe('Nothing to bring back to @work.')
    expect((await shown('q work'))[0]).toBe('4 ideas in @work')
  })

  test('a queue moved onto one of its name keeps what both clears took, for one undo', async ($, on) => {
    const { w, aside, queue } = world($, on)
    await queue('+@work a')
    await aside('q work local')
    await aside('q work clear')
    await queue('+@work x')
    w.root = '/other'
    await queue('+@work y')
    await aside('q work clear')
    w.root = '/proj'

    expect(await aside('q work global')).toBe('@work is now for every project, with 1 idea.')
    expect(await aside('q work undo')).toBe('Brought back 2 ideas to @work (3 in @work).')
  })

  test('an idea out for editing goes with its queue to its new name, and comes back to its place there', async ($, on) => {
    const { filled, type, aside, queue, shown } = world($, on)
    await queue('+@later a')
    await queue('+@later b')
    await aside('q later edit 1')
    await aside('q later rename soon')
    expect(filled.at(-1)).toBe('+@later a')
    await type('+@soon a, edited')

    expect(await shown('q soon')).toEqual(['2 ideas in @soon', '1 idea a, edited', '2 idea b'])
    expect(await aside('q later')).toBe('@later is empty. Start a message with "+@later" to add an idea to it.')
  })

  test('a queue this project keeps is read by the same rule everywhere: emptied by a clear, it still hides the one of its name', async ($, on) => {
    const { w, aside, queue, shown } = world($, on)
    await queue('+@work a')
    await aside('q work local')
    await aside('q work clear')
    w.root = '/other'
    await queue('+@work b')
    w.root = '/proj'

    expect(await shown('q')).toEqual(["1 queue beside this project's queue", "@work · 1 idea, for every project; hidden here by this project's @work", '1 idea b'])
    expect(await aside('q work')).toBe('@work is empty. Start a message with "+@work" to add an idea to it.')
    expect(await shown('find b')).toEqual(["In @work for every project, hidden here by this project's", '1 idea b'])
  })

  test('another session\'s idea out for editing keeps its queue the one every project sees, for a +@name typed here meanwhile', { options: { newQueues: 'local' } }, async ($, on) => {
    const { queue, shown, fromAnotherSession } = world($, on)
    await fromAnotherSession('global:editing:session-2', { key: 'named:work:idea:500:session-2:0', entry: { text: 'shared', at: 500, kind: 'idea' } })

    await queue('+@work mine')
    expect(await shown('q work')).toEqual(['1 idea in @work', '1 idea mine'])
  })

  test('an idea of this project\'s out for editing, sent from another folder as +g, goes to the global list and not back', async ($, on) => {
    const { w, filled, type, aside, queue, shown } = world($, on)
    await queue('+@later a')
    await aside('q later local')
    await aside('q later edit 1')
    expect(filled.at(-1)).toBe('+@later a')
    w.root = '/other'

    expect(await type('+g a, for everyone')).toEqual({ drop: 'queued' })
    expect(await shown('g')).toEqual(['1 idea on the global list', '1 idea a, for everyone'])
    w.root = '/proj'
    expect(await aside('q later')).toBe('@later is empty. Start a message with "+@later" to add an idea to it.')
  })

  test('a rename onto a name this project reads as a queue of the other scope is refused, and says what would work', async ($, on) => {
    const { aside, queue } = world($, on)
    await queue('+@office x')
    await aside('q office local')
    await queue('+@work a')

    expect(await aside('q work rename office')).toBe("@office is this project's, and @work is for every project: /aside q work local moves it here first, or pick another name.")
    expect(await aside('q office rename bad.name')).toBe('A queue\'s name has letters, digits, "-" and "_", at most 20 of them: /aside q office rename work')
  })

  test('/aside q NEW add makes a new queue and says whom it is for', { options: { newQueues: 'local' } }, async ($, on) => {
    const { type, aside } = world($, on)
    await type('+ here one')

    expect(await aside('q new add 1')).toBe("Moved to @new: here one. @new is a new queue of this project's; /aside q new global shares it with every project.")
  })

  test('a move to this project that fails half-way leaves the queue where it was, and run again moves it whole', async ($, on) => {
    const { w, aside, queue, shown } = world($, on)
    await queue('+@work a')
    await queue('+@work b')
    w.refuseWrite = 2

    expect(await aside('q work local')).toBe('/aside q work local did not finish (the store is full). /aside shows where the queue and the plan stand.')
    expect(await shown('q work')).toEqual(['2 ideas in @work', '1 idea a', '2 idea b'])
    expect(await aside('q work local')).toBe("@work is now this project's, with 2 ideas; other projects no longer see it.")
    expect(await shown('q work')).toEqual(["2 ideas in @work, this project's", '1 idea a', '2 idea b'])
  })

  test('/aside find names a queue of this project\'s as its own', { options: { newQueues: 'local' } }, async ($, on) => {
    const { queue, shown } = world($, on)
    await queue('+@later read the RFC')

    expect(await shown('find rfc')).toEqual(["In @later, this project's (/aside q later)", '1 idea read the RFC'])
  })
})
