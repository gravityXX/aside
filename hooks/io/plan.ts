// Every change to the project's plan, on a chain of its own, so the queue's chain and the
// plan's never wait on each other (2.9).

import type { EngineInterface as Engine } from 'claude-code'

import type { Plan } from '../../types'
import { serial } from '../core/serial'
import { canFollow } from '../core/step'
import { loadPlan, projectKeys, savePlan } from './store'

// The changes to this project's plan, one after another, so a step that ends and a planner
// adding steps meanwhile never save over each other (2.9). It lives here, beside the queue's
// own chain, because only this layer stores the plan.
const inTurn = serial()

// Changes the plan as it is stored now, once every change asked for before has been saved, and
// resolves once this one has, so what is read next holds it. `change` edits the plan it is
// given and answers what the caller needs; the plan is saved only when the change moved it, so
// a callback that only reads writes nothing.
export function changePlan<T>($: Engine, change: (plan: Plan) => T | Promise<T>): Promise<T> {
  return inTurn(async () => {
    const keys = await projectKeys($)
    const plan = await loadPlan($, keys.plan)
    const before = JSON.stringify(plan)
    const was = plan.active?.is ?? 'none'
    const value = await change(plan)
    const now = plan.active?.is ?? 'none'
    // The step may only go where FOLLOWS says it can, so a writer that takes it somewhere the
    // graph does not have is refused here rather than stored (2.10).
    if (!canFollow(was, now)) throw new Error(`a step cannot go from ${was} to ${now}`)
    if (JSON.stringify(plan) !== before) await savePlan($, keys.plan, plan)

    return value
  })
}
