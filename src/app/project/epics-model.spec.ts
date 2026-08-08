import type { EpicDto, FeatureDto, TaskDto } from '../api/dto';
import {
  epicBranch,
  epicStatus,
  featureBranch,
  featureStatus,
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

function node(features: readonly FeatureNode[]): EpicNode {
  return { epic: epic(), features };
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
