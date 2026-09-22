import type { ArchetypeRegistry } from '../api/archetypes-api';
import type { EpicDto, FeatureDto, TaskDto, TicketDto } from '../api/dto';
import { epicEntity, ticketEntity, type Entity } from './entities-model';
import {
  attributableProperties,
  attributeViolations,
  draftToRequest,
  isSubmittable,
  legalParentsFor,
  lostProperties,
  mayContain,
  propertyLabel,
  requiredFieldsFor,
  specOf,
  statableProperties,
  subjectsOf,
  type TransitionDraft,
  type TransitionSubject,
} from './entity-transition-model';

const AT = '2026-09-19T09:00:00Z';

/** The service's answer, verbatim — every rule these derivations make is read off this and nothing else. */
const REGISTRY: ArchetypeRegistry = {
  properties: [
    'TITLE',
    'SLUG',
    'DESCRIPTION',
    'STATUS',
    'TICKET_TYPE',
    'IMPETUS',
    'ASSIGNEE',
    'CREATED_BY',
    'SUPERSEDED_BY',
    'REPOSITORY_ID',
    'IMPLEMENTED_AT',
    'DEPENDS_ON',
  ],
  serverOwned: ['SLUG', 'CREATED_BY'],
  archetypes: [
    {
      archetype: 'EPIC',
      depth: 0,
      mayBeRoot: true,
      required: ['TITLE'],
      requiredOnTransition: ['TITLE', 'STATUS'],
      permitted: ['TITLE', 'SLUG', 'DESCRIPTION', 'STATUS', 'SUPERSEDED_BY'],
      legalStatuses: ['ABANDONED', 'IMPLEMENTATION', 'IMPLEMENTED', 'REFINING', 'SUPERSEDED'],
    },
    {
      archetype: 'TICKET',
      depth: 0,
      mayBeRoot: true,
      required: ['TITLE', 'STATUS', 'TICKET_TYPE', 'IMPETUS'],
      requiredOnTransition: ['TITLE', 'STATUS', 'TICKET_TYPE', 'IMPETUS'],
      permitted: [
        'TITLE',
        'SLUG',
        'DESCRIPTION',
        'STATUS',
        'TICKET_TYPE',
        'IMPETUS',
        'ASSIGNEE',
        'CREATED_BY',
      ],
      legalStatuses: ['DONE', 'DROPPED', 'IMPLEMENTED', 'REFINED', 'REPORTED', 'VERIFIED'],
    },
    {
      archetype: 'FEATURE',
      depth: 1,
      mayBeRoot: false,
      required: ['TITLE'],
      requiredOnTransition: ['TITLE'],
      permitted: ['TITLE', 'SLUG', 'DESCRIPTION', 'IMPLEMENTED_AT', 'DEPENDS_ON'],
      legalStatuses: [],
    },
    {
      archetype: 'TASK',
      depth: 2,
      mayBeRoot: false,
      required: ['TITLE', 'REPOSITORY_ID'],
      requiredOnTransition: ['TITLE', 'REPOSITORY_ID'],
      permitted: ['TITLE', 'SLUG', 'DESCRIPTION', 'REPOSITORY_ID', 'IMPLEMENTED_AT', 'DEPENDS_ON'],
      legalStatuses: [],
    },
  ],
};

/**
 * A kind this client has never heard of, at a depth between the two it knows.
 *
 * It exists in this file for one reason: every rule below has to answer about it correctly without a
 * line of production code naming it, which is the whole claim the served registry makes.
 */
const WITH_STORY: ArchetypeRegistry = {
  ...REGISTRY,
  archetypes: [
    ...REGISTRY.archetypes,
    {
      archetype: 'STORY',
      depth: 1,
      mayBeRoot: false,
      required: ['TITLE'],
      requiredOnTransition: ['TITLE', 'DESCRIPTION'],
      permitted: ['TITLE', 'SLUG', 'DESCRIPTION'],
      legalStatuses: [],
    },
  ],
};

function epicDto(over: Partial<EpicDto> = {}): EpicDto {
  return {
    id: 'e1',
    projectId: 'p1',
    title: 'Merge the entities',
    slug: 'merge-the-entities',
    description: 'One entity, two archetypes.',
    number: 12,
    qualifiedId: 'qits-12',
    status: 'IMPLEMENTATION',
    supersededByEpicId: null,
    createdAt: AT,
    updatedAt: AT,
    workspaces: [],
    ...over,
  };
}

function featureDto(over: Partial<FeatureDto> = {}): FeatureDto {
  return {
    id: 'f1',
    epicId: 'e1',
    projectId: 'p1',
    title: 'The transition form',
    slug: 'the-transition-form',
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

function taskDto(over: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'k1',
    featureId: 'f1',
    repositoryId: 'r1',
    projectId: 'p1',
    title: 'Draw the parent picker',
    slug: 'draw-the-parent-picker',
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

function ticketDto(over: Partial<TicketDto> = {}): TicketDto {
  return {
    id: 't1',
    projectId: 'p1',
    title: 'The badge is the wrong colour',
    slug: 'the-badge-is-the-wrong-colour',
    number: 41,
    qualifiedId: 'qits-41',
    type: 'BUG',
    status: 'REPORTED',
    assignee: 'kim',
    createdBy: 'robin',
    impetus: 'The badge reads as success when a run is cancelled.',
    description: null,
    createdAt: AT,
    updatedAt: AT,
    workspaces: [],
    ...over,
  };
}

/** A subject spelled directly, for the rules that are about the shape rather than about the read. */
function subject(over: Partial<TransitionSubject> = {}): TransitionSubject {
  return {
    id: 's1',
    archetype: 'TICKET',
    title: 'A row',
    number: 1,
    qualifiedId: 'qits-1',
    parentId: null,
    projectId: 'p1',
    values: {},
    ...over,
  };
}

function draft(over: Partial<TransitionDraft> = {}): TransitionDraft {
  return {
    subject: subject(),
    archetype: 'TICKET',
    parentId: null,
    values: {},
    ...over,
  };
}

const ids = (subjects: readonly TransitionSubject[]) => subjects.map((row) => row.id);

describe('entity-transition-model', () => {
  describe('specOf', () => {
    it('finds an archetype the registry describes', () => {
      expect(specOf(REGISTRY, 'FEATURE')?.depth).toBe(1);
    });

    /** Null rather than a thrown error: a name from somewhere other than the registry is a fact. */
    it('answers null for a name it has never heard of', () => {
      expect(specOf(REGISTRY, 'STORY')).toBe(null);
      expect(specOf(WITH_STORY, 'STORY')?.depth).toBe(1);
    });
  });

  describe('mayContain', () => {
    it('lets a shallower kind hold a deeper one', () => {
      expect(mayContain(REGISTRY, 'EPIC', 'FEATURE')).toBe(true);
      expect(mayContain(REGISTRY, 'FEATURE', 'TASK')).toBe(true);
    });

    /** Levels may be skipped: a small plan is an epic with tasks straight under it. */
    it('lets an epic hold a task with no feature between them', () => {
      expect(mayContain(REGISTRY, 'EPIC', 'TASK')).toBe(true);
    });

    /** `0 < 0` is false, which is the whole of why an epic can never be filed under a ticket. */
    it('never lets two kinds at the same depth nest, in either direction', () => {
      expect(mayContain(REGISTRY, 'EPIC', 'TICKET')).toBe(false);
      expect(mayContain(REGISTRY, 'TICKET', 'EPIC')).toBe(false);
      expect(mayContain(REGISTRY, 'FEATURE', 'FEATURE')).toBe(false);
    });

    it('never lets a deeper kind hold a shallower one', () => {
      expect(mayContain(REGISTRY, 'TASK', 'FEATURE')).toBe(false);
      expect(mayContain(REGISTRY, 'FEATURE', 'EPIC')).toBe(false);
    });

    /** The claim the depth rule exists to make: a kind nobody wrote code for still nests correctly. */
    it('places a kind the client has never heard of, from its depth alone', () => {
      expect(mayContain(WITH_STORY, 'EPIC', 'STORY')).toBe(true);
      expect(mayContain(WITH_STORY, 'STORY', 'TASK')).toBe(true);
      expect(mayContain(WITH_STORY, 'STORY', 'FEATURE')).toBe(false);
      expect(mayContain(WITH_STORY, 'TASK', 'STORY')).toBe(false);
    });

    it('holds nothing and fits nowhere for a name the registry does not describe', () => {
      expect(mayContain(REGISTRY, 'STORY', 'TASK')).toBe(false);
      expect(mayContain(REGISTRY, 'EPIC', 'STORY')).toBe(false);
    });
  });

  describe('legalParentsFor', () => {
    const pool: readonly TransitionSubject[] = [
      subject({ id: 'e1', archetype: 'EPIC' }),
      subject({ id: 'e2', archetype: 'EPIC' }),
      subject({ id: 'f1', archetype: 'FEATURE', parentId: 'e1' }),
      subject({ id: 'k1', archetype: 'TASK', parentId: 'f1' }),
      subject({ id: 't1', archetype: 'TICKET' }),
      subject({ id: 'x1', archetype: 'EPIC', projectId: 'p2' }),
    ];

    /**
     * Deep enough is the whole test — the ticket is in the answer because a ticket is at depth 0 and
     * a task is at depth 2, and the rule says nothing else about either of them.
     */
    it('offers every row deep enough to hold the target', () => {
      const parents = legalParentsFor(REGISTRY, pool[3], 'TASK', pool);

      expect(ids(parents)).toEqual(['e1', 'e2', 'f1', 't1']);
    });

    /** The service refuses a cross-project reparent, so offering one would be offering a 400. */
    it('never offers a row from another project', () => {
      expect(ids(legalParentsFor(REGISTRY, pool[2], 'FEATURE', pool))).not.toContain('x1');
    });

    it('never offers the subject itself', () => {
      expect(ids(legalParentsFor(REGISTRY, pool[0], 'FEATURE', pool))).toEqual(['e2', 't1']);
    });

    /** A cycle is the one refusal that leaves no readable sentence behind. */
    it('never offers anything already beneath the subject', () => {
      const parents = legalParentsFor(REGISTRY, pool[0], 'TASK', pool);

      expect(ids(parents)).toEqual(['e2', 't1']);
    });

    it('offers nothing at all where no kind is shallow enough', () => {
      expect(legalParentsFor(REGISTRY, pool[0], 'EPIC', pool)).toEqual([]);
    });

    /**
     * The motivating case, as a rule: a task becoming a feature may stay under the feature that is in
     * the same request becoming an epic. The candidates carry their **drafted** archetypes, so the
     * picker judges the parent by what it is about to be — judging it by the stored shape would refuse
     * the only arrangement the form exists to make.
     */
    it('judges a candidate by the archetype it is about to take, not the one it holds', () => {
      const stored = legalParentsFor(REGISTRY, pool[3], 'FEATURE', pool);
      const drafted = legalParentsFor(
        REGISTRY,
        pool[3],
        'FEATURE',
        pool.map((row) => (row.id === 'f1' ? { ...row, archetype: 'EPIC', parentId: null } : row)),
      );

      expect(ids(stored)).toEqual(['e1', 'e2', 't1']);
      expect(ids(drafted)).toEqual(['e1', 'e2', 'f1', 't1']);
    });

    /** A parent loop in the data is bounded by the list rather than spun in. */
    it('terminates on a cycle in the candidates', () => {
      const looped: readonly TransitionSubject[] = [
        subject({ id: 'a', archetype: 'FEATURE', parentId: 'b' }),
        subject({ id: 'b', archetype: 'FEATURE', parentId: 'a' }),
        subject({ id: 'e1', archetype: 'EPIC' }),
      ];

      expect(ids(legalParentsFor(REGISTRY, looped[0], 'TASK', looped))).toEqual(['e1']);
    });
  });

  describe('statableProperties and requiredFieldsFor', () => {
    /** A box whose value the next write throws away is worse than no box at all. */
    it('drops the server-owned properties from what a form may state', () => {
      expect(statableProperties(REGISTRY, 'TICKET')).toEqual([
        'TITLE',
        'DESCRIPTION',
        'STATUS',
        'TICKET_TYPE',
        'IMPETUS',
        'ASSIGNEE',
      ]);
      expect(statableProperties(REGISTRY, 'FEATURE')).toEqual([
        'TITLE',
        'DESCRIPTION',
        'IMPLEMENTED_AT',
        'DEPENDS_ON',
      ]);
    });

    it('keeps the service’s own order rather than imposing one', () => {
      expect(statableProperties(REGISTRY, 'TASK')).toEqual([
        'TITLE',
        'DESCRIPTION',
        'REPOSITORY_ID',
        'IMPLEMENTED_AT',
        'DEPENDS_ON',
      ]);
    });

    /**
     * The transition list, not the create list: a write states the whole row, so a status it omits is
     * a status it cleared.
     */
    it('marks required from requiredOnTransition, less the server-owned', () => {
      expect(requiredFieldsFor(REGISTRY, 'EPIC')).toEqual(['TITLE', 'STATUS']);
      expect(requiredFieldsFor(REGISTRY, 'TICKET')).toEqual([
        'TITLE',
        'STATUS',
        'TICKET_TYPE',
        'IMPETUS',
      ]);
      expect(requiredFieldsFor(REGISTRY, 'TASK')).toEqual(['TITLE', 'REPOSITORY_ID']);
    });

    it('answers nothing for an archetype the registry does not describe', () => {
      expect(statableProperties(REGISTRY, 'STORY')).toEqual([]);
      expect(requiredFieldsFor(REGISTRY, 'STORY')).toEqual([]);
      expect(requiredFieldsFor(WITH_STORY, 'STORY')).toEqual(['TITLE', 'DESCRIPTION']);
    });
  });

  describe('lostProperties', () => {
    const ticket = subject({
      archetype: 'TICKET',
      values: {
        TITLE: 'The badge is the wrong colour',
        SLUG: 'the-badge',
        STATUS: 'REPORTED',
        TICKET_TYPE: 'BUG',
        IMPETUS: 'It reads as success when a run is cancelled.',
        ASSIGNEE: 'kim',
        CREATED_BY: 'robin',
      },
    });

    /** The whole reason the warning exists: a PUT clears by omission, in one press, silently. */
    it('names every property the target archetype will not carry', () => {
      expect(lostProperties(REGISTRY, ticket, 'FEATURE')).toEqual([
        'STATUS',
        'TICKET_TYPE',
        'IMPETUS',
        'ASSIGNEE',
        'CREATED_BY',
      ]);
    });

    /** Computed against what the row actually carries — saying it lost an assignee it never had
     * would train a reader to ignore the line. */
    it('says nothing about a property the row does not carry', () => {
      const bare = subject({ archetype: 'TICKET', values: { TITLE: 'A row', STATUS: 'DONE' } });

      expect(lostProperties(REGISTRY, bare, 'FEATURE')).toEqual(['STATUS']);
    });

    it('counts a blank as nothing carried', () => {
      const blank = subject({ archetype: 'TICKET', values: { STATUS: '   ', IMPETUS: 'why' } });

      expect(lostProperties(REGISTRY, blank, 'FEATURE')).toEqual(['IMPETUS']);
    });

    it('loses nothing when the archetype does not move', () => {
      expect(lostProperties(REGISTRY, ticket, 'TICKET')).toEqual([]);
    });

    it('loses a supersession when an epic becomes a ticket', () => {
      const epic = subject({
        archetype: 'EPIC',
        values: { TITLE: 'A plan', STATUS: 'SUPERSEDED', SUPERSEDED_BY: 'e9' },
      });

      expect(lostProperties(REGISTRY, epic, 'TICKET')).toEqual(['SUPERSEDED_BY']);
    });

    /** A repository is the one thing a task has that a feature does not. */
    it('loses a repository when a task becomes a feature', () => {
      const task = subject({
        archetype: 'TASK',
        values: { TITLE: 'A step', REPOSITORY_ID: 'r1', IMPLEMENTED_AT: AT },
      });

      expect(lostProperties(REGISTRY, task, 'FEATURE')).toEqual(['REPOSITORY_ID']);
    });

    it('answers nothing for a target the registry does not describe', () => {
      expect(lostProperties(REGISTRY, ticket, 'STORY')).toEqual([]);
    });
  });

  describe('propertyLabel', () => {
    /** The service's own rendering, mirrored — which is what makes the attribution possible at all. */
    it('lower-cases and un-underscores, the way the server renders a property', () => {
      expect(propertyLabel('TICKET_TYPE')).toBe('ticket type');
      expect(propertyLabel('TITLE')).toBe('title');
      expect(propertyLabel('IMPLEMENTED_AT')).toBe('implemented at');
    });

    /** It labels an archetype and a status too, which is why the form has no second label rule. */
    it('reads an archetype and a status the same way', () => {
      expect(propertyLabel('EPIC')).toBe('epic');
      expect(propertyLabel('IMPLEMENTATION')).toBe('implementation');
    });
  });

  describe('attributeViolations', () => {
    it('splits on the separator the service joins with', () => {
      const found = attributeViolations(
        'a TASK requires repository id, and none was given; a EPIC has no impetus',
        REGISTRY.properties,
      );

      expect(found.byProperty.get('REPOSITORY_ID')).toEqual([
        'a TASK requires repository id, and none was given',
      ]);
      expect(found.byProperty.get('IMPETUS')).toEqual(['a EPIC has no impetus']);
      expect(found.unattributed).toEqual([]);
    });

    /**
     * The slug collision is the refusal that names no field a form has: it says the word "slug", and
     * the slug is server-owned, so there is no box for it to sit under. Attributed against
     * {@link attributableProperties} it comes back unattributed — a form-level sentence, never
     * swallowed. That is the exact reason the server-owned names are subtracted before matching
     * rather than after.
     */
    it('keeps a violation whose property has no box as a form-level message', () => {
      const found = attributeViolations(
        'slug "x" is already taken under parent y',
        attributableProperties(REGISTRY),
      );

      expect(attributableProperties(REGISTRY)).not.toContain('SLUG');
      expect(found.byProperty.size).toBe(0);
      expect(found.unattributed).toEqual(['slug "x" is already taken under parent y']);
    });

    /** It is a matter of which list is passed, not of a special case: name it, and it attributes. */
    it('attributes a slug where the caller says a slug can be attributed', () => {
      const found = attributeViolations(
        'slug "x" is already taken under parent y',
        REGISTRY.properties,
      );

      expect(found.byProperty.get('SLUG')).toEqual(['slug "x" is already taken under parent y']);
    });

    /** Longest match wins: a fragment about a ticket type is not about some other `TYPE`. */
    it('attributes to the longest label a fragment mentions', () => {
      const found = attributeViolations('a EPIC has no ticket type', [
        ...REGISTRY.properties,
        'TYPE',
      ]);

      expect(found.byProperty.get('TICKET_TYPE')).toEqual(['a EPIC has no ticket type']);
      expect(found.byProperty.has('TYPE')).toBe(false);
    });

    /** One problem stays one problem rather than being sprayed under every box it mentions. */
    it('attributes a fragment to at most one property', () => {
      const found = attributeViolations('title and description disagree', REGISTRY.properties);

      expect(found.byProperty.size).toBe(1);
    });

    it('collects several fragments about one property, in the order they were written', () => {
      const found = attributeViolations(
        'title is blank; title is too long',
        REGISTRY.properties,
      );

      expect(found.byProperty.get('TITLE')).toEqual(['title is blank', 'title is too long']);
    });

    it('attributes nothing for no message at all', () => {
      expect(attributeViolations(null, REGISTRY.properties).unattributed).toEqual([]);
      expect(attributeViolations('   ', REGISTRY.properties).unattributed).toEqual([]);
    });

    /** A property the service adds tomorrow is attributed with no client change. */
    it('attributes a property this client has never heard of', () => {
      const found = attributeViolations('a STORY has no story points', [
        ...REGISTRY.properties,
        'STORY_POINTS',
      ]);

      expect(found.byProperty.get('STORY_POINTS')).toEqual(['a STORY has no story points']);
    });
  });

  describe('subjectsOf', () => {
    const entities: readonly Entity[] = [
      epicEntity(epicDto(), [
        {
          feature: featureDto({ implementedOn: AT, dependsOnFeatureId: 'f0' }),
          tasks: [taskDto()],
        },
      ]),
      ticketEntity(ticketDto()),
    ];

    it('walks every level of the project into one flat list, in the read’s order', () => {
      expect(ids(subjectsOf(entities))).toEqual(['e1', 'f1', 'k1', 't1']);
    });

    it('names each row’s archetype and its parent', () => {
      const [epic, feature, task, ticket] = subjectsOf(entities);

      expect([epic.archetype, epic.parentId]).toEqual(['EPIC', null]);
      expect([feature.archetype, feature.parentId]).toEqual(['FEATURE', 'e1']);
      expect([task.archetype, task.parentId]).toEqual(['TASK', 'f1']);
      expect([ticket.archetype, ticket.parentId]).toEqual(['TICKET', null]);
    });

    /** The wire's two spellings of one idea, reconciled once so every rule above reads one name. */
    it('reads a feature’s implementedOn and a task’s implementedAt as one property', () => {
      const [, feature, task] = subjectsOf(entities);

      expect(feature.values['IMPLEMENTED_AT']).toBe(AT);
      expect(feature.values['DEPENDS_ON']).toBe('f0');
      expect(task.values['IMPLEMENTED_AT']).toBeUndefined();
    });

    it('carries a ticket’s whole shape, and an epic’s', () => {
      const [epic, , , ticket] = subjectsOf(entities);

      expect(epic.values).toEqual({
        TITLE: 'Merge the entities',
        SLUG: 'merge-the-entities',
        DESCRIPTION: 'One entity, two archetypes.',
        STATUS: 'IMPLEMENTATION',
      });
      expect(ticket.values).toEqual({
        TITLE: 'The badge is the wrong colour',
        SLUG: 'the-badge-is-the-wrong-colour',
        STATUS: 'REPORTED',
        TICKET_TYPE: 'BUG',
        IMPETUS: 'The badge reads as success when a run is cancelled.',
        ASSIGNEE: 'kim',
        CREATED_BY: 'robin',
      });
    });

    /** Absent means "nothing is stored", which is exactly what the door means by it. */
    it('leaves a null or blank property out entirely', () => {
      const [subjectRow] = subjectsOf([ticketEntity(ticketDto({ assignee: '  ', impetus: null }))]);

      expect('ASSIGNEE' in subjectRow.values).toBe(false);
      expect('IMPETUS' in subjectRow.values).toBe(false);
    });

    it('carries the identifiers a picker draws, including a null qualified id', () => {
      const [subjectRow] = subjectsOf([ticketEntity(ticketDto({ qualifiedId: null }))]);

      expect(subjectRow.number).toBe(41);
      expect(subjectRow.qualifiedId).toBe(null);
    });

    it('carries the project each row belongs to, off the row itself', () => {
      const rows = subjectsOf(entities);

      expect(rows.every((row) => row.projectId === 'p1')).toBe(true);
    });
  });

  describe('draftToRequest', () => {
    /** `TICKET_TYPE` to `ticketType`, as a rule — a table of twelve pairs is twelve chances to be wrong. */
    it('spells every property as the wire’s camelCase', () => {
      const body = draftToRequest(
        REGISTRY,
        draft({
          archetype: 'TICKET',
          values: {
            TITLE: 'A row',
            STATUS: 'REPORTED',
            TICKET_TYPE: 'BUG',
            IMPETUS: 'why',
            ASSIGNEE: 'kim',
          },
        }),
      );

      expect(body).toEqual({
        archetype: 'TICKET',
        membership: { parent: null },
        title: 'A row',
        status: 'REPORTED',
        ticketType: 'BUG',
        impetus: 'why',
        assignee: 'kim',
      });
    });

    it('spells the membership even for a root, so a log says where the row went', () => {
      expect(draftToRequest(REGISTRY, draft({ archetype: 'EPIC' })).membership).toEqual({
        parent: null,
      });
      expect(
        draftToRequest(REGISTRY, draft({ archetype: 'FEATURE', parentId: 'e1' })).membership,
      ).toEqual({ parent: 'e1' });
    });

    /** Absence is the clear. There is no second spelling and no paired boolean. */
    it('leaves a blank off, which is how a property is cleared', () => {
      const body = draftToRequest(
        REGISTRY,
        draft({ archetype: 'FEATURE', values: { TITLE: 'A feature', DESCRIPTION: '   ' } }),
      );

      expect(body).toEqual({
        archetype: 'FEATURE',
        membership: { parent: null },
        title: 'A feature',
      });
    });

    /** A value left over from what the row used to be never reaches the wire. */
    it('never states a property the target archetype does not permit', () => {
      const body = draftToRequest(
        REGISTRY,
        draft({
          archetype: 'FEATURE',
          parentId: 'e1',
          values: { TITLE: 'A feature', IMPETUS: 'why', STATUS: 'REPORTED' },
        }),
      );

      expect(body['impetus']).toBeUndefined();
      expect(body['status']).toBeUndefined();
    });

    /** Server-owned properties are never stated, however they got into the draft. */
    it('never states a slug or a principal', () => {
      const body = draftToRequest(
        REGISTRY,
        draft({ archetype: 'TICKET', values: { TITLE: 'A row', SLUG: 'a-row', CREATED_BY: 'kim' } }),
      );

      expect(body['slug']).toBeUndefined();
      expect(body['createdBy']).toBeUndefined();
    });

    /** The registry's claim, end to end: a kind nobody wrote code for serialises correctly. */
    it('serialises an archetype the client has never heard of', () => {
      const body = draftToRequest(
        WITH_STORY,
        draft({
          archetype: 'STORY',
          parentId: 'e1',
          values: { TITLE: 'A story', DESCRIPTION: 'about something' },
        }),
      );

      expect(body).toEqual({
        archetype: 'STORY',
        membership: { parent: 'e1' },
        title: 'A story',
        description: 'about something',
      });
    });
  });

  describe('isSubmittable', () => {
    it('wants every required field of the target filled', () => {
      expect(
        isSubmittable(REGISTRY, draft({ archetype: 'EPIC', values: { TITLE: 'A plan' } })),
      ).toBe(false);
      expect(
        isSubmittable(
          REGISTRY,
          draft({ archetype: 'EPIC', values: { TITLE: 'A plan', STATUS: 'REFINING' } }),
        ),
      ).toBe(true);
    });

    it('counts a blank as unfilled', () => {
      expect(
        isSubmittable(
          REGISTRY,
          draft({ archetype: 'EPIC', values: { TITLE: '  ', STATUS: 'REFINING' } }),
        ),
      ).toBe(false);
    });

    /** A kind that may not be a root has to say where it goes. */
    it('wants a parent where the target cannot be a root', () => {
      const values = { TITLE: 'A step', REPOSITORY_ID: 'r1' };

      expect(isSubmittable(REGISTRY, draft({ archetype: 'TASK', values }))).toBe(false);
      expect(isSubmittable(REGISTRY, draft({ archetype: 'TASK', parentId: 'f1', values }))).toBe(
        true,
      );
    });

    it('refuses an archetype the registry does not describe', () => {
      expect(isSubmittable(REGISTRY, draft({ archetype: 'STORY', values: { TITLE: 'x' } }))).toBe(
        false,
      );
    });
  });
});
