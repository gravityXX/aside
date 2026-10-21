import type { EngineInterface as Engine } from 'claude-code'

import type { PastRun, Plan } from '../../types'
import type { Context } from '../context'
import { runSection } from '../core/listing'
import type { Listed } from '../core/listing'
import { askPlaces, isPlace } from '../core/text'
import { loadPlan, loadRuns, projectKeys, saveRun } from '../io/store'
import { showWhileWorking } from './queue'

// How many plans /aside log shows unless asked for one.
const RUNS_SHOWN = 5

// A plan as the log keeps it: each step done, with its title, time and result, and when the
// last was done, or `now` for a plan from before steps kept that. Undefined when none was done.
const pastRun = (plan: Plan, now: number): PastRun | undefined => {
  const done = plan.steps.filter(step => step.isDone)
  if (done.length === 0) {
    return undefined
  }
  const times = done.flatMap(step => (step.doneAt === undefined ? [] : [step.doneAt]))

  return {
    at: times.length > 0 ? Math.max(...times) : now,
    steps: done.map(({ title, ms, result }) => ({ title, ...(ms !== undefined ? { ms } : {}), ...(result ? { result } : {}) })),
  }
}

// Keeps a plan run to its end in the log as another takes its place: called in the change that
// replaces it, before the plan is saved, so a failure keeps both and the save made again keeps
// one (saveRun).
export async function archivePlan($: Engine, plan: Plan) {
  const run = pastRun(plan, await $.clock.now())
  // A plan from before steps kept their time has none of its own to key it by: keyed by 0, it
  // is the same key each time it is saved, and there is one such plan per project at most.
  const isTimed = plan.steps.some(step => step.doneAt !== undefined)
  if (run) await saveRun($, (await projectKeys($)).history, run, isTimed ? run.at : 0)
}

const EMPTY_LOG = 'The log is empty: a plan run to its end comes here once another takes its place.'

// /aside log [N]: the plans run to their end, the one that ended last first, or plan N alone.
// While Claude works, a command's text shows only after the turn: the log goes into the list
// pane at once instead.
export async function showLog($: Engine, ctx: Context, n?: number): Promise<string> {
  return showWhileWorking($, ctx, { kind: 'log', ...(n === undefined ? {} : { n }) }, await logListed($, n), 'the log')
}

// What /aside log [N] lists, and the list pane too.
export async function logListed($: Engine, n?: number): Promise<Listed> {
  const keys = await projectKeys($)
  const runs = await loadRuns($, keys.history)
  if (runs.length === 0) {
    return (await loadPlan($, keys.plan)).steps.length > 0 ? `${EMPTY_LOG} /aside shows the plan now.` : EMPTY_LOG
  }
  if (n !== undefined && !isPlace(n, runs.length)) {
    return askPlaces(1, runs.length, 'number', '/aside log')
  }
  const now = await $.clock.now()
  const chosen = n === undefined ? runs.slice(0, RUNS_SHOWN).map((run, i) => ({ run, i })) : [{ run: runs[n - 1]!, i: n - 1 }]
  const more = n === undefined && runs.length > RUNS_SHOWN ? `${runs.length - RUNS_SHOWN} older in the log: /aside log ${RUNS_SHOWN + 1} shows the next.` : ''
  return { sections: chosen.map(({ run, i }) => runSection(run, i + 1, now)), ...(more ? { note: more } : {}) }
}
