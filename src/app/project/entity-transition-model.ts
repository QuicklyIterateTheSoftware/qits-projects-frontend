import type { ArchetypeRegistry, ArchetypeSpecDto } from '../api/archetypes-api';
import type { Entity } from './entities-model';

/**
 * **Promoting, demoting and reparenting an entity** — every rule of it derived from the served
 * registry, and none of it written down here.
 *
 * <p>This file is the transition form's whole brain, and it contains no Angular for the reason
 * `entities-model.ts` contains none: each answer is a derivation over plain data, and each is the kind
 * of rule that stays plausible while being wrong. A parent picker that offers an illegal parent is a
 * 400 a reader cannot explain; a "what will be lost" line that misses a property is a field somebody
 * silently emptied. Both are cheap to test and impossible to see.
 *
 * <p><b>The archetype is an open string throughout, and that is the single most load-bearing decision
 * in this file.</b> `entities-model.ts` keeps `Archetype = 'EPIC' | 'TICKET'` because that is the
 * *read* model — this client only ever reads those two off the wire, and the union is what lets a card
 * narrow. The *transition* model is the other way round: it is about a shape the service owns and may
 * extend, so every archetype here is whatever string the registry named, compared by depth and by
 * membership in a served list. There is not one archetype name spelled as a literal in any rule below,
 * which is what makes a fifth kind the service adds appear in the pickers with no client change.
 *
 * <p><b>The nesting rule is a depth comparison and never a table of pairs.</b> See {@link mayContain}.
 *
 * <p><b>The one place archetype names do appear is {@link subjectsOf}</b>, and that is not a rule — it
 * is the read model's shape being walked. An epic's features live on `features`, a feature's tasks on
 * `tasks`, and a feature's completion is spelled `implementedOn` where a task's is `implementedAt`.
 * Those are facts about the wire this client already reads, not policy, and they have to be written
 * somewhere. When the service grows a fifth kind the registry will describe it and the pickers will
 * offer it; what will not happen by itself is this client learning to *read* one, and that is honest
 * rather than hidden.
 */

/**
 * One row a transition can be about, flattened out of the project's read model.
 *
 * <p><b>Flat, because the write is flat.</b> The transition door takes a map of id to full state, so a
 * form over a tree would have to flatten it anyway — and a person splitting a feature out of an epic is
 * selecting rows from three different levels at once, which a tree-shaped selection makes into three
 * different controls.
 *
 * <p>`values` is keyed by the registry's own property names and holds **only the properties that
 * currently carry something**. An absent key means "nothing is stored here", which is exactly what the
 * transition door means by an absent property — so the same map shape reads as the before-state and
 * writes as the after-state, and {@link lostProperties} is a set difference rather than a special case
 * per field.
 *
 * <p>`qualifiedId` is nullable and a null draws nothing; `number` is not. See
 * {@link ../api/dto#EpicDto.qualifiedId} for why a half-spelled identifier is worse than none.
 */
export interface TransitionSubject {
  readonly id: string;
  readonly archetype: string;
  readonly title: string;
  /** The per-project counter. Always there. */
  readonly number: number;
  /** `<projectKey>-<number>`, or null. Never drawn when null. */
  readonly qualifiedId: string | null;
  /** Who holds it now, or null for a row at the top of the project. */
  readonly parentId: string | null;
  /** Which project it belongs to — the fence a reparent may not cross. See {@link legalParentsFor}. */
  readonly projectId: string;
  /** Property name to the value it carries, with the empty ones left out entirely. */
  readonly values: Readonly<Record<string, string>>;
}

/**
 * A pending write against one subject: what it is to become, where it is to sit, and what it is to
 * carry.
 *
 * <p>It holds the subject rather than only its id so that every derivation — the lost properties, the
 * legal parents, the required fields — can be made from the draft alone, without a lookup that could
 * miss.
 */
export interface TransitionDraft {
  readonly subject: TransitionSubject;
  readonly archetype: string;
  readonly parentId: string | null;
  readonly values: Readonly<Record<string, string>>;
}

/**
 * One entry of the transition request: a whole target state, spelled the way the wire spells it.
 *
 * <p><b>PUT semantics, and the index signature is not laziness.</b> The properties are named by the
 * registry, so a request assembled from a list this client did not write cannot be typed as a closed
 * record without re-writing that list. What *is* fixed is the two keys every entry has — the archetype
 * it becomes and where it sits — and those are declared.
 *
 * <p>`membership` is always sent, including when the parent is null. The service reads an absent
 * membership as a root, so the explicit `{"parent": null}` is redundant on the wire and worth every
 * byte of it in a log: a request that says where a row went is one somebody can read back.
 */
export interface EntityTransitionRequest {
  readonly archetype: string;
  readonly membership: { readonly parent: string | null; readonly position?: number };
  readonly [property: string]: unknown;
}

/** What one archetype is, or null for a name this registry does not describe. */
export function specOf(registry: ArchetypeRegistry, archetype: string): ArchetypeSpecDto | null {
  return registry.archetypes.find((spec) => spec.archetype === archetype) ?? null;
}

/**
 * **Whether one kind may hold another: strictly shallower may hold strictly deeper, and nothing
 * else.**
 *
 * <p>A comparison rather than a list of legal pairs, and the two things that buys are both wanted.
 * *Levels may be skipped*: an epic at depth 0 may hold a task at depth 2 directly, with no feature
 * between them, which is the shape a small plan actually takes. And *equal depths never nest*: two
 * root kinds — an epic and a ticket today — can never be filed inside one another, which falls out of
 * `0 < 0` being false rather than out of four pairs somebody remembered to leave off a table.
 *
 * <p>A pair table would also be the place a fifth archetype was forgotten. A depth comparison has
 * nothing to forget: the registry gives the new kind a depth and every existing kind's answer about it
 * is already computed.
 *
 * <p>An archetype this registry does not describe holds nothing and fits nowhere — the honest answer
 * for a name that arrived from somewhere other than the registry.
 */
export function mayContain(
  registry: ArchetypeRegistry,
  parentArchetype: string,
  childArchetype: string,
): boolean {
  const parent = specOf(registry, parentArchetype);
  const child = specOf(registry, childArchetype);
  return parent !== null && child !== null && parent.depth < child.depth;
}

/**
 * The rows that may legally hold this subject once it becomes `targetArchetype`.
 *
 * <p>Four things disqualify a candidate, and each is a refusal this saves a reader from reading.
 *
 * <p><b>A different project.</b> The service refuses a cross-project reparent outright, so offering
 * one would be offering a 400 — and the candidates are drawn from one project's read anyway, which
 * makes this a guard against a caller that mixed two rather than a filter that usually does work.
 *
 * <p><b>The subject itself.</b> A row cannot be its own parent, and it is worth saying out loud rather
 * than relying on the depth rule, which would let a row of one depth sit under a row of another if the
 * two happened to be the same row mid-retarget.
 *
 * <p><b>Anything already beneath the subject.</b> Filing an epic under its own feature makes a cycle,
 * and a cycle is the one refusal that leaves no readable sentence behind. The descent walks the
 * candidates' parent links, so it is bounded by the list and terminates on a malformed tree rather
 * than spinning in it.
 *
 * <p><b>A depth that cannot hold the target.</b> {@link mayContain}, on the candidate's archetype.
 *
 * <p><b>The candidates' archetypes are the caller's to decide, and the caller passes the *drafted*
 * ones.</b> That is what makes the motivating case expressible at all: promoting a feature to an epic
 * while turning its tasks into features under it requires the task's parent picker to judge the
 * feature by what it is *about to be*, not by what it still is. Judging it by the stored archetype
 * would refuse the only arrangement a person opened the form to make. So this function takes whatever
 * subjects it is given and asks nothing about where they came from.
 */
export function legalParentsFor(
  registry: ArchetypeRegistry,
  subject: TransitionSubject,
  targetArchetype: string,
  candidates: readonly TransitionSubject[],
): readonly TransitionSubject[] {
  const beneath = descendantsOf(subject.id, candidates);
  return candidates.filter(
    (candidate) =>
      candidate.id !== subject.id &&
      candidate.projectId === subject.projectId &&
      !beneath.has(candidate.id) &&
      mayContain(registry, candidate.archetype, targetArchetype),
  );
}

/** Every id at or below one row, by the parent links the candidates carry. Bounded by the list. */
function descendantsOf(rootId: string, candidates: readonly TransitionSubject[]): ReadonlySet<string> {
  const beneath = new Set<string>([rootId]);
  // One pass per level at worst, and the budget is the list's own length, so a parent cycle in the
  // data runs out rather than spinning: each pass either adds a row or is the last one.
  let budget = candidates.length;
  let grew = true;
  while (grew && budget > 0) {
    budget -= 1;
    grew = false;
    for (const candidate of candidates) {
      if (candidate.parentId && beneath.has(candidate.parentId) && !beneath.has(candidate.id)) {
        beneath.add(candidate.id);
        grew = true;
      }
    }
  }
  return beneath;
}

/**
 * The properties a person may **state** on this archetype: everything it permits, less everything the
 * server owns.
 *
 * <p>The subtraction is the whole of it, and it is done here rather than by the form so that there is
 * one answer to "which boxes does this archetype get". A slug is derived from the title and rewritten
 * when the title moves; the principal is stamped from the session. A box for either would be a box
 * whose value the next write throws away, which is worse than no box at all.
 *
 * <p>The order is `permitted`'s, which is the service's own — so the form's fields read in the order
 * the model declares them rather than in an order this client invented.
 */
export function statableProperties(
  registry: ArchetypeRegistry,
  archetype: string,
): readonly string[] {
  const spec = specOf(registry, archetype);
  if (!spec) {
    return [];
  }
  return spec.permitted.filter((property) => !registry.serverOwned.includes(property));
}

/**
 * What a transition of this archetype **must** carry — `requiredOnTransition`, less the server-owned.
 *
 * <p>The transition list rather than `required`, because a transition states the whole row: a status
 * it left out is a status it *cleared*, so the two archetypes with a lifecycle need one named even
 * where a create would have defaulted it.
 *
 * <p>Server-owned properties are subtracted for the same reason they are subtracted from the statable
 * ones: a form cannot satisfy a requirement it is not allowed to write to, and marking a field
 * required that has no box would be a submit button nobody could ever enable.
 */
export function requiredFieldsFor(
  registry: ArchetypeRegistry,
  archetype: string,
): readonly string[] {
  const spec = specOf(registry, archetype);
  if (!spec) {
    return [];
  }
  return spec.requiredOnTransition.filter((property) => !registry.serverOwned.includes(property));
}

/**
 * **What this write will throw away**: every property the subject carries a value for that the target
 * archetype does not permit.
 *
 * <p>This is the whole reason the form has a warning at all. The door is a PUT of the full state, so
 * an absent property is a cleared one — demote an epic to a ticket and its supersession goes; demote a
 * ticket to a feature and its status, its kind, its impetus, its assignee and the principal who filed
 * it all go, in one press, with nothing on screen saying so. Naming them is the last place a person
 * can notice, and a count ("3 properties will be lost") would not be noticing.
 *
 * <p>It is computed against what the subject **actually carries**, not against what its current
 * archetype permits: a ticket with no assignee loses no assignee, and saying it did would train a
 * reader to ignore the line.
 *
 * <p>The server-owned properties are **not** excluded. A `createdBy` a demotion drops is a fact that
 * really is lost, and hiding it because this form could not have written it back would be hiding the
 * one loss nobody can undo.
 */
export function lostProperties(
  registry: ArchetypeRegistry,
  subject: TransitionSubject,
  targetArchetype: string,
): readonly string[] {
  const spec = specOf(registry, targetArchetype);
  if (!spec) {
    return [];
  }
  return registry.properties.filter(
    (property) => carries(subject, property) && !spec.permitted.includes(property),
  );
}

/** Whether a subject holds anything at all under a property. Blank is nothing, as it is on the wire. */
function carries(subject: TransitionSubject, property: string): boolean {
  return (subject.values[property] ?? '').trim().length > 0;
}

/**
 * A property as a person reads it: `TICKET_TYPE` becomes `ticket type`.
 *
 * <p><b>This is the service's own rendering, mirrored exactly</b> — lower-case, underscores to spaces
 * — and mirroring it rather than writing a table of pretty labels is what makes
 * {@link attributeViolations} work. A refusal names a property in this spelling, so a client whose
 * labels said "Ticket kind" would have nothing to match against and would have to keep a second table
 * mapping its own prose back to the server's. One rule, applied in both directions, has nothing to
 * drift.
 *
 * <p>It is also why a property the service adds tomorrow is already labelled: there is no entry to
 * add.
 */
export function propertyLabel(property: string): string {
  return property.toLowerCase().replace(/_/g, ' ');
}

/**
 * The properties a violation may be **pointed at**: the vocabulary, less the server-owned.
 *
 * <p>The subtraction is what makes the slug collision behave. `slug "x" is already taken under parent
 * y` does say the word "slug", so a naive match against the whole vocabulary files it under a property
 * — and `SLUG` is server-owned, so the form draws no box for it, and the one refusal a reparent
 * actually produces would be attributed to a field that is not on screen and vanish. Subtracting the
 * server-owned names *before* matching sends it where it belongs: the form's own error line, where a
 * reader can read it and change the parent.
 *
 * <p>It is not a special case for slugs. It is the general statement that a message can only be
 * attributed to something a person can act on, and every server-owned property is by definition
 * something they cannot.
 */
export function attributableProperties(registry: ArchetypeRegistry): readonly string[] {
  return registry.properties.filter((property) => !registry.serverOwned.includes(property));
}

/**
 * A refusal, split into its fragments and pointed at the fields it is about.
 *
 * `unattributed` is not a leftover bin to hide things in — it is where the violations that genuinely
 * name no property go, and a slug collision on reparent (`slug "x" is already taken under parent y`)
 * is exactly one of those. It names a slug, which is server-owned and has no box, and a parent, which
 * is a control rather than a property. Surfacing it as a form-level sentence is the only honest
 * place for it; swallowing it would leave a reader pressing a button that keeps failing silently.
 */
export interface AttributedViolations {
  /** Property name to the fragments that named it, in the order the server wrote them. */
  readonly byProperty: ReadonlyMap<string, readonly string[]>;
  /** Every fragment that named no property at all. */
  readonly unattributed: readonly string[];
}

/**
 * **A 400 from the transition door, taken apart.** The service joins every violation with `"; "` and
 * answers them as one sentence, so the split is the contract and not a guess.
 *
 * <p>Each fragment is matched against the **served** property list, rendered through
 * {@link propertyLabel} — never against a table of field names written here. That is what keeps the
 * attribution correct for a property this client has never heard of: the registry names it, the label
 * rule spells it, and a violation mentioning it lands on its box.
 *
 * <p><b>Which list is passed is the caller's decision and it matters.</b> The form passes
 * {@link attributableProperties}, so a violation about something a person cannot write — the slug
 * collision a reparent produces — comes back unattributed rather than being filed under a box that is
 * not drawn. This function takes the list rather than the registry precisely so that decision is made
 * where it can be argued for.
 *
 * <p><b>The longest matching label wins.</b> Labels can contain one another — a hypothetical `TYPE`
 * beside `TICKET_TYPE` would match the same sentence — and attributing "a EPIC has no ticket type" to
 * `TYPE` would put the message under a box that is not the one at fault. Longest-match is the rule
 * that is right whenever one label is a suffix or an infix of another, and identical to a naive match
 * whenever none is.
 *
 * <p><b>A fragment is attributed to at most one property.</b> A violation is about one thing; spraying
 * it under every box whose name appears in it would turn one problem into four.
 *
 * <p>An empty or blank message attributes nothing, which is what a caller with no error should get
 * without having to check first.
 */
export function attributeViolations(
  message: string | null,
  properties: readonly string[],
): AttributedViolations {
  const byProperty = new Map<string, string[]>();
  const unattributed: string[] = [];
  const fragments = (message ?? '')
    .split('; ')
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);

  for (const fragment of fragments) {
    const named = namedProperty(fragment, properties);
    if (!named) {
      unattributed.push(fragment);
      continue;
    }
    const already = byProperty.get(named);
    if (already) {
      already.push(fragment);
    } else {
      byProperty.set(named, [fragment]);
    }
  }

  return { byProperty, unattributed };
}

/** The longest served property whose label this fragment mentions, or null for one that mentions none. */
function namedProperty(fragment: string, properties: readonly string[]): string | null {
  const lowered = fragment.toLowerCase();
  let best: string | null = null;
  for (const property of properties) {
    const label = propertyLabel(property);
    if (lowered.includes(label) && (!best || label.length > propertyLabel(best).length)) {
      best = property;
    }
  }
  return best;
}

/**
 * **The whole project, flattened into rows a transition can be about** — epics, the features under
 * them, the tasks under those, and the tickets beside them all.
 *
 * <p>Every level is here because every level is selectable: the case this form exists for is splitting
 * a feature out into an epic of its own and promoting its tasks in the same request, and a flattening
 * that stopped at the archetypes the desks draw would make that case unreachable.
 *
 * <p><b>This is where the wire's two spellings of one idea are reconciled.</b> A feature is finished
 * by `implementedOn` and a task by `implementedAt`, and the registry calls both `IMPLEMENTED_AT`;
 * likewise `dependsOnFeatureId` and `dependsOnTaskId` are both `DEPENDS_ON`. Doing that here, once,
 * is what lets every rule above read one property name.
 *
 * <p><b>Blank and null are dropped rather than stored as empty strings</b>, so `values` says what a
 * row carries and nothing else. {@link lostProperties} is a set difference over exactly that.
 *
 * <p>The order is the read's: each epic, then its features and their tasks, then the tickets — which
 * is the order a person scans a picker in, and the order the project's own reads arrive in.
 */
export function subjectsOf(entities: readonly Entity[]): readonly TransitionSubject[] {
  const subjects: TransitionSubject[] = [];
  for (const entity of entities) {
    if (entity.archetype === 'EPIC') {
      subjects.push({
        id: entity.id,
        archetype: 'EPIC',
        title: entity.title,
        number: entity.number,
        qualifiedId: entity.qualifiedId,
        parentId: null,
        projectId: entity.projectId,
        values: valuesOf({
          TITLE: entity.title,
          SLUG: entity.slug,
          DESCRIPTION: entity.description,
          STATUS: entity.status,
          SUPERSEDED_BY: entity.supersededByEpicId,
        }),
      });
      for (const node of entity.features) {
        const feature = node.feature;
        subjects.push({
          id: feature.id,
          archetype: 'FEATURE',
          title: feature.title,
          number: feature.number,
          qualifiedId: feature.qualifiedId,
          parentId: feature.epicId,
          projectId: feature.projectId,
          values: valuesOf({
            TITLE: feature.title,
            SLUG: feature.slug,
            DESCRIPTION: feature.description,
            IMPLEMENTED_AT: feature.implementedOn,
            DEPENDS_ON: feature.dependsOnFeatureId,
          }),
        });
        for (const task of node.tasks) {
          subjects.push({
            id: task.id,
            archetype: 'TASK',
            title: task.title,
            number: task.number,
            qualifiedId: task.qualifiedId,
            parentId: task.featureId,
            projectId: task.projectId,
            values: valuesOf({
              TITLE: task.title,
              SLUG: task.slug,
              DESCRIPTION: task.description,
              REPOSITORY_ID: task.repositoryId,
              IMPLEMENTED_AT: task.implementedAt,
              DEPENDS_ON: task.dependsOnTaskId,
            }),
          });
        }
      }
    } else {
      subjects.push({
        id: entity.id,
        archetype: 'TICKET',
        title: entity.title,
        number: entity.number,
        qualifiedId: entity.qualifiedId,
        parentId: null,
        projectId: entity.projectId,
        values: valuesOf({
          TITLE: entity.title,
          SLUG: entity.slug,
          DESCRIPTION: entity.description,
          STATUS: entity.status,
          TICKET_TYPE: entity.type,
          IMPETUS: entity.impetus,
          ASSIGNEE: entity.assignee,
          CREATED_BY: entity.createdBy,
        }),
      });
    }
  }
  return subjects;
}

/** The properties that carry something, blanks and nulls dropped. See {@link subjectsOf}. */
function valuesOf(candidate: Readonly<Record<string, string | null>>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [property, value] of Object.entries(candidate)) {
    if (value !== null && value.trim().length > 0) {
      values[property] = value;
    }
  }
  return values;
}

/**
 * **One draft, as the wire takes it.**
 *
 * <p><b>The wire key is derived from the property name, never looked up.</b> Every property the
 * service names is `SCREAMING_SNAKE` and every JSON key is its `camelCase` — `TICKET_TYPE` to
 * `ticketType`, `SUPERSEDED_BY` to `supersededBy`, `TITLE` to `title` — so the transformation is a
 * rule and a table of twelve pairs would only be a chance to get one of them wrong. It is also the
 * other half of "a fifth property needs no client change": the registry names it, the label rule draws
 * it, and this rule sends it.
 *
 * <p><b>A blank value is left off, and leaving it off is how it is cleared.</b> The door is a PUT, so
 * absence is the clear — there is no second spelling and no paired boolean the way a ticket's partial
 * edit has one. That is also why {@link lostProperties} has a warning to show: absence is destructive
 * here by design.
 *
 * <p>Only the target archetype's statable properties are sent. A value left over from what the subject
 * used to be — an impetus on a row becoming a feature — is dropped here as well as warned about, so
 * the request never states a property the target does not permit.
 */
export function draftToRequest(
  registry: ArchetypeRegistry,
  draft: TransitionDraft,
): EntityTransitionRequest {
  const body: Record<string, unknown> = {
    archetype: draft.archetype,
    membership: { parent: draft.parentId },
  };
  for (const property of statableProperties(registry, draft.archetype)) {
    const value = (draft.values[property] ?? '').trim();
    if (value.length > 0) {
      body[wireKey(property)] = value;
    }
  }
  return body as EntityTransitionRequest;
}

/** `TICKET_TYPE` to `ticketType`. The whole of the naming contract, as a rule. */
function wireKey(property: string): string {
  const [head, ...rest] = property.toLowerCase().split('_');
  return head + rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

/**
 * Whether a draft is complete enough to send: every required field filled, and a parent where the
 * target cannot be a root.
 *
 * <p>Checked here as well as by the service, and the division is the usual one: the server decides,
 * this only decides what is worth offering. A submit that is certain to come back a 400 is a round
 * trip a reader pays for and learns nothing from — and in a map-shaped write it is worse than that,
 * because one incomplete entry refuses the whole request and takes every other entry's change with it.
 */
export function isSubmittable(registry: ArchetypeRegistry, draft: TransitionDraft): boolean {
  const spec = specOf(registry, draft.archetype);
  if (!spec) {
    return false;
  }
  if (!spec.mayBeRoot && draft.parentId === null) {
    return false;
  }
  return requiredFieldsFor(registry, draft.archetype).every(
    (property) => (draft.values[property] ?? '').trim().length > 0,
  );
}
