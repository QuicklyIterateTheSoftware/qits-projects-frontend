import type { ArchetypeRegistry } from '../api/archetypes-api';
import type { EpicDto, FeatureDto, TaskDto, TicketDto } from '../api/dto';
import {
  BLOCKED_BADGE,
  LIFECYCLE_TRANSITIONS,
  entityBySlug,
  epicBranch,
  epicEntity,
  epicProgress,
  epicStatus,
  featureBranch,
  featureStatus,
  groupByStatus,
  isEdited,
  isEpic,
  isTicket,
  lifecycleMoves,
  newestFirst,
  ofArchetype,
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

const REGISTRY: ArchetypeRegistry = {
  properties: ['TITLE', 'STATUS'],
  serverOwned: [],
  archetypes: [
    spec('EPIC', WORDS),
    spec('TICKET', WORDS),
    spec('FEATURE', []),
    spec('TASK', []),
  ],
};

function spec(archetype: string, legalStatuses: readonly string[]) {
  return {
    archetype,
    depth: 0,
    mayBeRoot: true,
    required: [],
    requiredOnTransition: [],
    permitted: [],
    legalStatuses,
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

    it('tones how finished, keeping verified out of the done tone', () => {
      expect(statusBadge('REPORTED').tone).toBe('warning');
      expect(statusBadge('VERIFIED').tone).toBe('info');
      expect(statusBadge('DONE').tone).toBe('success');
      expect(statusBadge('DROPPED').tone).toBe('neutral');
    });

    it('says so for a node with no status at all', () => {
      expect(statusBadge(null).label).toBe('no status');
    });

    it('keeps blocked a badge of its own, and the two types apart', () => {
      expect(BLOCKED_BADGE.tone).toBe('warning');
      expect(ticketTypeBadge('BUG').tone).not.toBe(ticketTypeBadge('IMPROVEMENT').tone);
    });
  });

  describe('the vocabulary', () => {
    it('reads the words off the registry, in its order, each once', () => {
      expect(statusVocabulary(REGISTRY)).toEqual(WORDS);
    });

    it('answers no words for an archetype with no lifecycle', () => {
      expect(statusesOf(REGISTRY, 'TASK')).toEqual([]);
      expect(statusesOf(REGISTRY, 'EPIC')).toEqual(WORDS);
      expect(statusesOf(REGISTRY, 'NOPE')).toEqual([]);
    });

    /** qits-392 deleted four epic words; a client with its own list would still be drawing them. */
    it('carries no word the registry does not serve', () => {
      const narrow: ArchetypeRegistry = { ...REGISTRY, archetypes: [spec('EPIC', ['A', 'B'])] };
      expect(statusVocabulary(narrow)).toEqual(['A', 'B']);
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

  /** One lifecycle for epics and tickets (qits-392): the same steps, labelled off the served order. */
  describe('lifecycleMoves', () => {
    it('offers both neighbours from the middle, forward first and the exit last', () => {
      expect(lifecycleMoves('IMPLEMENTED', WORDS)).toEqual([
        { target: 'VERIFIED', label: 'Mark verified', forward: true },
        { target: 'REFINED', label: 'Back to refined', forward: false },
        { target: 'DROPPED', label: 'Mark dropped', forward: false },
      ]);
    });

    it('offers a reported entity the refine step and the exit, and never a way to stand still', () => {
      expect(lifecycleMoves('REPORTED', WORDS).map((move) => move.target)).toEqual([
        'REFINED',
        'DROPPED',
      ]);
    });

    it('offers a done entity the step back and no exit, and a dropped one the way back to reported', () => {
      expect(lifecycleMoves('DONE', WORDS).map((move) => move.label)).toEqual([
        'Back to verified',
      ]);
      expect(lifecycleMoves('DROPPED', WORDS).map((move) => move.label)).toEqual([
        'Back to reported',
      ]);
    });

    it('never offers the status already held, for every served word', () => {
      for (const word of WORDS) {
        expect(lifecycleMoves(word, WORDS).map((move) => move.target)).not.toContain(word);
        expect(lifecycleMoves(word, WORDS).map((move) => move.target).sort()).toEqual(
          [...LIFECYCLE_TRANSITIONS[word]].sort(),
        );
      }
    });

    /** The edges are mirrored; the words are served — a target the registry drops is never offered. */
    it('offers no target the served vocabulary does not hold', () => {
      const narrow = ['REPORTED', 'REFINED', 'IMPLEMENTED'];
      expect(lifecycleMoves('REFINED', narrow).map((move) => move.target).sort()).toEqual([
        'IMPLEMENTED',
        'REPORTED',
      ]);
    });

    it('falls back to the served neighbours for a word the mirror has never heard of', () => {
      // The served order's last word is the exit, so it is drawn last and never as forward.
      expect(lifecycleMoves('B', ['A', 'B', 'C']).map((move) => move.label)).toEqual([
        'Back to a',
        'Mark c',
      ]);
    });

    it('offers nothing to a node with no status', () => {
      expect(lifecycleMoves(null, WORDS)).toEqual([]);
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
