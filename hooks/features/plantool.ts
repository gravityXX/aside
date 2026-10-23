// The two tools Claude reaches the plan through: `plan`, which saves the steps it proposed for
// the queue, and `wait`, which keeps a step open for the person's answer. Their schemas, what
// they answer Claude, and how steps saved now meet the plan already there are one contract, and
// it reads as one.

import type { CatchHandler, EngineInterface as Engine, MatchedHook } from 'claude-code'

import type { Plan, Step } from '../../types'
import type { Context } from '../context'
import { leftOutSection, listingText, planSection } from '../core/listing'
import { PLAN_SAVED_NOTE, isSummingUp, stepMode } from '../core/prompts'
import { isAddingTurn, runOf, stepState, turnOf } from '../core/step'
import { describeFailure, shortenText } from '../core/text'
import { changePlan } from '../io/plan'
import { giveBackItems } from '../io/queue'
import { loadPlan, projectKeys, refreshBand } from '../io/store'
import { archivePlan } from './history'
import { tagsInFiles } from './queue'


// The plan made of `steps` alone, in place of the one it was.
export function replaceSteps(plan: Plan, steps: readonly Step[]) {
  plan.steps = [...steps]
  delete plan.active
  delete plan.paused
  delete plan.adding
}

export const parseSteps = (value: unknown): Step[] | null => {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }
  const steps = value.map(one => {
    const step = one as { title?: unknown; prompt?: unknown }

    return typeof step.title === 'string' && typeof step.prompt === 'string' && step.prompt.trim() !== ''
      ? { title: step.title.trim() || 'Step', prompt: step.prompt.trim() }
      : null
  })

  return steps.every(step => step !== null) ? (steps as Step[]) : null
}

export type Unclear = { item: number; question: string }

// The items Claude left out of the steps, by their number in the planning prompt (1 to
// `count`), each with its question; an item named twice counts once. Null when malformed.
export const parseUnclear = (value: unknown, count: number): Unclear[] | null => {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    return null
  }
  const unclear = value.map(one => {
    const { item, question } = one as { item?: unknown; question?: unknown }

    return Number.isInteger(item) && (item as number) >= 1 && (item as number) <= count && typeof question === 'string' && question.trim() !== ''
      ? { item: item as number, question: question.trim() }
      : null
  })
  if (!unclear.every(one => one !== null)) {
    return null
  }

  return (unclear as Unclear[]).filter((one, i, all) => all.findIndex(other => other.item === one.item) === i)
}

// The tool the model saves a plan with; returns its full name as the engine registered it.
export async function registerPlanTool($: Engine): Promise<string> {
  const registered = await $.tool.register({
    name: 'plan',
    description:
      "Saves the step plan you just proposed for the user's queue (the aside plugin), so the user can run it with /aside run. " +
      'Call it only when the aside plugin asked you to organize the queue. Each step: a short title and a prompt that stands on its own. ' +
      'Items you left out of the steps go in unclear, and back to the queue.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, prompt: { type: 'string' } },
            required: ['title', 'prompt'],
          },
        },
        unclear: {
          type: 'array',
          description: 'the items that look done, contradictory or unclear: each by its number in the queue, with your question',
          items: {
            type: 'object',
            properties: { item: { type: 'integer' }, question: { type: 'string' } },
            required: ['item', 'question'],
          },
        },
      },
      required: ['steps'],
    },
    isDeferred: false,
  })

  return registered.tool
}

type PlanToolCall = Parameters<MatchedHook<'tool.call', { readonly tool: RegExp }>>

export async function savePlanFromTool(ctx: Context, $: Engine, e: PlanToolCall[1], next: PlanToolCall[2]) {
  if (e.tool !== ctx.session.planTool) {
    return next(e)
  }
  const input = e as unknown as { steps?: unknown; unclear?: unknown }
  const steps = parseSteps(input.steps)
  if (steps === null) {
    return { deny: 'steps must be a non-empty list of { title, prompt }, each prompt non-empty' }
  }
  // The items are known by number only in the turn that organizes them; a plan saved
  // in any other turn has none to leave out.
  const planning = ctx.session.planning?.turnId === ctx.session.turnId ? ctx.session.planning : undefined
  const items = planning?.items ?? []
  const unclear = planning ? parseUnclear(input.unclear, items.length) : []
  if (unclear === null) {
    return { deny: `unclear must list items by their number in the queue, from 1 to ${items.length}, each with a question` }
  }
  const keys = await projectKeys($)
  const old = await loadPlan($, keys.plan)
  const me = await $.session.id()
  // Steps added after the plan's own leave a step that runs as it is.
  if (old.active && old.active.sessionId === me && !isAddingTurn(old, me, ctx.session.turnId)) {
    return { deny: `step ${old.active.step + 1} of the current plan is running; the user stops it with /aside stop first` }
  }
  // The items left out go back before the plan is saved, so a plan is never saved with items
  // still missing; a call made again after a failure gives back none twice.
  const left = unclear.map(({ item, question }) => ({ entry: items[item - 1]!, question }))
  await giveBackItems($, left.map(one => one.entry))
  // Given no plan to check against, the steps are always saved.
  const plan = (await savePlanSteps($, ctx, steps, isAddingTurn(old, me, ctx.session.turnId) ? 'tool' : 'replan'))!
  if (planning) planning.isSaved = true
  await refreshBand($, left.some(one => one.entry.isTag) ? (await tagsInFiles($, true)).length : undefined)
  const sections = [planSection(plan, await $.clock.now())!, ...(left.length > 0 ? [leftOutSection(left, keys.root)] : [])]

  return { result: listingText(sections), context: [PLAN_SAVED_NOTE] }
}

// Whether `now` is still the plan `given` was, only further on: the same steps, while what is
// done, running or paused may have moved.
const isSamePlan = (given: Plan, now: Plan) =>
  now.steps.length === given.steps.length && now.steps.every((step, i) => step.title === given.steps[i]!.title && step.prompt === given.steps[i]!.prompt)

// How steps saved now meet the plan there: 'add', a planner's answer while a step ran, goes
// after every step; 'tool', the plan tool's save in the turn that adds, goes after the steps
// its hand-over marked (adding.after); 'replan' merges with the steps to do.
type SaveMode = 'add' | 'tool' | 'replan'

// Saves `steps` as the plan. Added, they go after the plan's own steps, which stay as they
// stood, a run going on or paused included; saved again in the same planning turn, they take
// the place of those the first save added. A replan keeps the steps done, first, as the planning
// prompt said. Either way, a plan run to its end makes way for the new one. With `given`, the
// plan a planner was given, nothing is saved, and undefined comes back, unless the plan is still
// that one: only further on while adding to it, else just as it was.
export async function savePlanSteps($: Engine, ctx: Context, steps: readonly Step[], mode: SaveMode, given?: Plan): Promise<Plan | undefined> {
  return changePlan($, async plan => {
    if (given && !(mode === 'add' ? isSamePlan(given, plan) : JSON.stringify(plan) === JSON.stringify(given))) {
      return undefined
    }
    const base = mode === 'add' ? plan.steps.length : mode === 'tool' ? plan.adding?.after : undefined
    const kept = plan.steps.slice(0, base ?? plan.steps.length)
    const isLeft = plan.active !== undefined || kept.some(step => !step.isDone)
    if (base !== undefined && isLeft) {
      plan.steps = [...kept, ...steps]
    } else {
      // A plan run to its end goes to the log as the new one takes its place.
      if (!isLeft) await archivePlan($, plan)
      replaceSteps(plan, [...(isLeft ? kept.filter(step => step.isDone) : []), ...steps])
    }

    return structuredClone(plan)
  })
}

// The tool a step waits for the person with when it needs their answer before the next one.
export async function registerWaitTool($: Engine): Promise<string> {
  const registered = await $.tool.register({
    name: 'wait',
    description:
      "Keeps the step of the user's aside plan you are working on open for their answer: their next message comes to this step, which ends with your reply to it unless you call this tool again. " +
      'Call it only from a step of the aside plan that needs the user\'s answer or decision, then ask your question and end your reply with the "Result: " line.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'what you need from the user, in a few words' } },
      required: ['reason'],
    },
    isDeferred: false,
  })

  return registered.tool
}

// The step stays open once this turn ends: the person's answer comes to it, and Claude's reply
// to that answer ends it, or /aside continue does. A new question since an answer was taken up makes the step wait for that one.
export async function pausePlanFromTool(ctx: Context, $: Engine, e: PlanToolCall[1], next: PlanToolCall[2]) {
  if (e.tool !== ctx.session.waitTool) {
    return next(e)
  }
  const me = await $.session.id()
  const reason = (e as unknown as { reason?: unknown }).reason
  const said = await changePlan($, plan => {
    const active = plan.active
    if (!active) return undefined
    const turnId = turnOf(active)
    if (turnId === undefined || active.sessionId !== me) return undefined
    if (active.is === 'closing') return 'ending'
    const pausedFor = typeof reason === 'string' && reason.trim() !== '' ? shortenText(reason, 120) : 'it needs your answer'
    // The question is new, so an answer a turn took before it no longer ends the step. A step
    // that was in the background waits from here, keeping the work on its record.
    plan.active = stepState({ ...runOf(active), is: 'asking', turnId, pausedFor })

    return isSummingUp(plan.steps, stepMode(plan.steps, active.step, active.isChain, active.then)) ? 'last' : 'waits'
  })
  if (said === undefined) {
    return { deny: 'no step of the aside plan is running; call this tool only from a step of the plan' }
  }
  if (said === 'ending') {
    return { result: 'The user has ended this step, so it ends with this reply and nothing waits for their answer. Ask your question all the same, then end your reply with the "Result: " line.' }
  }
  const summary = said === 'last' ? ' Write no summary of the run yet: it comes once the step ends.' : ''

  return { result: `The step waits for the user's answer. Ask your question, then end your reply with the "Result: " line; their answer comes to this step, which ends with your reply to it unless you call this tool again.${summary}` }
}

// What the person hears when one of the plan's hooks fails, in place of the engine's own
// words: the reason, and what still stands.
type PlanToolFailed = Parameters<CatchHandler<MatchedHook<'tool.call', { readonly tool: RegExp }>>>

export function planToolFailed($: Engine, e: PlanToolFailed[1], next: PlanToolFailed[2]) {
  return next.called ? next(e) : { deny: `aside could not save the plan (${describeFailure(next.error)}); the plan was not saved, so call the tool again` }
}

export function waitToolFailed($: Engine, e: PlanToolFailed[1], next: PlanToolFailed[2]) {
  return next.called ? next(e) : { deny: `aside could not pause the plan (${describeFailure(next.error)}); call the tool again` }
}
