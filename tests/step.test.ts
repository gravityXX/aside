import { describe, expect, test } from 'claude-code/testing'

import type { StepRun, StepState, StoredActive } from '../types'
import { askedOf, isAway, isWaiting, readActive, storedActive, turnOf } from '../hooks/core/step'

// How the marks the store keeps become the step's state and go back again (2.7). These are
// rules over every combination the store can hold, not only those a release writes, so each
// case is a row of a table rather than something the person sees (6.3).

// The ten states, so a new one has to be named here before it can pass.
const STATES = ['due', 'running', 'asking', 'answering', 'waiting', 'answered', 'noticing', 'away', 'ending', 'closing']

// The states that only make sense with a turn of the step running, and those that only make
// sense without one.
const WITH_TURN = ['running', 'asking', 'answering', 'noticing', 'closing']
const WITHOUT_TURN = ['due', 'waiting', 'answered', 'away', 'ending']

// Two shapes of what the step carries: the least a record can hold, and every field at once.
const RUNS: StepRun[] = [
  { step: 0, isChain: true, sessionId: 's' },
  {
    step: 2,
    isChain: false,
    sessionId: 's',
    then: [3, 4],
    ms: 1000,
    result: 'half done',
    startedAt: 50,
    isPlanningAfter: true,
    background: [{ callId: 'c1', taskId: 't1', what: 'review' }],
  },
]

// Every combination of the marks an earlier release could have written, the ones no release
// writes any more included.
const stored = (): StoredActive[] => {
  const all: StoredActive[] = []
  for (const run of RUNS) {
    for (const turnId of [undefined, 'turn-1']) {
      for (const pausedFor of [undefined, 'which design']) {
        for (const isAnswered of [undefined, true as const]) {
          for (const answerTurnId of [undefined, 'turn-1', 'turn-0']) {
            for (const isEnding of [undefined, true as const]) {
              for (const isAway of [undefined, true as const]) {
                all.push({
                  ...run,
                  ...(turnId === undefined ? {} : { turnId }),
                  ...(pausedFor === undefined ? {} : { pausedFor }),
                  ...(isAnswered === undefined ? {} : { isAnswered }),
                  ...(answerTurnId === undefined ? {} : { answerTurnId }),
                  ...(isEnding === undefined ? {} : { isEnding }),
                  ...(isAway === undefined ? {} : { isAway }),
                })
              }
            }
          }
        }
      }
    }
  }

  return all
}

describe('the step running, read from the marks the store keeps', () => {
  test('every combination the store can hold reads as one of the ten states', () => {
    const seen = new Set<string>()
    for (const one of stored()) {
      const state = readActive(one)
      expect(STATES).toContain(state.is)
      seen.add(state.is)
    }

    // Every state is reachable from some record, so none of the ten is dead.
    expect([...seen].sort()).toEqual([...STATES].sort())
  })

  test('a state carries a turn when it has one to carry, and the question when it waits', () => {
    for (const one of stored()) {
      const state = readActive(one)
      if (WITH_TURN.includes(state.is)) expect(turnOf(state)).toBe(one.turnId)
      if (WITHOUT_TURN.includes(state.is)) expect(turnOf(state)).toBe(undefined)
      if (isWaiting(state)) expect(typeof state.pausedFor).toBe('string')
      // Only the one state that goes on in the background reads as away.
      expect(isAway(state)).toBe(state.is === 'away')
    }
  })

  test('what aside writes back is read as the state it wrote, with the keys in the same order', () => {
    for (const one of stored()) {
      const state = readActive(one)
      const again = readActive(storedActive(state))

      // The state survives the trip to the store and back, field for field.
      expect(again).toEqual(state)
      // And key for key: changePlan writes only when JSON.stringify of the plan moved, and
      // savePlanSteps drops a planner's whole save when the plan no longer stringifies the
      // same, so two spellings of one state would cost a write or a plan (2.10).
      expect(JSON.stringify(again)).toBe(JSON.stringify(state))
    }
  })

  test('the marks written back are read the same way a second time', () => {
    for (const one of stored()) {
      const once = storedActive(readActive(one))
      const twice = storedActive(readActive(once))

      expect(twice).toEqual(once)
      expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
    }
  })

  test('a state keeps what the run carries and nothing of the marks it is not in', () => {
    for (const one of stored()) {
      const state: StepState = readActive(one)
      expect(state.step).toBe(one.step)
      expect(state.isChain).toBe(one.isChain)
      expect(state.sessionId).toBe(one.sessionId)
      expect(state.then).toEqual(one.then)
      expect(state.ms).toBe(one.ms)
      expect(state.result).toBe(one.result)
      expect(state.startedAt).toBe(one.startedAt)
      expect(state.isPlanningAfter).toBe(one.isPlanningAfter)
      expect(state.background).toEqual(one.background)
      // The marks themselves are gone: the state says what they stood for.
      for (const mark of ['isAnswered', 'answerTurnId', 'isEnding', 'isAway']) {
        if (!(mark === 'isAnswered' && state.is === 'asking')) expect(mark in state).toBe(false)
      }
      // A question is kept only where the state has one to keep.
      expect(askedOf(state)).toBe(['asking', 'answering', 'waiting', 'answered', 'ending', 'closing'].includes(state.is) ? state.pausedFor : undefined)
    }
  })
})
