import type { Args, EngineInterface as Engine, Hook, MatchedHook } from 'claude-code'

import type { Plan, Step } from '../../types'
import type { Context } from '../context'
import { inOrder, KINDS } from '../core/entries'
import { describeCount, formatPlace } from '../core/listing'
import { entryPrompt, isOwnPrompt, planningPrompt, sendPrompt, STEP_MARKER, stepPrompt } from '../core/prompts'
import { formatCount, shortenText } from '../core/text'
import { loadEntries, loadPlan, projectKeys, refreshBand, savePlan, takeForHandOver } from '../io/store'
import type { Keys } from '../io/store'
import { tagsInFiles } from './queue'

// Submits the prompt `compose` gives as the person's own, or nothing when it gives none. It
// goes out from a timer, since neither a command's hook nor a turn's end may submit one while
// it holds the turn; `onFail` hears why when a hook beneath drops it or the engine refuses it.
function submitLater($: Engine, compose: () => Promise<string | undefined>, onFail: (why: string) => Promise<void>) {
  $.clock.after(50, async () => {
    const prompt = await compose()
    if (prompt === undefined) {
      return
    }
    try {
      const sent = await $.prompt.submit({ text: prompt, asUser: true })
      if ('drop' in sent && sent.drop !== undefined) await onFail(sent.drop)
    } catch (error) {
      await onFail(String(error))
    }
  })
}

// Hands the queue and the new file tags over: as one planning prompt ('plan'), or as it
// is, to be done now ('send'). A prompt dropped beneath gives everything back.
export async function handOverQueue($: Engine, ctx: Context, mode: 'plan' | 'send'): Promise<string> {
  const keys = await projectKeys($)
  const stored = await loadEntries($, keys.queue)
  // Tags already handed over stay in their files until a step removes them; they are
  // not handed over again.
  const tags = await tagsInFiles($, true)
  const all = [...inOrder(stored, ctx.settings.order), ...tags]
  if (all.length === 0) {
    return 'The queue is empty. Start a message with "+" to add an idea, or "+?" to comment on a copied fragment.'
  }

  // The entries leave the queue as they are handed over; /aside undo brings them back.
  const { giveBack } = await takeForHandOver($, keys, stored, tags)
  await refreshBand($, 0)
  const pending = (await loadPlan($, keys.plan)).steps.filter(step => !step.isDone)
  const text = mode === 'plan' ? planningPrompt(all, keys.root, pending, ctx.session.planTool) : sendPrompt(all, keys.root)
  submitLater($, async () => text, async why => {
    await giveBack()
    await refreshBand($, tags.length)
    $.ui.toast(`Could not hand the queue over (${why}); the entries are back in it`)
  })

  return `${mode === 'plan' ? 'Organizing' : 'Sending'} ${describeCount(all)}.`
}

// Lets go of the step `index` that never started (its prompt was dropped or refused),
// unless something else took its place meanwhile.
async function releaseStep($: Engine, index: number, why: string) {
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  if (plan.active?.step === index && plan.active.turnId === undefined) {
    delete plan.active
    await savePlan($, keys.plan, plan)
    await refreshBand($)
  }
  $.ui.toast(`Could not send step ${index + 1} of the plan: ${why}`)
}

// Runs step `index` of the plan; with `isChain`, the next one follows when it ends. A stop
// that lands before its prompt goes out keeps it from going out at all.
async function startStep($: Engine, index: number, isChain: boolean) {
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  const step = plan.steps[index]!
  plan.active = { step: index, isChain, sessionId: await $.session.id() }
  await savePlan($, keys.plan, plan)
  await refreshBand($)
  submitLater(
    $,
    async () => {
      const now = await loadPlan($, keys.plan)
      const isStillDue = now.active?.step === index && now.active.turnId === undefined

      return isStillDue ? stepPrompt(step, index + 1, plan.steps.length) : undefined
    },
    why => releaseStep($, index, why),
  )
}

// What /aside run adds when another session's step was running: this one takes it over.
const takeOverNote = (plan: Plan) => (plan.active ? ` (another session had step ${plan.active.step + 1} running; this one takes over)` : '')

// /aside run on the saved plan: step `n`, or the plan from its first step not done.
// Undefined when no step is named and every step is done, so the queue runs entry by entry instead.
export async function runPlan($: Engine, n?: number): Promise<string | undefined> {
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  if (plan.active && plan.active.sessionId === (await $.session.id())) {
    return `Step ${plan.active.step + 1} is running. /aside stop stops after it.`
  }
  const note = takeOverNote(plan)
  if (n !== undefined) {
    if (plan.steps.length === 0) {
      return 'No plan: /aside run runs the queue entry by entry.'
    }
    if (n < 1 || n > plan.steps.length) {
      return `Give a step from 1 to ${plan.steps.length}, as /aside shows them.`
    }
    await startStep($, n - 1, false)

    return `Running step ${n}: ${plan.steps[n - 1]!.title}${note}`
  }
  const first = plan.steps.findIndex(step => !step.isDone)
  if (first < 0) {
    return undefined
  }
  await startStep($, first, true)
  const left = plan.steps.filter(step => !step.isDone).length

  return `Running the plan: ${formatCount(left, 'step')}, from step ${first + 1}. /aside stop stops after the current one.${note}`
}

// /aside run with no plan to run: every entry, and every new tag, becomes a step of its own.
export async function runEntries($: Engine, ctx: Context): Promise<string> {
  const keys = await projectKeys($)
  const note = takeOverNote(await loadPlan($, keys.plan))
  const stored = await loadEntries($, keys.queue)
  const tags = await tagsInFiles($, true)
  const all = [...inOrder(stored, ctx.settings.order), ...tags]
  if (all.length === 0) {
    return 'Nothing to run: the queue is empty and the plan is done.'
  }
  const steps = all.map(entry => ({
    title: shortenText(entry.text || formatPlace(entry, keys.root) || KINDS[entry.kind].label, 50),
    prompt: entryPrompt(entry, keys.root),
  }))
  await takeForHandOver($, keys, stored, tags)
  await savePlan($, keys.plan, { steps })
  await refreshBand($, 0)
  await startStep($, 0, true)

  return `Running ${formatCount(steps.length, 'entry')} one by one. /aside stop stops after the current one.${note}`
}

// Stops the plan: a step that has not started yet does not start; a running one finishes
// and is the last. A step another session left behind is let go here.
export async function stopPlan($: Engine): Promise<string> {
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  const active = plan.active
  if (!active) {
    return 'Nothing is running.'
  }
  const n = active.step + 1
  let text: string
  if (active.turnId === undefined || active.sessionId !== (await $.session.id())) {
    delete plan.active
    text = `The plan stopped before step ${n}.`
  } else {
    active.isChain = false
    text = `The plan stops after step ${n}.`
  }
  await savePlan($, keys.plan, plan)
  await refreshBand($)

  return text
}

const parseSteps = (value: unknown): Step[] | null => {
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

// The tool the model saves a plan with; returns its full name as the engine registered it.
export async function registerPlanTool($: Engine): Promise<string> {
  const registered = await $.tool.register({
    name: 'plan',
    description:
      "Saves the step plan you just proposed for the user's queue (the aside plugin), so the user can run it with /aside run. " +
      'Call it only when the aside plugin asked you to organize the queue. Each step: a short title and a prompt that stands on its own.',
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
  const steps = parseSteps((e as unknown as { steps?: unknown }).steps)
  if (steps === null) {
    return { deny: 'steps must be a non-empty list of { title, prompt }, each prompt non-empty' }
  }
  const keys = await projectKeys($)
  const old = await loadPlan($, keys.plan)
  if (old.active && old.active.sessionId === (await $.session.id())) {
    return { deny: `step ${old.active.step + 1} of the current plan is running; the user stops it with /aside stop first` }
  }
  await savePlan($, keys.plan, { steps })
  await refreshBand($)

  return {
    result: `Saved ${steps.length} steps. Tell the user: /aside run runs them all in order, /aside run N runs one, /aside shows them.`,
  }
}

// The turn of a plan step: remember which, so its end runs the next one.
async function bindStepTurn($: Engine, turnId: string) {
  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  if (plan.active && plan.active.turnId === undefined && plan.active.sessionId === (await $.session.id())) {
    plan.active.turnId = turnId
    await savePlan($, keys.plan, plan)
  }
}

type TurnStart = Parameters<Hook<'turn.start'>>

export async function onTurnStart(ctx: Context, $: Engine, e: TurnStart[1], next: TurnStart[2]) {
  if (e.agentId === undefined) {
    ctx.session.turnId = e.turnId
    ctx.session.isRunning = true
    ctx.session.isOwnTurn = isOwnPrompt(e.text)
    if (e.text.includes(STEP_MARKER)) await bindStepTurn($, e.turnId)
  }

  return next(e)
}

type TurnEndReason = Args<'turn.complete'>['reason']

// The step that ran in this turn ends: after an answer it is done, and the next one starts
// when the plan runs as a chain; otherwise the plan stops there.
async function finishStep($: Engine, keys: Keys, plan: Plan, reason: TurnEndReason) {
  const active = plan.active!
  delete plan.active
  if (reason === 'answer') {
    plan.steps[active.step]!.isDone = true
    const after = plan.steps.findIndex((step, i) => i > active.step && !step.isDone)
    await savePlan($, keys.plan, plan)
    if (active.isChain && after >= 0) {
      await startStep($, after, true)
    } else {
      $.ui.toast(active.isChain ? 'Plan done' : `Step ${active.step + 1} done`)
    }
  } else {
    await savePlan($, keys.plan, plan)
    $.ui.toast(`Plan stopped: step ${active.step + 1} ${reason === 'aborted' ? 'was interrupted' : 'did not finish'}`)
  }
  await refreshBand($)
}

// Files the agents wrote may hold new tags; then the queue goes out by itself when the
// setting says so, never after the plugin's own turn. A plan running elsewhere, or a saved
// plan with steps still to do, is the person's to finish first: the queue waits.
async function handOverAfterAnswer($: Engine, ctx: Context, plan: Plan, reason: TurnEndReason) {
  const now = await refreshBand($, (await tagsInFiles($, true)).length)
  const waiting = now.ideas + now.comments + now.tags
  const isPending = plan.steps.some(step => !step.isDone)
  const { afterAnswer } = ctx.settings
  if (!plan.active && waiting > 0 && afterAnswer !== 'wait' && reason === 'answer' && !ctx.session.isOwnTurn && !isPending) {
    $.ui.toast(await handOverQueue($, ctx, afterAnswer))
  }
}

type TurnComplete = Parameters<Hook<'turn.complete'>>

export async function onTurnEnd(ctx: Context, $: Engine, e: TurnComplete[1], next: TurnComplete[2]) {
  const done = await next(e)
  if (e.agentId !== undefined) {
    return done
  }
  ctx.session.isRunning = false

  const keys = await projectKeys($)
  const plan = await loadPlan($, keys.plan)
  const isThisStep = plan.active?.turnId === e.turnId && plan.active.sessionId === (await $.session.id())
  if (isThisStep) {
    await finishStep($, keys, plan, e.reason)
  } else {
    await handOverAfterAnswer($, ctx, plan, e.reason)
  }

  return done
}
