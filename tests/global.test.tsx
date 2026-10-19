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

  test('/aside here moves global ideas to the end of the queue, and /aside global moves ideas back; a comment stays', async ($, on) => {
    const { type, aside, shown } = world($, on)
    await type('+g a\n+g b\n+g c')
    await type('+ x\n+? y')

    expect(await aside('here 1 3')).toBe('Moved here 2 ideas: a; c (4 waiting)')
    expect(await shown()).toEqual(['3 ideas and 1 comment waiting', '1 idea x', '2 question y', '3 idea a', '4 idea c'])
    expect(await aside('global 2')).toBe('Only ideas go to the global list; 2 is a comment.')
    expect(await aside('global 1 4')).toBe('Moved to the global list 2 ideas: x; c')
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

    expect(await aside('here 1')).toBe('Moved here: dark mode (1 waiting)')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea dark mode'])
    await fromAnotherSession('global:idea:1000:session-2:0', idea)
    await aside('global 1')
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
    await aside('here 1')
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
    expect(await aside('here 1')).toBe('The global list is empty. Start a message with "+g" to add an idea to it.')
    await type('+g a')
    expect(await aside('here 5')).toBe('Give a number from 1 to 1, as /aside g shows them.')
    expect(await aside('g remove 1 7')).toBe('Give numbers from 1 to 1, as /aside g shows them.')
  })

  test('a global idea is tidied as it is stored', async ($, on) => {
    const { aside, type, idle } = world($, on, { tidy: { 'read teh rfc': '<note>Read the RFC.</note>' } })
    await type('+g read teh rfc')
    await idle()

    expect((await aside('g')).split('\n').at(-1)).toBe('  1  idea  Read the RFC.')
  })
})
