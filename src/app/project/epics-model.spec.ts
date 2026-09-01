import type { EpicDto, FeatureDto, TaskDto } from '../api/dto';
import {
  actionKey,
  actionsFor,
  epicAnchor,
  epicBadge,
  epicBranch,
  epicStatus,
  epicTitles,
  featureBranch,
  featureStatus,
  groupEpics,
  isDone,
  refiningBranch,
  refiningEpicSlug,
  taskBranch,
  taskStatus,
  type EpicNode,
  type FeatureNode,
} from './epics-model';

const AT = '2026-08-08T09:00:00Z';

function epic(over: Partial<EpicDto> = {}): EpicDto {
  return {
    id: 'e1',
    projectId: 'p1',
    title: 'Epics on the project page',
    slug: 'epics-overview',
    description: null,
    status: 'IMPLEMENTATION',
    supersededByEpicId: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function feature(over: Partial<FeatureDto> = {}): FeatureDto {
  return {
    id: 'f1',
    epicId: 'e1',
    title: 'Read the epics',
    slug: 'read-the-epics',
    description: null,
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
    title: 'Add the endpoints',
    slug: 'add-the-endpoints',
    description: null,
    dependsOnTaskId: null,
    implementedAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function node(features: readonly FeatureNode[], over: Partial<EpicDto> = {}): EpicNode {
  return { epic: epic(over), features };
}

/** An epic whose every feature is implemented — the shape "done" is derived from. */
function finished(over: Partial<EpicDto> = {}): EpicNode {
  return node([{ feature: feature({ implementedOn: AT }), tasks: [] }], over);
}

/**
 * The convention, asserted segment by segment. A branch name is the one thing on this card a
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
   * A fresh top-level prefix, which is the whole point: a refining branch is where the plan is written
   * and cannot be read as the epic's own branch at any depth.
   */
  it('gives a refining branch its own namespace, above the plan’s three', () => {
    expect(refiningBranch('epics-overview')).toBe('refining/epics-overview');
    expect(refiningBranch('epics-overview').startsWith('epic/')).toBe(false);
  });

  /**
   * The inverse is what bridges a *workspace* to the *epic* page that shows it — the activity bar's one
   * job. Nothing stores the pairing, so a branch that does not spell it maps to nothing, and saying so
   * is the only way the bar can refuse to draw a button that goes nowhere.
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
        node([
          { feature: feature({ id: 'f1', implementedOn: AT }), tasks: [] },
          { feature: feature({ id: 'f2', implementedOn: AT }), tasks: [] },
        ]),
      ),
    ).toEqual({ label: 'implemented', tone: 'success' });
  });

  it('is in progress when some are', () => {
    expect(
      epicStatus(
        node([
          { feature: feature({ id: 'f1', implementedOn: AT }), tasks: [] },
          { feature: feature({ id: 'f2' }), tasks: [] },
        ]),
      ),
    ).toEqual({ label: 'in progress', tone: 'info' });
  });

  it('is open when none is', () => {
    expect(epicStatus(node([{ feature: feature(), tasks: [] }]))).toEqual({
      label: 'open',
      tone: 'neutral',
    });
  });

  /** No completion field of its own, so an epic with no features has no evidence to read. */
  it('is open for an epic with no features at all', () => {
    expect(epicStatus(node([]))).toEqual({ label: 'open', tone: 'neutral' });
  });
});

describe('epicBadge', () => {
  it('says the lifecycle everywhere the lifecycle is the answer', () => {
    expect(epicBadge(node([], { status: 'REFINING' }))).toEqual({
      label: 'refining',
      tone: 'info',
    });
    expect(epicBadge(node([], { status: 'SUPERSEDED' }))).toEqual({
      label: 'superseded',
      tone: 'neutral',
    });
    expect(epicBadge(node([], { status: 'ABANDONED' }))).toEqual({
      label: 'abandoned',
      tone: 'danger',
    });
    // Declared done: the badge is the status, features or none.
    expect(epicBadge(node([], { status: 'IMPLEMENTED' }))).toEqual({
      label: 'implemented',
      tone: 'success',
    });
  });

  /** In implementation the question is how far along, so the features keep answering it. */
  it('keeps the derived badge while an epic is being implemented', () => {
    expect(epicBadge(finished())).toEqual({ label: 'implemented', tone: 'success' });
    expect(epicBadge(node([{ feature: feature(), tasks: [] }]))).toEqual({
      label: 'open',
      tone: 'neutral',
    });
  });
});

/**
 * Done is derived, and that is the one rule in this file a stored status could quietly break: an
 * epic becomes done by having its last feature implemented, with nothing pressed.
 */
describe('isDone', () => {
  it('is done when an implementation epic has every feature implemented', () => {
    expect(isDone(finished())).toBe(true);
  });

  it('is not done while a feature is still open', () => {
    expect(
      isDone(
        node([
          { feature: feature({ id: 'f1', implementedOn: AT }), tasks: [] },
          { feature: feature({ id: 'f2' }), tasks: [] },
        ]),
      ),
    ).toBe(false);
  });

  /** An epic with no features has no evidence, so it cannot be done — the `epicStatus` rule again. */
  it('is not done for an epic with no features', () => {
    expect(isDone(node([]))).toBe(false);
  });

  /** The declared spelling: `IMPLEMENTED` is done outright, features or none. */
  it('is done for a declared IMPLEMENTED epic even with no features', () => {
    expect(isDone(node([], { status: 'IMPLEMENTED' }))).toBe(true);
  });

  /** Only implementation can be done; a draft with nothing in it must not read as finished. */
  it('is not done in any other phase', () => {
    expect(isDone(finished({ status: 'REFINING' }))).toBe(false);
    expect(isDone(finished({ status: 'SUPERSEDED' }))).toBe(false);
    expect(isDone(finished({ status: 'ABANDONED' }))).toBe(false);
  });
});

describe('groupEpics', () => {
  it('splits the epics into the five sections the overview draws', () => {
    const draft = node([], { id: 'e1', status: 'REFINING' });
    const running = node([{ feature: feature(), tasks: [] }], { id: 'e2' });
    const done = finished({ id: 'e3' });
    const declared = node([], { id: 'e6', status: 'IMPLEMENTED' });
    const old = node([], { id: 'e4', status: 'SUPERSEDED', supersededByEpicId: 'e1' });
    const dropped = node([], { id: 'e5', status: 'ABANDONED' });

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
    const first = node([], { id: 'e1', status: 'REFINING' });
    const second = node([], { id: 'e2', status: 'REFINING' });

    expect(groupEpics([first, second]).refining.map((entry) => entry.epic.id)).toEqual([
      'e1',
      'e2',
    ]);
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
});

/** The server validates every move; this list only decides which press is worth offering. */
describe('actionsFor', () => {
  /**
   * Refine leads, and the order is the order of the work: refining is what a draft is *for*, and
   * freezing the scope is what you do when the refining is finished.
   */
  it('offers a draft the refine, then the freeze, then the drop', () => {
    expect(actionsFor('REFINING')).toEqual([
      { kind: 'refine', label: 'Refine', confirmLabel: null },
      {
        kind: 'transition',
        target: 'IMPLEMENTATION',
        label: 'Start implementation',
        confirmLabel: null,
      },
      {
        kind: 'transition',
        target: 'ABANDONED',
        label: 'Abandon',
        confirmLabel: 'Confirm abandon?',
      },
    ]);
  });

  /**
   * The discriminant, not the status. Refine leaves the epic exactly where it was, so reaching it
   * through `EpicStatus` would mean inventing a fifth status the service has never heard of.
   */
  it('marks refine as the one action that is not a transition', () => {
    const [refine, ...transitions] = actionsFor('REFINING');

    expect(refine.kind).toBe('refine');
    expect(refine).not.toHaveProperty('target');
    expect(transitions.every((action) => action.kind === 'transition')).toBe(true);
  });

  it('offers implementation the declaration, the supersede and the drop, and no refine', () => {
    expect(actionsFor('IMPLEMENTATION').map((action) => actionKey(action))).toEqual([
      'IMPLEMENTED',
      'SUPERSEDED',
      'ABANDONED',
    ]);
  });

  /** A shipped epic can still be revisited — superseding is its one remaining move. */
  it('offers an implemented epic only the supersede', () => {
    expect(actionsFor('IMPLEMENTED').map((action) => actionKey(action))).toEqual(['SUPERSEDED']);
  });

  /**
   * Both destructive moves ask twice, and so does the declaration — it is one-way and stamps every
   * still-open feature. Refining and freezing take nothing away.
   */
  it('asks for a confirmation on everything one-way or destructive, and nothing else', () => {
    const asked = [...actionsFor('REFINING'), ...actionsFor('IMPLEMENTATION')]
      .filter((action) => action.confirmLabel !== null)
      .map((action) => actionKey(action));

    expect(asked).toEqual(['ABANDONED', 'IMPLEMENTED', 'SUPERSEDED', 'ABANDONED']);
  });

  it('offers nothing on a terminal epic', () => {
    expect(actionsFor('SUPERSEDED')).toEqual([]);
    expect(actionsFor('ABANDONED')).toEqual([]);
  });
});

/** Keys have to be unique within a row, because they are both the `track` and the busy marker. */
describe('actionKey', () => {
  it('identifies a transition by where it goes and refine by being refine', () => {
    expect(actionsFor('REFINING').map((action) => actionKey(action))).toEqual([
      'refine',
      'IMPLEMENTATION',
      'ABANDONED',
    ]);
  });
});

describe('epicTitles and epicAnchor', () => {
  it('resolves an id to the title a link has to say', () => {
    const titles = epicTitles([node([], { id: 'e1', title: 'The draft' })]);

    expect(titles.get('e1')).toBe('The draft');
    expect(titles.get('e9')).toBeUndefined();
  });

  it('names a card’s anchor after the epic', () => {
    expect(epicAnchor('e1')).toBe('epic-e1');
  });
});
