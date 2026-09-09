/** What one surface is called on screen, and where in the product it actually is. */
export interface SurfaceName {
  /** The heading. What the thing is, in the product's own words. */
  readonly title: string;
  /** Where it is. A reader should be able to walk to it from this sentence. */
  readonly where: string;
}

/**
 * The surfaces, **named for where they are rather than for their keys**.
 *
 * <p><b>Why a table and not a prettified key.</b> `epic.chat` and `workspace.chat` are one word apart
 * and are two different places in two different routes; `project.epics` is not "the epics project",
 * it is the refinement agent at the head of a project's epics board. A reader configuring one of
 * these has to know which screen they are about to change, and a key title-cased would tell them the
 * opposite of that as often as not. The key is still shown beside the name, because it is what the
 * launch sends and what a log will spell.
 *
 * <p><b>Two of them have no button.</b> `epic.autonomous` and `ticket.dispatch` are surfaces by the
 * same definition — a place a session is started from — and nobody presses anything for them. Saying
 * so is the whole of what makes them readable: an operator looking for "the agent a ticket dispatch
 * starts" would not otherwise find it in a list of tabs.
 *
 * <p>The vocabulary is open and this table is not the source of it — the service's
 * `AgentSurfaceDefaults.SURFACES` is, and the list route answers what it holds. A key that arrives
 * here without an entry is rendered by {@link surfaceName} under its own key rather than dropped, so
 * a ninth surface is visible and configurable the day the service ships it and is merely unnamed
 * until somebody writes the sentence.
 */
export const SURFACE_NAMES: Readonly<Record<string, SurfaceName>> = {
  'project.epics': {
    title: 'Refinement agent',
    where: 'At the head of a project’s epics board, where the plan is drafted and refined.',
  },
  'project.tickets': {
    title: 'Triage agent',
    where: 'At the head of a project’s tickets board, where small work is filed and triaged.',
  },
  'epic.chat': {
    title: 'Chat tab, refining an epic',
    where:
      'The Chat tab of an epic’s refining workspace — a conversation over pipes, seeded with the prompt that was composed.',
  },
  'epic.agent': {
    title: 'Agents tab, refining an epic',
    where:
      'The Agents tab of an epic’s refining workspace — the full agent terminal, in the same container as the chat.',
  },
  'workspace.chat': {
    title: 'Chat tab, on a workspace',
    where: 'The Chat tab of a workspace opened on its own, outside any epic’s refining route.',
  },
  'workspace.agent': {
    title: 'Agents tab, on a workspace',
    where: 'The Agents tab of a workspace opened on its own — the full agent terminal.',
  },
  'epic.autonomous': {
    title: 'Composed run for an epic',
    where:
      'Nobody presses a button for this one: it is the run a composed task prompt starts, with read-only marked servers and no human watching.',
  },
  'ticket.dispatch': {
    title: 'Agent dispatched for a ticket',
    where:
      'Nobody presses a button for this one either: it is the agent that starts in the workspace a ticket dispatch cuts.',
  },
};

/** The name for a surface, falling back to its key so an unknown one is still readable. */
export function surfaceName(surface: string): SurfaceName {
  return (
    SURFACE_NAMES[surface] ?? {
      title: surface,
      where: 'This build has no sentence for this surface yet — it is newer than this page.',
    }
  );
}
