import type { ArchetypeRegistry } from '../api/archetypes-api';
import type { BlockSource, EpicDto, FeatureDto, TaskDto, TicketDto, TicketType } from '../api/dto';
import {
  AGENT_WAITING_BADGE,
  BLOCKED_BADGE,
  blockedBadges,
  blockedReasonLine,
  criteriaEditable,
  criterionProblems,
  entityBySlug,
  epicBranch,
  epicEntity,
  epicProgress,
  epicStatus,
  featureBranch,
  featureStatus,
  gateHint,
  gateHints,
  groupByStatus,
  isEdited,
  isEpic,
  isExplicitBlock,
  isFinalStatus,
  isTicket,
  lifecycleMoves,
  lifecycleOf,
  newestFirst,
  ofArchetype,
  permits,
  refiningBranch,
  statusBadge,
  statusVocabulary,
  statusesOf,
  taskBranch,
  taskStatus,
  ticketEntity,
  ticketTypeBadge,
  type Entity,
  type EpicEntity,
  type FeatureNode,
  type TicketEntity,
} from './entities-model';

const AT = '2026-08-08T09:00:00Z';

/** The served lifecycle, as the registry states it — the vocabulary every rule below reads. */
const WORDS = ['REPORTED', 'REFINED', 'IMPLEMENTED', 'VERIFIED', 'DONE', 'DROPPED'];

/** The served moves, as the service states them: forward, back, then drop/reopen; DONE is final. */
const TRANSITIONS = {
  REPORTED: [
    { to: 'REFINED', kind: 'FORWARD' },
    { to: 'DROPPED', kind: 'DROP' },
  ],
  REFINED: [
    { to: 'IMPLEMENTED', kind: 'FORWARD' },
    { to: 'REPORTED', kind: 'BACK' },
    { to: 'DROPPED', kind: 'DROP' },
  ],
  IMPLEMENTED: [
    { to: 'VERIFIED', kind: 'FORWARD' },
    { to: 'REFINED', kind: 'BACK' },
    { to: 'DROPPED', kind: 'DROP' },
  ],
  VERIFIED: [
    { to: 'DONE', kind: 'FORWARD' },
    { to: 'IMPLEMENTED', kind: 'BACK' },
    { to: 'DROPPED', kind: 'DROP' },
  ],
  DONE: [],
  DROPPED: [{ to: 'REPORTED', kind: 'REOPEN' }],
};

const REGISTRY: ArchetypeRegistry = {
  properties: ['TITLE', 'STATUS'],
  serverOwned: [],
  archetypes: [spec('EPIC', WORDS), spec('TICKET', WORDS), spec('FEATURE', []), spec('TASK', [])],
};

function spec(archetype: string, lifecycle: readonly string[]) {
  return {
    archetype,
    depth: 0,
    mayBeRoot: true,
    required: [],
    requiredOnTransition: [],
    permitted: [],
    // Served alphabetically — the walk is `lifecycle`, and nothing may read order off this one.
    legalStatuses: [...lifecycle].sort(),
    lifecycle,
    transitions: lifecycle.length > 0 ? TRANSITIONS : {},
  };
}
const TICKET_AT = '2026-09-07T09:00:00Z';

function epicDto(over: Partial<EpicDto> = {}): EpicDto {
  return {
    id: 'e1',
    projectId: 'p1',
    title: 'Epics on the project page',
    slug: 'epics-overview',
    description: null,
    number: 12,
    qualifiedId: 'qits-12',
    status: 'REFINED',
    supersededByEpicId: null,
    createdAt: AT,
    updatedAt: AT,
    workspaces: [],
    ...over,
  };
}

function feature(over: Partial<FeatureDto> = {}): FeatureDto {
  return {
    id: 'f1',
    epicId: 'e1',
    projectId: 'p1',
    title: 'Read the epics',
    slug: 'read-the-epics',
    description: null,
    number: 13,
    qualifiedId: 'qits-13',
    dependsOnFeatureId: null,
    implementedOn: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function task(over: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 't1',
    featureId: 'f1',
    repositoryId: 'r1',
    projectId: 'p1',
    title: 'Add the endpoints',
    slug: 'add-the-endpoints',
    description: null,
    number: 14,
    qualifiedId: 'qits-14',
    dependsOnTaskId: null,
    implementedAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function epic(features: readonly FeatureNode[] = [], over: Partial<EpicDto> = {}): EpicEntity {
  return epicEntity(epicDto(over), features);
}

/** An epic whose every feature is implemented — the shape "done" is derived from. */
function finished(over: Partial<EpicDto> = {}): EpicEntity {
  return epic([{ feature: feature({ implementedOn: AT }), tasks: [] }], over);
}

function ticketDto(over: Partial<TicketDto> = {}): TicketDto {
  return {
    id: 't1',
    projectId: 'p1',
    title: 'The cancelled badge is the wrong colour',
    slug: 'cancelled-badge',
    number: 41,
    qualifiedId: 'qits-41',
    type: 'BUG',
    status: 'REPORTED',
    assignee: null,
    createdBy: null,
    impetus: 'The badge reads as success when a run is cancelled.',
    description: null,
    createdAt: TICKET_AT,
    updatedAt: TICKET_AT,
    workspaces: [],
    ...over,
  };
}

function ticket(over: Partial<TicketDto> = {}): TicketEntity {
  return ticketEntity(ticketDto(over));
}

/**
 * **One model over two archetypes**, asserted without a component around it.
 *
 * <p>Everything the one desk and the entity page are drawn from is in this file, and most of it is the
 * kind of rule that stays plausible while being wrong. A **branch name** one segment off sends somebody to a ref that
 * does not exist. A **grouping** decides which section a row appears in, and a row in neither is
 * simply gone from the page with nothing to see. An **ordering** is imposed here rather than taken
 * from the server, so the day the service's sort changes this file is what keeps the screen the right
 * way up. And the **archetype** is now what tells the two apart at all, so a filter that let one leak
 * into the other's desk would be the worst of the lot.
 */
describe('entities model', () => {
  describe('the archetype', () => {
    /** The discriminant is stamped at the boundary, because the wire does not carry it. */
    it('stamps an epic and a ticket with the archetype the endpoint implied', () => {
      expect(epic().archetype).toBe('EPIC');
      expect(ticket().archetype).toBe('TICKET');
    });

    /** Lifting the shared fields is what lets a card take either without asking which it got. */
    it('lifts the fields both archetypes have onto both of them', () => {
      const both: readonly Entity[] = [epic(), ticket()];

      for (const entity of both) {
        expect(entity.id.length).toBeGreaterThan(0);
        expect(entity.projectId).toBe('p1');
        expect(entity.title.length).toBeGreaterThan(0);
        expect(entity.slug.length).toBeGreaterThan(0);
        expect(entity.createdAt).toBeTruthy();
        expect(entity.workspaces).toEqual([]);
      }
    });

    /** The pair the unified entity was for: a short number, and the spelling a person writes. */
    it('carries the number and the qualified id across from the wire', () => {
      expect(epic().number).toBe(12);
      expect(epic().qualifiedId).toBe('qits-12');
      expect(ticket().number).toBe(41);
      expect(ticket().qualifiedId).toBe('qits-41');
    });

    /** Null is the service saying it could not resolve the project — a screen draws nothing for it. */
    it('carries a null qualified id through rather than inventing one', () => {
      expect(epic([], { qualifiedId: null }).qualifiedId).toBeNull();
      expect(ticket({ qualifiedId: null }).qualifiedId).toBeNull();
    });

    /**
     * `blocked` is optional on the wire and required on the model for both archetypes now — an epic
     * blocks through the same door a ticket does, not only a ticket.
     */
    it('resolves a missing blocked to false, and carries a true one through, on both archetypes', () => {
      expect(epic().blocked).toBe(false);
      expect(epic([], { blocked: true }).blocked).toBe(true);
      expect(ticket().blocked).toBe(false);
      expect(ticket({ blocked: true }).blocked).toBe(true);
    });

    /** qits-895: the effective block's source, reason and who-set-it ride through, on both archetypes. */
    it('carries the block source, reason and who blocked it through, on both archetypes', () => {
      const over = {
        blocked: true,
        blockSource: 'EXPLICIT' as const,
        blockReason: 'Waiting on a design decision.',
        blockedBy: 'kim',
      };
      const blockedEpic = epic([], over);
      expect(blockedEpic.blockSource).toBe('EXPLICIT');
      expect(blockedEpic.blockReason).toBe('Waiting on a design decision.');
      expect(blockedEpic.blockedBy).toBe('kim');

      const blockedTicket = ticket(over);
      expect(blockedTicket.blockSource).toBe('EXPLICIT');
      expect(blockedTicket.blockReason).toBe('Waiting on a design decision.');
      expect(blockedTicket.blockedBy).toBe('kim');
    });

    it('tells the two apart with guards that narrow', () => {
      expect(isEpic(epic())).toBe(true);
      expect(isEpic(ticket())).toBe(false);
      expect(isTicket(ticket())).toBe(true);
      expect(isTicket(epic())).toBe(false);
    });

    /** The filter, which is the one place a desk says which archetype it is. */
    it('filters a mixed collection down to one archetype, keeping the order', () => {
      const rows: readonly Entity[] = [
        epic([], { id: 'e1' }),
        ticket({ id: 't1' }),
        epic([], { id: 'e2' }),
        ticket({ id: 't2' }),
      ];

      expect(ofArchetype(rows, 'EPIC').map((row) => row.id)).toEqual(['e1', 'e2']);
      expect(ofArchetype(rows, 'TICKET').map((row) => row.id)).toEqual(['t1', 't2']);
    });

    it('answers nothing for an archetype the collection has none of', () => {
      expect(ofArchetype([ticket()], 'EPIC')).toEqual([]);
      expect(ofArchetype([], 'TICKET')).toEqual([]);
    });
  });

  /**
   * The convention, asserted segment by segment. A branch name is the one thing on an epic's card a
   * reader copies into a terminal, so an extra or a missing segment is a ref that does not exist.
   */
  describe('branch names', () => {
    it('names an epic branch after its slug', () => {
      expect(epicBranch('epics-overview')).toBe('epic/epics-overview');
    });

    it('repeats the epic’s slug in a feature branch', () => {
      expect(featureBranch('epics-overview', 'read-the-epics')).toBe(
        'feature/epics-overview/read-the-epics',
      );
    });

    it('repeats both ancestors in a task branch', () => {
      expect(taskBranch('epics-overview', 'read-the-epics', 'add-the-endpoints')).toBe(
        'task/epics-overview/read-the-epics/add-the-endpoints',
      );
    });

    /**
     * A fresh top-level prefix, which is the whole point: a refining branch is where the plan is
     * written and cannot be read as the epic's own branch at any depth.
     */
    it('gives a refining branch its own namespace, above the plan’s three', () => {
      expect(refiningBranch('epics-overview')).toBe('refining/epics-overview');
      expect(refiningBranch('epics-overview').startsWith('epic/')).toBe(false);
    });
  });

  /** Two spellings of one idea on the wire, so each level is asserted against its own field. */
  describe('taskStatus and featureStatus', () => {
    it('reads a task’s completion from implementedAt', () => {
      expect(taskStatus(task())).toEqual({ label: 'open', tone: 'neutral' });
      expect(taskStatus(task({ implementedAt: AT }))).toEqual({
        label: 'implemented',
        tone: 'success',
      });
    });

    it('reads a feature’s completion from implementedOn', () => {
      expect(featureStatus(feature())).toEqual({ label: 'open', tone: 'neutral' });
      expect(featureStatus(feature({ implementedOn: AT }))).toEqual({
        label: 'implemented',
        tone: 'success',
      });
    });

    /** `implementingAt`/`implementingOn` are the platform's own marker, stamped at dispatch. */
    it('reads a task as implementing once implementingAt is set and implementedAt is not', () => {
      expect(taskStatus(task({ implementingAt: AT }))).toEqual({
        label: 'implementing',
        tone: 'info',
      });
    });

    it('reads a feature as implementing once implementingOn is set and implementedOn is not', () => {
      expect(featureStatus(feature({ implementingOn: AT }))).toEqual({
        label: 'implementing',
        tone: 'info',
      });
    });

    it('prefers implemented over implementing when both markers are set', () => {
      expect(taskStatus(task({ implementingAt: AT, implementedAt: AT }))).toEqual({
        label: 'implemented',
        tone: 'success',
      });
      expect(featureStatus(feature({ implementingOn: AT, implementedOn: AT }))).toEqual({
        label: 'implemented',
        tone: 'success',
      });
    });

    /**
     * qits-763: once the service serves a status for a feature or a task, that status is the badge —
     * never the markers, and never the generic "implemented"/"open" words, even where the status
     * happens to be further along than either marker would suggest.
     */
    it('prefers its own status over the markers once the service serves one', () => {
      expect(taskStatus(task({ status: 'VERIFYING' }))).toEqual({
        label: 'verifying',
        tone: 'info',
      });
      expect(taskStatus(task({ status: 'VERIFIED', implementedAt: AT }))).toEqual({
        label: 'verified',
        tone: 'warning',
      });
      expect(featureStatus(feature({ status: 'DONE', implementedOn: AT }))).toEqual({
        label: 'done',
        tone: 'success',
      });
    });

    it('falls back to the markers when status is null — the service before qits-763', () => {
      expect(taskStatus(task({ status: null, implementedAt: AT }))).toEqual({
        label: 'implemented',
        tone: 'success',
      });
      expect(featureStatus(feature({ status: null, implementingOn: AT }))).toEqual({
        label: 'implementing',
        tone: 'info',
      });
    });
  });

  describe('epicStatus', () => {
    it('is implemented when every feature is', () => {
      expect(
        epicStatus(
          epic([
            { feature: feature({ id: 'f1', implementedOn: AT }), tasks: [] },
            { feature: feature({ id: 'f2', implementedOn: AT }), tasks: [] },
          ]),
        ),
      ).toEqual({ label: 'implemented', tone: 'success' });
    });

    it('is in progress when some are', () => {
      expect(
        epicStatus(
          epic([
            { feature: feature({ id: 'f1', implementedOn: AT }), tasks: [] },
            { feature: feature({ id: 'f2' }), tasks: [] },
          ]),
        ),
      ).toEqual({ label: 'in progress', tone: 'info' });
    });

    it('is open when none is', () => {
      expect(epicStatus(epic([{ feature: feature(), tasks: [] }]))).toEqual({
        label: 'open',
        tone: 'neutral',
      });
    });

    /** No completion field of its own, so an epic with no features has no evidence to read. */
    it('is open for an epic with no features at all', () => {
      expect(epicStatus(epic([]))).toEqual({ label: 'open', tone: 'neutral' });
    });
  });

  describe('epicProgress', () => {
    it('counts the tree’s tasks, marked and not', () => {
      const tree = epic([
        {
          feature: feature(),
          tasks: [task({ id: 'a', implementedAt: AT }), task({ id: 'b' }), task({ id: 'c' })],
        },
      ]);
      expect(epicProgress(tree)).toEqual({ implemented: 1, total: 3 });
    });

    /** A feature planned without tasks is one unit of its own, marked by its own stamp. */
    it('counts a feature with no tasks as one unit', () => {
      expect(epicProgress(finished())).toEqual({ implemented: 1, total: 1 });
      expect(epicProgress(epic())).toEqual({ implemented: 0, total: 0 });
    });
  });

  /**
   * The badge is generic by construction: the label is the word, lower-cased, whatever the word is —
   * so a word the service adds tomorrow reads correctly before anybody touches this client.
   */
  /** qits-887: the item rules, mirrored for the message — each at its boundary. */
  describe('criterionProblems', () => {
    it('passes a one-line item with one full stop', () => {
      expect(criterionProblems('The badge reads **cancelled** on a cancelled run.')).toEqual([]);
    });

    it('refuses a blank item, and a line break of either kind', () => {
      expect(criterionProblems('   ')).toEqual(['is blank']);
      expect(criterionProblems('one\ntwo')).toEqual(['has a line break']);
      expect(criterionProblems('one\rtwo')).toEqual(['has a line break']);
    });

    it('allows one full stop and refuses two', () => {
      expect(criterionProblems('Done.')).toEqual([]);
      expect(criterionProblems('Done. Really.')).toEqual(['has more than one “.”']);
    });

    it('allows 19 whitespace characters and refuses 20', () => {
      const words = (count: number) => Array.from({ length: count }, () => 'w').join(' ');
      expect(criterionProblems(words(20))).toEqual([]); // 19 spaces
      expect(criterionProblems(words(21))).toEqual(['is too long — fewer than 20 spaces']); // 20 spaces
    });
  });

  describe('permits and criteriaEditable', () => {
    const withCriteria = {
      ...REGISTRY,
      archetypes: [
        {
          ...spec('EPIC', [...WORDS.slice(0, 2), 'READY_FOR_DEV', ...WORDS.slice(2)]),
          permitted: ['ACCEPTANCE_CRITERIA'],
        },
        { ...spec('TICKET', WORDS), permitted: ['acceptanceCriteria'] },
      ],
    };

    it('reads the permission off the registry, in either spelling, and never off the name', () => {
      expect(permits(withCriteria, 'EPIC', 'ACCEPTANCE_CRITERIA')).toBe(true);
      expect(permits(withCriteria, 'TICKET', 'ACCEPTANCE_CRITERIA')).toBe(true);
      expect(permits(REGISTRY, 'EPIC', 'ACCEPTANCE_CRITERIA')).toBe(false);
      expect(permits(null, 'EPIC', 'ACCEPTANCE_CRITERIA')).toBe(false);
    });

    it('opens the criteria before READY_FOR_DEV and freezes them from it on', () => {
      expect(criteriaEditable(withCriteria, 'EPIC', 'REPORTED')).toBe(true);
      expect(criteriaEditable(withCriteria, 'EPIC', 'REFINED')).toBe(true);
      expect(criteriaEditable(withCriteria, 'EPIC', 'READY_FOR_DEV')).toBe(false);
      expect(criteriaEditable(withCriteria, 'EPIC', 'IMPLEMENTED')).toBe(false);
    });

    it('freezes nothing on a walk without READY_FOR_DEV', () => {
      expect(criteriaEditable(withCriteria, 'TICKET', 'IMPLEMENTED')).toBe(true);
      expect(criteriaEditable(withCriteria, 'TICKET', null)).toBe(false);
    });
  });

  describe('statusBadge', () => {
    it('labels every served word with the word itself', () => {
      expect(WORDS.map((word) => statusBadge(word).label)).toEqual([
        'reported',
        'refined',
        'implemented',
        'verified',
        'done',
        'dropped',
      ]);
    });

    it('draws a word it has never seen neutral, under its own name', () => {
      expect(statusBadge('PARKED_FOR_LATER')).toEqual({
        label: 'parked for later',
        tone: 'neutral',
      });
    });

    it('tones the one palette shared with the session names', () => {
      expect(statusBadge('REPORTED').tone).toBe('neutral');
      expect(statusBadge('REFINED').tone).toBe('highlight');
      expect(statusBadge('IMPLEMENTING').tone).toBe('info');
      expect(statusBadge('IMPLEMENTED').tone).toBe('info');
      expect(statusBadge('VERIFYING').tone).toBe('info');
      expect(statusBadge('VERIFIED').tone).toBe('warning');
      expect(statusBadge('DONE').tone).toBe('success');
      expect(statusBadge('DROPPED').tone).toBe('neutral');
    });

    /** qits-887: scheduled and not started — REFINED's purple family, under its own words. */
    it('draws READY_FOR_DEV in REFINED’s tone, labelled ready for dev', () => {
      expect(statusBadge('READY_FOR_DEV')).toEqual({ label: 'ready for dev', tone: 'highlight' });
    });

    it('says so for a node with no status at all', () => {
      expect(statusBadge(null).label).toBe('no status');
    });

    it('keeps blocked a badge of its own, red and apart from every status', () => {
      expect(BLOCKED_BADGE.tone).toBe('danger');
      expect(ticketTypeBadge('BUG').tone).not.toBe(ticketTypeBadge('IMPROVEMENT').tone);
    });

    it('draws maintenance neutral, apart from either a person files', () => {
      expect(ticketTypeBadge('MAINTENANCE')).toEqual({ label: 'maintenance', tone: 'neutral' });
      expect(ticketTypeBadge('MAINTENANCE').tone).not.toBe(ticketTypeBadge('BUG').tone);
      expect(ticketTypeBadge('MAINTENANCE').tone).not.toBe(ticketTypeBadge('IMPROVEMENT').tone);
    });

    it('draws a type it has never seen neutral, under its own name, rather than as improvement', () => {
      expect(ticketTypeBadge('WHATEVER' as TicketType)).toEqual({
        label: 'whatever',
        tone: 'neutral',
      });
    });
  });

  /**
   * qits-895: `blocked` became the *effective* block — an explicit flag OR the agent waiting — and
   * `blockSource` says which. `blockedBadges` and `blockedReasonLine` are the two places that read
   * it, and `isExplicitBlock` is the one-question gate the dispatch hint keys on.
   */
  describe('a blocked entity’s badge and reason', () => {
    function blocked(
      source?: BlockSource,
      reason: string | null = null,
      by: string | null = null,
    ) {
      return { blocked: true, blockSource: source, blockReason: reason, blockedBy: by };
    }

    it('draws no badge and no reason for an entity that is not blocked', () => {
      expect(blockedBadges({ blocked: false })).toEqual([]);
      expect(blockedReasonLine({ blocked: false })).toBe('');
    });

    it('treats an absent blockSource as EXPLICIT — the meaning blocked always had', () => {
      expect(isExplicitBlock({})).toBe(true);
      expect(blockedBadges(blocked())).toEqual([{ ...BLOCKED_BADGE, title: '' }]);
      expect(blockedReasonLine(blocked(undefined, 'Waiting on a design decision.', 'kim'))).toBe(
        'Blocked by kim: Waiting on a design decision.',
      );
    });

    it('draws only the blocked badge for an explicit block, titled with who and why', () => {
      const row = blocked('EXPLICIT', 'Waiting on a design decision.', 'kim');
      expect(isExplicitBlock(row)).toBe(true);
      expect(blockedBadges(row)).toEqual([
        { ...BLOCKED_BADGE, title: 'Blocked by kim: Waiting on a design decision.' },
      ]);
      expect(blockedReasonLine(row)).toBe('Blocked by kim: Waiting on a design decision.');
    });

    it('draws only "waiting for you" for a pure AGENT_WAITING block, never refusing a dispatch', () => {
      const sentence = 'The agent ended its turn with nothing in flight and is waiting for a person.';
      const row = blocked('AGENT_WAITING', sentence);
      expect(isExplicitBlock(row)).toBe(false);
      expect(blockedBadges(row)).toEqual([{ ...AGENT_WAITING_BADGE, title: sentence }]);
      expect(blockedReasonLine(row)).toBe('The agent is waiting for you.');
    });

    it('draws both badges for BOTH, and reads the explicit half as the one Unblock clears', () => {
      const row = blocked('BOTH', 'Waiting on a design decision.', 'kim');
      expect(isExplicitBlock(row)).toBe(true);
      expect(blockedBadges(row)).toEqual([
        { ...BLOCKED_BADGE, title: 'Blocked by kim: Waiting on a design decision.' },
        { ...AGENT_WAITING_BADGE, title: 'Waiting on a design decision.' },
      ]);
      expect(blockedReasonLine(row)).toBe('Blocked by kim: Waiting on a design decision.');
    });

    it('titles the explicit badge with whichever half of who/why it has', () => {
      expect(blockedBadges(blocked('EXPLICIT', null, 'kim'))[0].title).toBe('Blocked by kim');
      expect(blockedBadges(blocked('EXPLICIT', 'Waiting on design.', null))[0].title).toBe(
        'Waiting on design.',
      );
    });
  });

  describe('the vocabulary', () => {
    it('reads the words off the served lifecycle, in walk order, each once', () => {
      expect(statusVocabulary(REGISTRY)).toEqual(WORDS);
      expect(lifecycleOf(REGISTRY, 'TICKET')).toEqual(WORDS);
    });

    it('answers no words for an archetype with no lifecycle', () => {
      expect(statusesOf(REGISTRY, 'TASK')).toEqual([]);
      expect([...statusesOf(REGISTRY, 'EPIC')].sort()).toEqual([...WORDS].sort());
      expect(statusesOf(REGISTRY, 'NOPE')).toEqual([]);
      expect(lifecycleOf(REGISTRY, 'TASK')).toEqual([]);
    });

    /** qits-392 deleted four epic words; a client with its own list would still be drawing them. */
    it('carries no word the registry does not serve', () => {
      const narrow: ArchetypeRegistry = { ...REGISTRY, archetypes: [spec('EPIC', ['B', 'A'])] };
      expect(statusVocabulary(narrow)).toEqual(['B', 'A']);
    });

    it('falls back to legalStatuses on a server that serves no lifecycle', () => {
      const older: Partial<ReturnType<typeof spec>> = spec('EPIC', ['B', 'A']);
      delete older.lifecycle;
      const registry = { ...REGISTRY, archetypes: [older] } as ArchetypeRegistry;
      expect(statusVocabulary(registry)).toEqual(['A', 'B']);
    });
  });

  describe('groupByStatus', () => {
    it('splits a mixed desk by status, in the served order, empty sections dropped', () => {
      const groups = groupByStatus(
        [
          ticket({ id: 'a', status: 'DONE' }),
          epic([], { id: 'b', status: 'REPORTED' }),
          ticket({ id: 'c', status: 'REPORTED' }),
          epic([], { id: 'd', status: 'REFINED' }),
        ],
        WORDS,
      );
      expect(groups.map((group) => group.status)).toEqual(['REPORTED', 'REFINED', 'DONE']);
      expect(groups[0].entities.map((entity) => entity.id).sort()).toEqual(['b', 'c']);
    });

    it('collapses the two endings and leaves the work open', () => {
      const groups = groupByStatus(
        [ticket({ status: 'DROPPED' }), ticket({ id: 'x', status: 'REFINED' })],
        WORDS,
      );
      expect(groups.map((group) => [group.status, group.archive])).toEqual([
        ['REFINED', false],
        ['DROPPED', true],
      ]);
    });

    /** A row off the vocabulary belongs at the bottom of the desk, not off it. */
    it('keeps a status the vocabulary does not know, at the end, under its own word', () => {
      const groups = groupByStatus(
        [ticket({ status: 'PARKED' }), ticket({ id: 'x', status: 'REPORTED' })],
        WORDS,
      );
      expect(groups.map((group) => group.status)).toEqual(['REPORTED', 'PARKED']);
      expect(groups[1].badge.label).toBe('parked');
    });

    it('orders each section newest first', () => {
      const groups = groupByStatus(
        [
          ticket({ id: 'old', createdAt: '2026-09-01T00:00:00Z' }),
          ticket({ id: 'new', createdAt: '2026-09-09T00:00:00Z' }),
        ],
        WORDS,
      );
      expect(groups[0].entities.map((entity) => entity.id)).toEqual(['new', 'old']);
    });

    it('answers no sections for no entities', () => {
      expect(groupByStatus([], WORDS)).toEqual([]);
    });
  });

  describe('newestFirst', () => {
    it('breaks a tie on the incoming order reversed, and sinks a stamp it cannot parse', () => {
      const rows = newestFirst([
        ticket({ id: 'a' }),
        ticket({ id: 'b' }),
        ticket({ id: 'c', createdAt: 'nonsense' }),
      ]);
      expect(rows.map((row) => row.id)).toEqual(['b', 'a', 'c']);
    });
  });

  /** The moves are served — labels and weight come from the kind, the order from the service. */
  describe('lifecycleMoves', () => {
    it('offers a refined ticket the step forward as primary, the step back and the drop', () => {
      expect(lifecycleMoves(REGISTRY, 'TICKET', 'REFINED')).toEqual([
        {
          target: 'IMPLEMENTED',
          kind: 'FORWARD',
          label: 'Mark implemented',
          variant: 'primary',
          gates: [],
        },
        {
          target: 'REPORTED',
          kind: 'BACK',
          label: 'Back to reported',
          variant: 'ghost',
          gates: [],
        },
        { target: 'DROPPED', kind: 'DROP', label: 'Drop', variant: 'ghost', gates: [] },
      ]);
    });

    /** qits-887: a move's served gates ride along, and are hinted in plain words. */
    it('carries a move’s served gates, and says each as a hint', () => {
      const gated = {
        ...REGISTRY,
        archetypes: [
          {
            ...spec('EPIC', WORDS),
            transitions: {
              ...TRANSITIONS,
              REFINED: [
                {
                  to: 'READY_FOR_DEV',
                  kind: 'FORWARD',
                  gates: ['ACCEPTANCE_CRITERIA', 'PERSON_APPROVAL'],
                },
              ],
            },
          },
        ],
      };
      const [move] = lifecycleMoves(gated, 'EPIC', 'REFINED');
      expect(move.gates).toEqual(['ACCEPTANCE_CRITERIA', 'PERSON_APPROVAL']);
      expect(gateHints(move)).toBe('needs acceptance criteria, needs a person');
      expect(gateHint('A_NEW_GATE')).toBe('needs a new gate');
    });

    it('offers a done entity nothing at all, and calls it final', () => {
      expect(lifecycleMoves(REGISTRY, 'EPIC', 'DONE')).toEqual([]);
      expect(isFinalStatus(REGISTRY, 'EPIC', 'DONE')).toBe(true);
      expect(isFinalStatus(REGISTRY, 'EPIC', 'VERIFIED')).toBe(false);
    });

    it('offers a dropped entity the reopen, and nothing else', () => {
      expect(lifecycleMoves(REGISTRY, 'TICKET', 'DROPPED').map((move) => move.label)).toEqual([
        'Reopen',
      ]);
    });

    /** An older server mid-rollout: no guess, no hardcoded fallback — and nothing is called final. */
    it('offers nothing where the registry serves no transitions', () => {
      const older: Partial<ReturnType<typeof spec>> = spec('TICKET', WORDS);
      delete older.transitions;
      const registry = { ...REGISTRY, archetypes: [older] } as ArchetypeRegistry;
      for (const word of WORDS) {
        expect(lifecycleMoves(registry, 'TICKET', word)).toEqual([]);
      }
      expect(isFinalStatus(registry, 'TICKET', 'DONE')).toBe(false);
    });

    /** `SKIP` (qits-749): REFINED straight to IMPLEMENTED, with no IMPLEMENTING in between. */
    it('labels a skip step as skipping to its target', () => {
      const withSkip: ArchetypeRegistry = {
        ...REGISTRY,
        archetypes: [
          {
            ...spec('TICKET', WORDS),
            transitions: {
              ...TRANSITIONS,
              REFINED: [...TRANSITIONS.REFINED, { to: 'IMPLEMENTED', kind: 'SKIP' }],
            },
          },
        ],
      };
      expect(lifecycleMoves(withSkip, 'TICKET', 'REFINED')).toEqual([
        {
          target: 'IMPLEMENTED',
          kind: 'FORWARD',
          label: 'Mark implemented',
          variant: 'primary',
          gates: [],
        },
        {
          target: 'REPORTED',
          kind: 'BACK',
          label: 'Back to reported',
          variant: 'ghost',
          gates: [],
        },
        { target: 'DROPPED', kind: 'DROP', label: 'Drop', variant: 'ghost', gates: [] },
        {
          target: 'IMPLEMENTED',
          kind: 'SKIP',
          label: 'Skip to implemented',
          variant: 'ghost',
          gates: [],
        },
      ]);
    });

    it('draws a kind it has never met plainly', () => {
      const odd: ArchetypeRegistry = {
        ...REGISTRY,
        archetypes: [
          { ...spec('TICKET', ['A', 'B']), transitions: { A: [{ to: 'B', kind: 'X' }] } },
        ],
      };
      expect(lifecycleMoves(odd, 'TICKET', 'A')).toEqual([
        { target: 'B', kind: 'X', label: 'Move to b', variant: 'ghost', gates: [] },
      ]);
    });

    it('offers nothing to a node with no status, no lifecycle or no registry', () => {
      expect(lifecycleMoves(REGISTRY, 'TICKET', null)).toEqual([]);
      expect(lifecycleMoves(REGISTRY, 'TASK', 'REPORTED')).toEqual([]);
      expect(lifecycleMoves(null, 'TICKET', 'REPORTED')).toEqual([]);
    });
  });

  describe('resolving a slug', () => {
    it('finds the entity the address names', () => {
      const rows = [ticket({ id: 'a', slug: 'one' }), ticket({ id: 'b', slug: 'two' })];

      expect(entityBySlug(rows, 'TICKET', 'two')?.id).toBe('b');
    });

    /** A slug nobody has is an ordinary not-found, which is what the detail page draws. */
    it('answers null for a slug the project does not hold', () => {
      expect(entityBySlug([ticket({ slug: 'one' })], 'TICKET', 'nope')).toBeNull();
      expect(entityBySlug([], 'TICKET', 'one')).toBeNull();
    });

    /** The segment is the slug by construction, so matching an id would bless an untested address. */
    it('does not match on the id, which the address grammar never carries', () => {
      expect(entityBySlug([ticket({ id: 't1', slug: 'one' })], 'TICKET', 't1')).toBeNull();
    });

    /**
     * A slug is only unique within an archetype, so the archetype is part of the question: an epic
     * called `cancelled-badge` must not answer the tickets desk's address.
     */
    it('refuses a row of the other archetype that happens to share the slug', () => {
      const rows: readonly Entity[] = [
        epic([], { id: 'e1', slug: 'cancelled-badge' }),
        ticket({ id: 't1', slug: 'cancelled-badge' }),
      ];

      expect(entityBySlug(rows, 'TICKET', 'cancelled-badge')?.id).toBe('t1');
      expect(entityBySlug(rows, 'EPIC', 'cancelled-badge')?.id).toBe('e1');
    });
  });

  describe('the edited hint', () => {
    it('says nothing about a comment as it was written', () => {
      expect(isEdited({ createdAt: AT, updatedAt: AT })).toBe(false);
    });

    it('says edited once the update has moved past the creation', () => {
      expect(isEdited({ createdAt: AT, updatedAt: '2026-09-07T10:00:00Z' })).toBe(true);
    });

    /** Compared as instants, not as strings: the service is free to change how it formats one. */
    it('reads two spellings of the same instant as unedited', () => {
      expect(
        isEdited({ createdAt: '2026-09-07T09:00:00Z', updatedAt: '2026-09-07T09:00:00.000Z' }),
      ).toBe(false);
    });

    it('stays quiet about a stamp it cannot parse, rather than guessing', () => {
      expect(isEdited({ createdAt: 'nonsense', updatedAt: AT })).toBe(false);
      expect(isEdited({ createdAt: AT, updatedAt: 'nonsense' })).toBe(false);
    });
  });
});
