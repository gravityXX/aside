import type { EngineInterface as Engine } from 'claude-code'

import type { Entry } from '../../types'
import type { Context } from '../context'
import { inOrder } from '../core/entries'
import { formatPlace, foundSection, listingText, planSection } from '../core/listing'
import type { ListingSection } from '../core/listing'
import { TAG_NOTE } from '../core/prompts'
import { foldText, splitWords } from '../core/text'
import { countQueues, GLOBAL, loadEntries, loadIdeas, loadPlan, projectKeys } from '../io/store'
import { tagsInFiles } from './queue'

// What a search looks at in an entry: its text, the quote it is about and where it points, as
// its row shows them, so a word of the project's own path finds nothing the row does not show.
const searchedText = (entry: Entry, root: string) => foldText([entry.text, entry.quote ?? '', formatPlace(entry, root)].join(' '))

// /aside find TEXT: every entry, tag, step and idea of a queue of no project that holds all the
// words, in any case and with or without accents, each with the number its own list shows, so
// /aside pop 2, /aside g here 1 or /aside q work pop 3 takes it from there. While Claude works,
// the result goes into the transcript at once, as a command's text shows only after the turn.
export async function findEntries($: Engine, ctx: Context, query: string): Promise<string> {
  const words = splitWords(query)
  if (words.length === 0) {
    return 'Give words to look for: /aside find dark mode'
  }
  const isMatch = (text: string) => words.every(word => text.includes(word))
  const numbered = <T>(items: readonly T[], text: (item: T) => string) =>
    items.flatMap((item, i) => (isMatch(text(item)) ? [{ item, label: String(i + 1) }] : []))
  const shown = <T>(items: T[]) => (ctx.settings.order === 'newest' ? items.reverse() : items)

  const keys = await projectKeys($)
  const sections: ListingSection[] = []
  const queue = numbered(inOrder(await loadEntries($, keys.queue), ctx.settings.order), entry => searchedText(entry, keys.root))
  if (queue.length > 0) sections.push(foundSection('In the queue (/aside)', queue.map(({ item, label }) => ({ entry: item, label })), keys.root))
  const tags = (await tagsInFiles($)).filter(tag => isMatch(searchedText(tag, keys.root)))
  if (tags.length > 0) sections.push(foundSection('Tags in files', tags.map(entry => ({ entry, label: '·' })), keys.root))
  const stored = await loadPlan($, keys.plan)
  const plan = planSection(stored)
  // A step by its title, what it asks, without the plugin's own words, and what it said.
  const stepText = (step: (typeof stored.steps)[number]) => foldText([step.title, step.prompt.replace(TAG_NOTE, ''), step.result ?? ''].join(' '))
  const found = new Set(numbered(stored.steps, stepText).map(one => one.label))
  // With no step left to do, /aside run N runs queue entry N, so a plan done gets no hint of it.
  const planTitle = stored.steps.some(step => !step.isDone) ? 'In the plan (/aside run N)' : 'In the plan, done (/aside)'
  if (plan && found.size > 0) sections.push({ title: planTitle, rows: plan.rows.filter(row => found.has(row.label)) })
  for (const { name } of await countQueues($)) {
    const ideas = numbered(shown(await loadIdeas($, name)), idea => searchedText(idea.entry, keys.root))
    const title = name === GLOBAL ? 'On the global list (/aside g)' : `In @${name} (/aside q ${name})`
    if (ideas.length > 0) sections.push(foundSection(title, ideas.map(({ item, label }) => ({ entry: item.entry, label })), keys.root))
  }
  if (sections.length === 0) {
    return `Nothing holds "${query.trim()}": not the queue, the tags, the plan, the global list or a named queue.`
  }
  const text = listingText(sections)
  if (!ctx.session.isRunning) {
    return text
  }
  $.ui.log(text)

  return 'Wrote what was found above while Claude was working.'
}
