// The work a step's turn leaves running, and the notification that ends it. register.tsx calls
// these and nothing in the plan does, so this file is a leaf of its area.

import type { EngineInterface as Engine, Hook, MatchedHook } from 'claude-code'

import type { Context } from '../context'
import { backgroundContext, isSummingUp, stepMode } from '../core/prompts'
import { decide, writeInto } from '../core/reduce'
import { awayWork } from '../core/step'
import { changePlan } from '../io/plan'
import { refreshBand } from '../io/store'

type Submit = Parameters<Hook<'prompt.submit'>>

// What a call left going in the background, by its result: a workflow or an agent in the
// background, or a command; none for any other call.
const startedWork = (e: Record<string, unknown>, result: unknown): { taskId: string; what: string } | undefined => {
  const done = (typeof result === 'object' && result !== null ? result : {}) as Record<string, unknown>
  if (e.tool === 'Workflow' && done.status === 'async_launched' && typeof done.taskId === 'string') {
    return { taskId: done.taskId, what: typeof done.workflowName === 'string' ? done.workflowName : 'a workflow' }
  }
  if (e.tool === 'Agent' && done.status === 'async_launched' && typeof done.agentId === 'string') {
    return { taskId: done.agentId, what: typeof done.description === 'string' ? done.description : 'an agent' }
  }
  if (e.tool === 'Bash' && typeof done.backgroundTaskId === 'string') {
    return { taskId: done.backgroundTaskId, what: typeof e.description === 'string' ? e.description : 'a command' }
  }

  return undefined
}

type WorkCall = Parameters<MatchedHook<'tool.call', { readonly tool: RegExp }>>

// A call of the step's own turn that leaves work going in the background makes that work the
// step's: the step does not end before it does.
export async function noteBackgroundWork(ctx: Context, $: Engine, e: WorkCall[1], next: WorkCall[2]) {
  const done = await next(e)
  if (e.tool === 'TaskStop') {
    await dropStoppedWork(ctx, $, (done.result as { task_id?: unknown } | undefined)?.task_id)
    return done
  }
  const work = e.agentId === undefined ? startedWork(e as unknown as Record<string, unknown>, done.result) : undefined
  if (work === undefined) {
    return done
  }
  const me = await $.session.id()
  const callId = e.tool_use_id
  // The call has run: a store that fails here costs the step its wait, never the call's result.
  await changePlan($, plan => {
    const made = decide(plan, { is: 'workStarted', sessionId: me, turnId: ctx.session.turnId, ...(callId ? { callId } : {}), ...work })
    writeInto(plan, made.plan)
    if (made.outcome === 'noted' && callId) ctx.session.ownWork.add(callId)
  }).catch(() => undefined)

  return done
}

// Work Claude stopped sends no notification: it leaves the step at once. A step in the
// background left with none takes the turn that stopped it, whose end ends the step.
async function dropStoppedWork(ctx: Context, $: Engine, taskId: unknown) {
  if (typeof taskId !== 'string') {
    return
  }
  const me = await $.session.id()
  await changePlan($, plan => {
    writeInto(plan, decide(plan, { is: 'workStopped', sessionId: me, turnId: ctx.session.turnId, taskId }).plan)
  }).catch(() => undefined)
  await refreshBand($)
}

// A background task's notification: the work it names is done, whatever its status, and
// leaves the step it was part of.
export async function noteBackgroundEnd(ctx: Context, $: Engine, e: Submit[1], next: Submit[2]) {
  const taskId = /<task-id>([^<]+)<\/task-id>/.exec(e.text)?.[1]?.trim()
  const callId = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(e.text)?.[1]?.trim()
  if (taskId === undefined && callId === undefined) {
    return next(e)
  }
  const me = await $.session.id()
  const gone = await changePlan($, plan => {
    const made = decide(plan, {
      is: 'workEnded',
      sessionId: me,
      ...(e.turnId === undefined ? {} : { turnId: e.turnId }),
      ...(taskId === undefined ? {} : { taskId }),
      ...(callId === undefined ? {} : { callId }),
    })
    if (made.outcome === 'nothing') return undefined
    writeInto(plan, made.plan)

    return { active: structuredClone(made.plan.active!), steps: structuredClone(made.plan.steps), isTold: made.outcome === 'told' }
  })
  if (gone === undefined) {
    return next(e)
  }
  await refreshBand($)
  const { active, steps, isTold } = gone
  if (!isTold) {
    return next(e)
  }
  if (e.turnId === undefined) ctx.session.notice = e.text
  const isLast = isSummingUp(steps, stepMode(steps, active.step, active.isChain, active.then))
  const context = backgroundContext(steps, active.step, awayWork(active), isLast)

  return next({ ...e, context: [...(e.context ?? []), context] })
}
