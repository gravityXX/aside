import { describe, expect, test } from 'claude-code/testing'

import { world } from './world'

describe('the global list', () => {
  test('+g puts an idea on the global list: /aside leaves it out, /aside g shows it, the band reminds of it', async ($, on) => {
    const { type, queue, aside, shown, band } = world($, on)
    await type('+ local work')

    expect(await queue('+g read the RFC')).toBe('queued "read the RFC" to the global list (1 global)')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea local work'])
    expect(await aside('g')).toBe(['1 idea on the global list', '', '  1  idea  read the RFC'].join('\n'))
    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 1 idea, 1 global · ')
  })

  test('a draft that ends with +g, /aside g TEXT and a +g line among others go there too; "+go" stays an idea here', async ($, on) => {
    const { type, queue, aside, shown } = world($, on)

    expect(await queue('read it later +g')).toBe('queued "read it later" to the global list (1 global)')
    expect(await aside('g write the post')).toBe('queued "write the post" to the global list (2 global)')
    expect(await queue('+ fix the build\n+g learn Rust')).toBe('queued "fix the build" (1 waiting); queued "learn Rust" to the global list (3 global)')
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
    expect(await aside('g pop')).toBe('In the prompt box, ready to send: e')
    expect(await aside('g edit 1')).toBe('Global idea 1 is in the prompt box: change it and press Enter; it goes back to place 1.')
    expect(filled).toEqual(['e', '+g c'])
    expect(await aside('g')).toBe(['1 idea on the global list', '', '  1  idea  d'].join('\n'))
    expect(await queue('+g c, sharper')).toBe('queued "c, sharper" to the global list (2 global)')
    expect((await aside('g')).split('\n').slice(2)).toEqual(['  1  idea  c, sharper', '  2  idea  d'])
  })

  test('an idea out with g edit waits for a message of one +g idea, and comes back across a reload', async ($, on) => {
    const { type, queue, aside, fromAnotherSession } = world($, on)
    await type('+g a\n+g b')
    await aside('g edit 1')
    await type('+g x\n+g y')
    expect((await aside('g')).split('\n').slice(2)).toEqual(['  1  idea  b', '  2  idea  x', '  3  idea  y'])
    await fromAnotherSession('unrelated', 'value')

    expect(await queue('+g a, sharper')).toBe('queued "a, sharper" to the global list (4 global)')
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
    const { filled, logged, type, aside, startTurn } = world($, on)
    await type('+g read the RFC')
    await aside('g here 1')
    await aside('edit 1')
    expect(filled.at(-1)).toBe('+ read the RFC')

    await type('+g learn Rust')
    await startTurn('build the parser', 't1')
    expect(await aside('g')).toBe('Wrote the global list above while Claude was working.')
    expect(logged.at(-1)).toBe(['1 idea on the global list', '', '  1  idea  learn Rust'].join('\n'))
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
})

describe('named queues', () => {
  test('+@work puts an idea in the queue work, made by its first idea: /aside leaves it out, /aside q work shows it, the band counts it', async ($, on) => {
    const { type, queue, aside, shown, band } = world($, on)
    await type('+ local work')

    expect(await queue('+@work write the report')).toBe('queued "write the report" to @work, a new queue')
    expect(await queue('+@Work call the bank')).toBe('queued "call the bank" to @work (2 in @work)')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea local work'])
    expect(await aside('q work')).toBe(['2 ideas in @work', '', '  1  idea  write the report', '  2  idea  call the bank'].join('\n'))
    expect(await aside('q @WORK')).toBe(await aside('q work'))
    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 1 idea, 2 @work · ')
  })

  test('a draft that ends with +@work, /aside q work TEXT and lines among others go there too', async ($, on) => {
    const { queue, aside, shown } = world($, on)

    expect(await queue('read it later +@work')).toBe('queued "read it later" to @work, a new queue')
    expect(await aside('q work send the invoice')).toBe('queued "send the invoice" to @work (2 in @work)')
    expect(await queue('+ fix the build\n+@home water the plants\n+g learn Rust\n+@work book the room')).toBe(
      'queued "fix the build" (1 waiting); queued "water the plants" to @home, a new queue; queued "learn Rust" to the global list (1 global); queued "book the room" to @work (3 in @work)',
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

    expect(await queue('+@global read the RFC')).toBe('queued "read the RFC" to the global list (1 global)')
    expect(await aside('q global')).toBe(await aside('g'))
    expect(await aside('q global here 1')).toBe('Moved here: read the RFC (1 waiting)')
  })

  test('/aside q lists every queue for no project with its newest idea: the global list first, then the one added to last', async ($, on) => {
    const { type, aside, band } = world($, on)
    await type('+@work a')
    await type('+@home b')
    await type('+g c')
    await type('+@work d')

    expect(await aside('q')).toBe(['3 queues outside this project', '', 'global  1 idea   c', '@work   2 ideas  d', '@home   1 idea   b'].join('\n'))
    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 1 global, 2 @work, +1 queue · ')
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
    expect(await aside('q work pop')).toBe('In the prompt box, ready to send: c')
    expect(filled).toEqual(['c'])
    expect(await shown()).toEqual(['1 idea and 1 comment waiting', '1 question y', '2 idea a'])
    expect(await aside('q work here 5')).toBe('Give a number from 1 to 1, as /aside q work shows them.')
    expect(await aside('q home')).toBe('@home is empty. Start a message with "+@home" to add an idea to it.')
  })

  test('an idea out with q edit comes back to its place as +@work, or moves to the queue its new mark names', async ($, on) => {
    const { filled, type, queue, aside } = world($, on)
    await type('+@work a\n+@work b')

    expect(await aside('q work edit 1')).toBe('Idea 1 of @work is in the prompt box: change it and press Enter; it goes back to place 1.')
    expect(filled).toEqual(['+@work a'])
    expect(await queue('+@work a, sharper')).toBe('queued "a, sharper" to @work (2 in @work)')
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  a, sharper', '  2  idea  b'])

    await aside('q work edit 1')
    expect(await queue('+@home a, at home')).toBe('queued "a, at home" to @home, a new queue')
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  b'])
    await type('+@work c')
    expect((await aside('q work')).split('\n').slice(2)).toEqual(['  1  idea  b', '  2  idea  c'])
  })

  test('an idea edited out of a queue it was alone in comes back to that queue, not to a new one', async ($, on) => {
    const { queue, aside } = world($, on)
    await queue('+@solo a')
    await aside('q solo edit 1')

    expect(await queue('+@solo a, sharper')).toBe('queued "a, sharper" to @solo (1 in @solo)')
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
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 2 @work · ')
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

    expect(await queue('+@solo b\n+@solo c')).toBe('queued 2 ideas to @solo (2 in @solo)')
  })

  test('the band counts two named queues when the global list is empty, the one added to last first, and the rest as +2 queues', async ($, on) => {
    const { type, aside, band } = world($, on)
    await type('+@a one')
    await type('+@b one\n+@b two')
    await type('+@c one')
    await type('+@d one')

    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 1 @d, 1 @c, +2 queues · ')
    expect((await aside('q')).split('\n').slice(2)).toEqual(['@d   1 idea   one', '@c   1 idea   one', '@b   2 ideas  two', '@a   1 idea   one'])
  })

  test('/aside q work add makes @work the queue added to last', async ($, on) => {
    const { type, aside, band } = world($, on)
    await type('+ x')
    await type('+@work a')
    await type('+@home b')
    await aside('q work add 1')

    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: 2 @work, 1 @home · ')
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

  test('/aside q and /aside q work show at once while Claude works', async ($, on) => {
    const { logged, type, aside, startTurn } = world($, on)
    await type('+@work a')
    await startTurn('build the parser', 't1')

    expect(await aside('q')).toBe('Wrote the queues above while Claude was working.')
    expect(logged.at(-1)).toBe(['1 queue outside this project', '', '@work  1 idea  a'].join('\n'))
    expect(await aside('q work')).toBe('Wrote @work above while Claude was working.')
    expect(logged.at(-1)).toBe(['1 idea in @work', '', '  1  idea  a'].join('\n'))
  })

  test('/aside run all sends only this project\'s queue, and the named one keeps its idea', async ($, on) => {
    const { sent, type, aside, idle } = world($, on)
    await type('+@work far away\n+ near')

    expect(await aside('run all')).toBe('Sending 1 idea.')
    await idle()
    expect(sent.at(-1)).toContain('Ideas:\n1. near (branch main)')
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
    expect(await aside('q work import ideas.md')).toBe('Imported 2 ideas from ideas.md to @work (2 in @work). Left out: 1 comment, as @work holds ideas only.')
    expect(await aside('q work import ideas.md')).toBe('Nothing new in ideas.md for @work. Left out: 2 already there, 1 comment, as @work holds ideas only.')
    expect((await shown())[0]).toBe('The queue is empty.')
  })
})
