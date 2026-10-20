import type { EngineInterface as Engine } from 'claude-code'

import type { Entry } from '../../types'
import { loadEntries, projectKeys, saveEntries } from './store'

// What a change makes of the stored queue: the list to store in its place, left out to keep
// the queue as it is, and the value the caller asked for. `afterSave` writes what goes with the
// queue once it is stored, before the next change reads anything: the record of an entry back
// from /aside edit, which a message sent right after must not find there still.
export type QueueChange<T> = { list?: readonly Entry[]; value: T; afterSave?: () => Promise<unknown> }

// The changes to this project's queue, one after another, so two that overlap never store over
// each other (2.9): typed entries, their tidied text, imports. A module variable lives as long as
// `ctx` does, and a reload starts both over (3.7), as it does the work that asked for them.
let changes: Promise<unknown> = Promise.resolve()

// Changes the queue as it is stored once every change asked for before has landed, and
// resolves once this one has too, so what is read next holds it. A failure reaches the caller
// and leaves the changes after it to run. A change never waits for another one, which would
// wait for it.
export function changeQueue<T>($: Engine, change: (stored: readonly Entry[]) => QueueChange<T> | Promise<QueueChange<T>>): Promise<T> {
  const done = changes.then(async () => {
    const { queue } = await projectKeys($)
    const { list, value, afterSave } = await change(await loadEntries($, queue))
    if (list !== undefined) await saveEntries($, queue, list)
    await afterSave?.()

    return value
  })
  changes = done.catch(() => undefined)

  return done
}
