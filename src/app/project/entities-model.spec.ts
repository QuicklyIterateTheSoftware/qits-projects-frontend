import type { EpicDto, FeatureDto, TaskDto, TicketDto } from '../api/dto';
import {
  TICKET_LIFECYCLE,
  actionKey,
  actionsFor,
  entityAnchor,
  entityBadge,
  entityBySlug,
  entityTitles,
  epicBranch,
  epicEntity,
  epicStatus,
  featureBranch,
  featureStatus,
  groupEpics,
  groupTickets,
  isDone,
  isEdited,
  isEpic,
  isTicket,
  newestFirst,
  ofArchetype,
  refiningBranch,
  refiningEpicSlug,
  taskBranch,
  taskStatus,
  ticketEntity,
  ticketRoute,
  ticketStatusBadge,
  ticketTransitions,
  ticketTypeBadge,
  ticketsRoute,
  type Entity,
  type EpicEntity,
  type FeatureNode,
  type TicketEntity,
} from './entities-model';

const AT = '2026-08-08T09:00:00Z';
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
    status: 'IMPLEMENTATION',
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
 * <p>Everything the two desks are drawn from is in this file, and most of it is the kind of rule that
 * stays plausible while being wrong. A **branch name** one segment off sends somebody to a ref that
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

    /**
     * The inverse is what bridges a *workspace* to the *epic* page that shows it — the activity bar's
     * one job. Nothing stores the pairing, so a branch that does not spell it maps to nothing, and
     * saying so is the only way the bar can refuse to draw a button that goes nowhere.
     */
    it('reads the epic back out of a refining branch, and refuses every other branch', () => {
      expect(refiningEpicSlug('refining/epics-overview')).toBe('epics-overview');
      expect(refiningEpicSlug(refiningBranch('a-b-c'))).toBe('a-b-c');
      expect(refiningEpicSlug('epic/epics-overview')).toBeNull();
      expect(refiningEpicSlug('feature/epics-overview/read-the-epics')).toBeNull();
      expect(refiningEpicSlug('refining/')).toBeNull();
      expect(refiningEpicSlug(null)).toBeNull();
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

  describe('the badges', () => {
    it('says the lifecycle everywhere an epic’s lifecycle is the answer', () => {
      expect(entityBadge(epic([], { status: 'REFINING' }))).toEqual({
        label: 'refining',
        tone: 'info',
      });
      expect(entityBadge(epic([], { status: 'SUPERSEDED' }))).toEqual({
        label: 'superseded',
        tone: 'neutral',
      });
      expect(entityBadge(epic([], { status: 'ABANDONED' }))).toEqual({
        label: 'abandoned',
        tone: 'danger',
      });
      // Declared done: the badge is the status, features or none.
      expect(entityBadge(epic([], { status: 'IMPLEMENTED' }))).toEqual({
        label: 'implemented',
        tone: 'success',
      });
    });

    /** In implementation the question is how far along, so the features keep answering it. */
    it('keeps the derived badge while an epic is being implemented', () => {
      expect(entityBadge(finished())).toEqual({ label: 'implemented', tone: 'success' });
      expect(entityBadge(epic([{ feature: feature(), tasks: [] }]))).toEqual({
        label: 'open',
        tone: 'neutral',
      });
    });

    /**
     * One badge per ticket status, and the tones say how finished rather than how urgent: the three
     * phases still running are the accent and the grey, verified is informational because it is
     * waiting on a person, and only done is green.
     */
    it('gives every status of the ticket lifecycle its own badge', () => {
      expect(ticketStatusBadge('REPORTED')).toEqual({ label: 'reported', tone: 'warning' });
      expect(ticketStatusBadge('REFINED')).toEqual({ label: 'refined', tone: 'neutral' });
      expect(ticketStatusBadge('IMPLEMENTED')).toEqual({ label: 'implemented', tone: 'neutral' });
      expect(ticketStatusBadge('VERIFIED')).toEqual({ label: 'verified', tone: 'info' });
      expect(ticketStatusBadge('DONE')).toEqual({ label: 'done', tone: 'success' });
    });

    /** A ticket has nothing underneath it, so its badge is its status and there is no derivation. */
    it('reads a ticket’s badge straight off its status, through the one entity function', () => {
      expect(entityBadge(ticket({ status: 'VERIFIED' }))).toEqual({
        label: 'verified',
        tone: 'info',
      });
      expect(entityBadge(ticket({ status: 'DONE' }))).toEqual({ label: 'done', tone: 'success' });
    });

    /** A label per status, so no two rows on the desk claim the same thing. */
    it('labels the five apart from one another', () => {
      const labels = TICKET_LIFECYCLE.map((status) => ticketStatusBadge(status).label);

      expect(new Set(labels).size).toBe(TICKET_LIFECYCLE.length);
    });

    /**
     * Verified is not done: the platform no longer shows the problem, but nobody has closed it.
     * Toning both green would hide the one row waiting for a human sentence.
     */
    it('keeps verified out of the done tone', () => {
      expect(ticketStatusBadge('VERIFIED').tone).not.toBe(ticketStatusBadge('DONE').tone);
    });

    /** The two types are read together on one screen, so they have to differ at a glance. */
    it('tones the two types apart rather than by their words alone', () => {
      expect(ticketTypeBadge('BUG')).toEqual({ label: 'bug', tone: 'danger' });
      expect(ticketTypeBadge('IMPROVEMENT')).toEqual({ label: 'improvement', tone: 'info' });
      expect(ticketTypeBadge('BUG').tone).not.toBe(ticketTypeBadge('IMPROVEMENT').tone);
    });
  });

  /**
   * Done is derived for an epic, and that is the one rule here a stored status could quietly break:
   * an epic becomes done by having its last feature implemented, with nothing pressed. For a ticket
   * it is the opposite — a person pressing Close is the whole of it.
   */
  describe('isDone', () => {
    it('is done when an implementation epic has every feature implemented', () => {
      expect(isDone(finished())).toBe(true);
    });

    it('is not done while a feature is still open', () => {
      expect(
        isDone(
          epic([
            { feature: feature({ id: 'f1', implementedOn: AT }), tasks: [] },
            { feature: feature({ id: 'f2' }), tasks: [] },
          ]),
        ),
      ).toBe(false);
    });

    /** An epic with no features has no evidence, so it cannot be done — the `epicStatus` rule again. */
    it('is not done for an epic with no features', () => {
      expect(isDone(epic([]))).toBe(false);
    });

    /** The declared spelling: `IMPLEMENTED` is done outright, features or none. */
    it('is done for a declared IMPLEMENTED epic even with no features', () => {
      expect(isDone(epic([], { status: 'IMPLEMENTED' }))).toBe(true);
    });

    /** Only implementation can be done; a draft with nothing in it must not read as finished. */
    it('is not done in any other phase', () => {
      expect(isDone(finished({ status: 'REFINING' }))).toBe(false);
      expect(isDone(finished({ status: 'SUPERSEDED' }))).toBe(false);
      expect(isDone(finished({ status: 'ABANDONED' }))).toBe(false);
    });

    /** Verified is deliberately not done: the platform agreeing is not a person agreeing. */
    it('is done for a closed ticket and for nothing short of it', () => {
      expect(isDone(ticket({ status: 'DONE' }))).toBe(true);
      expect(isDone(ticket({ status: 'VERIFIED' }))).toBe(false);
      expect(isDone(ticket({ status: 'REPORTED' }))).toBe(false);
    });
  });

  describe('groupEpics', () => {
    it('splits the epics into the five sections the desk draws', () => {
      const draft = epic([], { id: 'e1', status: 'REFINING' });
      const running = epic([{ feature: feature(), tasks: [] }], { id: 'e2' });
      const done = finished({ id: 'e3' });
      const declared = epic([], { id: 'e6', status: 'IMPLEMENTED' });
      const old = epic([], { id: 'e4', status: 'SUPERSEDED', supersededByEpicId: 'e1' });
      const dropped = epic([], { id: 'e5', status: 'ABANDONED' });

      const groups = groupEpics([draft, running, done, declared, old, dropped]);

      expect(groups.refining).toEqual([draft]);
      expect(groups.implementation).toEqual([running]);
      expect(groups.done).toEqual([done, declared]);
      expect(groups.superseded).toEqual([old]);
      expect(groups.abandoned).toEqual([dropped]);
    });

    /** Done is carved out of implementation, so a finished epic must not appear in both. */
    it('takes a finished epic out of implementation rather than listing it twice', () => {
      const groups = groupEpics([finished({ id: 'e3' })]);

      expect(groups.implementation).toEqual([]);
      expect(groups.done).toHaveLength(1);
    });

    it('keeps the service’s order inside a group', () => {
      const first = epic([], { id: 'e1', status: 'REFINING' });
      const second = epic([], { id: 'e2', status: 'REFINING' });

      expect(groupEpics([first, second]).refining.map((entry) => entry.id)).toEqual(['e1', 'e2']);
    });

    it('answers five empty groups for no epics at all', () => {
      expect(groupEpics([])).toEqual({
        refining: [],
        implementation: [],
        done: [],
        superseded: [],
        abandoned: [],
      });
    });

    /** The desk is a view: a ticket handed to it is not this desk's business and is dropped. */
    it('drops the tickets out of a mixed collection rather than drawing them as epics', () => {
      const groups = groupEpics([epic([], { id: 'e1', status: 'REFINING' }), ticket({ id: 't1' })]);

      expect(groups.refining.map((entry) => entry.id)).toEqual(['e1']);
      expect(
        [...groups.implementation, ...groups.done, ...groups.superseded, ...groups.abandoned],
      ).toEqual([]);
    });
  });

  describe('groupTickets', () => {
    it('puts everything but done in outstanding, and done in its own list', () => {
      const rows = [
        ticket({ id: 'a' }),
        ticket({ id: 'b', status: 'DONE' }),
        ticket({ id: 'c', status: 'VERIFIED' }),
        ticket({ id: 'd', status: 'IMPLEMENTED' }),
      ];

      const groups = groupTickets(rows);

      expect(groups.outstanding.map((row) => row.id)).toEqual(['a', 'd', 'c']);
      expect(groups.done.map((row) => row.id)).toEqual(['b']);
    });

    /**
     * The outstanding section reads as a pipeline rather than as an alphabet: reported at the top,
     * where work is picked up from, and verified at the bottom, where it is nearly closed.
     */
    it('orders outstanding by the lifecycle, not by the words and not by the date', () => {
      const rows = [
        ticket({ id: 'verified', status: 'VERIFIED', createdAt: '2026-09-07T09:00:00Z' }),
        ticket({ id: 'reported', status: 'REPORTED', createdAt: '2026-09-01T09:00:00Z' }),
        ticket({ id: 'implemented', status: 'IMPLEMENTED', createdAt: '2026-09-06T09:00:00Z' }),
        ticket({ id: 'refined', status: 'REFINED', createdAt: '2026-09-02T09:00:00Z' }),
      ];

      expect(groupTickets(rows).outstanding.map((row) => row.id)).toEqual([
        'reported',
        'refined',
        'implemented',
        'verified',
      ]);
    });

    /** Within one phase the newest is on top: it is the row being talked about. */
    it('keeps newest-first inside a single status, and throughout the done list', () => {
      const rows = [
        ticket({ id: 'old', createdAt: '2026-09-01T09:00:00Z' }),
        ticket({ id: 'new', createdAt: '2026-09-07T09:00:00Z' }),
        ticket({ id: 'closed-old', status: 'DONE', createdAt: '2026-09-02T09:00:00Z' }),
        ticket({ id: 'closed-new', status: 'DONE', createdAt: '2026-09-08T09:00:00Z' }),
      ];

      const groups = groupTickets(rows);

      expect(groups.outstanding.map((row) => row.id)).toEqual(['new', 'old']);
      expect(groups.done.map((row) => row.id)).toEqual(['closed-new', 'closed-old']);
    });

    /**
     * The server sorts ascending and both sections read newest first, so the reversal is the whole
     * point of doing this here — a list that trusted the response's order would be upside down.
     */
    it('turns the server’s ascending order into newest-first inside each section', () => {
      const rows = [
        ticket({ id: 'old', createdAt: '2026-09-01T09:00:00Z' }),
        ticket({ id: 'mid', createdAt: '2026-09-04T09:00:00Z' }),
        ticket({ id: 'new', createdAt: '2026-09-07T09:00:00Z' }),
      ];

      expect(groupTickets(rows).outstanding.map((row) => row.id)).toEqual(['new', 'mid', 'old']);
    });

    it('breaks a tie on the incoming order reversed, so the later of two is on top', () => {
      const rows = [ticket({ id: 'first' }), ticket({ id: 'second' })];

      expect(newestFirst(rows).map((row) => row.id)).toEqual(['second', 'first']);
    });

    /** A bad stamp sorts to the bottom of its section rather than throwing the section away. */
    it('sinks a timestamp it cannot parse instead of failing on it', () => {
      const rows = [
        ticket({ id: 'broken', createdAt: 'not a date' }),
        ticket({ id: 'fine', createdAt: '2026-09-01T09:00:00Z' }),
      ];

      expect(newestFirst(rows).map((row) => row.id)).toEqual(['fine', 'broken']);
    });

    it('answers two empty sections for a project with no tickets', () => {
      expect(groupTickets([])).toEqual({ outstanding: [], done: [] });
    });

    /** The mirror of the epics desk's filter: an epic is not a row on this one. */
    it('drops the epics out of a mixed collection rather than drawing them as tickets', () => {
      const groups = groupTickets([ticket({ id: 't1' }), epic([], { id: 'e1' })]);

      expect(groups.outstanding.map((row) => row.id)).toEqual(['t1']);
      expect(groups.done).toEqual([]);
    });
  });

  /**
   * The adjacency rule, which is what the detail page's control is drawn from. A target two steps
   * away and a target the ticket already holds are both 409s, so offering either would be offering a
   * press that cannot work.
   */
  describe('the moves a ticket may make', () => {
    it('offers both neighbours from the middle of the lifecycle, forward first', () => {
      expect(ticketTransitions('REFINED')).toEqual([
        { target: 'IMPLEMENTED', label: 'Mark implemented', forward: true },
        { target: 'REPORTED', label: 'Back to reported', forward: false },
      ]);
      expect(ticketTransitions('IMPLEMENTED')).toEqual([
        { target: 'VERIFIED', label: 'Mark verified', forward: true },
        { target: 'REFINED', label: 'Back to refined', forward: false },
      ]);
      expect(ticketTransitions('VERIFIED')).toEqual([
        { target: 'DONE', label: 'Close', forward: true },
        { target: 'IMPLEMENTED', label: 'Back to implemented', forward: false },
      ]);
    });

    /** The ends have one neighbour each — and `DONE` still has one, because nothing is terminal. */
    it('offers one move from each end, and never a way to stand still', () => {
      expect(ticketTransitions('REPORTED')).toEqual([
        { target: 'REFINED', label: 'Mark refined', forward: true },
      ]);
      expect(ticketTransitions('DONE')).toEqual([
        { target: 'VERIFIED', label: 'Reopen', forward: false },
      ]);
    });

    it('never offers a target two steps away, or the status already held', () => {
      for (const status of TICKET_LIFECYCLE) {
        const targets = ticketTransitions(status).map((move) => move.target);
        const at = TICKET_LIFECYCLE.indexOf(status);

        expect(targets).not.toContain(status);
        for (const target of targets) {
          expect(Math.abs(TICKET_LIFECYCLE.indexOf(target) - at)).toBe(1);
        }
      }
    });
  });

  /** The server validates every move; this list only decides which press is worth offering. */
  describe('actionsFor', () => {
    /**
     * Refine leads, and the order is the order of the work: refining is what a draft is *for*, and
     * freezing the scope is what you do when the refining is finished.
     */
    it('offers a draft the refine, then the freeze, then the drop', () => {
      expect(actionsFor(epic([], { status: 'REFINING' }))).toEqual([
        { kind: 'refine', label: 'Refine', confirmLabel: null },
        { kind: 'start', label: 'Start implementation', confirmLabel: null },
        {
          kind: 'transition',
          target: 'ABANDONED',
          label: 'Abandon',
          confirmLabel: 'Confirm abandon?',
        },
      ]);
    });

    /**
     * The discriminant, not the status. Refine leaves the epic exactly where it was, and starting
     * implementation does more than move it — one door freezes the scope *and* dispatches an agent —
     * so neither carries a `target` a transition endpoint could be called with.
     */
    it('marks refine and the start as the two actions that are not transitions', () => {
      const [refine, start, ...transitions] = actionsFor(epic([], { status: 'REFINING' }));

      expect(refine.kind).toBe('refine');
      expect(refine).not.toHaveProperty('target');
      expect(start.kind).toBe('start');
      expect(start).not.toHaveProperty('target');
      expect(transitions.every((action) => action.kind === 'transition')).toBe(true);
    });

    it('offers implementation the declaration, the supersede and the drop, and no refine', () => {
      expect(actionsFor(epic([], { status: 'IMPLEMENTATION' })).map(actionKey)).toEqual([
        'IMPLEMENTED',
        'SUPERSEDED',
        'ABANDONED',
      ]);
    });

    /** A shipped epic can still be revisited — superseding is its one remaining move. */
    it('offers an implemented epic only the supersede', () => {
      expect(actionsFor(epic([], { status: 'IMPLEMENTED' })).map(actionKey)).toEqual(['SUPERSEDED']);
    });

    /**
     * Both destructive moves ask twice, and so does the declaration — it is one-way and stamps every
     * still-open feature. Refining and freezing take nothing away.
     */
    it('asks for a confirmation on everything one-way or destructive, and nothing else', () => {
      const asked = [
        ...actionsFor(epic([], { status: 'REFINING' })),
        ...actionsFor(epic([], { status: 'IMPLEMENTATION' })),
      ]
        .filter((action) => action.confirmLabel !== null)
        .map(actionKey);

      expect(asked).toEqual(['ABANDONED', 'IMPLEMENTED', 'SUPERSEDED', 'ABANDONED']);
      expect(
        actionsFor(epic([], { status: 'REFINING' })).find((action) => action.kind === 'start')
          ?.confirmLabel,
      ).toBe(null);
    });

    it('offers nothing on a terminal epic', () => {
      expect(actionsFor(epic([], { status: 'SUPERSEDED' }))).toEqual([]);
      expect(actionsFor(epic([], { status: 'ABANDONED' }))).toEqual([]);
    });

    /**
     * A ticket's one press, and it asks once: the door is find-or-create, so a second press
     * re-enters the workspace the first one made.
     */
    it('offers an outstanding ticket the one press it has, unconfirmed', () => {
      expect(actionsFor(ticket({ status: 'REPORTED' }))).toEqual([
        { kind: 'assign', label: 'Assign agent', confirmLabel: null },
      ]);
      expect(actionsFor(ticket({ status: 'VERIFIED' })).map(actionKey)).toEqual(['assign']);
    });

    /** Putting an agent on something a person has closed would be reopening it sideways. */
    it('offers a closed ticket nothing at all', () => {
      expect(actionsFor(ticket({ status: 'DONE' }))).toEqual([]);
    });
  });

  /** Keys have to be unique within a row, because they are both the `track` and the busy marker. */
  describe('actionKey', () => {
    it('identifies a transition by where it goes and the others by their own kind', () => {
      expect(actionsFor(epic([], { status: 'REFINING' })).map(actionKey)).toEqual([
        'refine',
        'start',
        'ABANDONED',
      ]);
      expect(actionsFor(ticket()).map(actionKey)).toEqual(['assign']);
    });

    /**
     * Total and collision-free over the widened union: every action of every phase of both archetypes
     * answers a key, and no two in one row share it. The lower-case discriminants cannot spell a
     * screaming-case status.
     */
    it('answers a distinct key for every action of every phase of both archetypes', () => {
      const phases: readonly Entity[] = [
        epic([], { status: 'REFINING' }),
        epic([], { status: 'IMPLEMENTATION' }),
        epic([], { status: 'IMPLEMENTED' }),
        epic([], { status: 'SUPERSEDED' }),
        epic([], { status: 'ABANDONED' }),
        ...TICKET_LIFECYCLE.map((status) => ticket({ status })),
      ];

      for (const entity of phases) {
        const keys = actionsFor(entity).map(actionKey);

        expect(keys.every((key) => key.length > 0)).toBe(true);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });
  });

  describe('titles and anchors', () => {
    it('resolves an id to the title a link has to say', () => {
      const titles = entityTitles([epic([], { id: 'e1', title: 'The draft' })]);

      expect(titles.get('e1')).toBe('The draft');
      expect(titles.get('e9')).toBeUndefined();
    });

    /** The archetype is in the anchor, so two rows that share a key are still two anchors. */
    it('names a card’s anchor after the archetype and the row', () => {
      expect(entityAnchor('EPIC', 'e1')).toBe('epic-e1');
      expect(entityAnchor('TICKET', 't1')).toBe('ticket-t1');
      expect(entityAnchor('EPIC', 'x')).not.toBe(entityAnchor('TICKET', 'x'));
    });
  });

  describe('addresses', () => {
    /** Slug on both segments: the id resolves nothing in a URL and is corrected away in the first. */
    it('spells a ticket’s address with the project slug and the ticket slug', () => {
      expect(ticketRoute('qits', 'cancelled-badge')).toEqual([
        '/',
        'qits',
        'tickets',
        'cancelled-badge',
      ]);
      expect(ticketsRoute('qits')).toEqual(['/', 'qits', 'tickets']);
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
