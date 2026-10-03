import type { EpicDto, FeatureDto, TaskDto, TicketDto } from '../api/dto';
import { campaignEntity } from './campaign-model';
import { epicEntity, ticketEntity } from './entities-model';
import {
  archetypeFromParam,
  archetypeFilterParam,
  archetypeLabel,
  childrenOf,
  entityAddress,
  entityRoute,
  flattenEntities,
  nodeByNumber,
  parseEntityNumber,
  refinePrompt,
  refinementRoute,
  ticketOf,
  workRoute,
} from './entity-nodes';

const AT = '2026-09-07T09:00:00Z';

const EPIC: EpicDto = {
  id: 'e1',
  projectId: 'p1',
  title: 'One desk',
  slug: 'one-desk',
  description: null,
  number: 12,
  qualifiedId: 'qits-12',
  status: 'REPORTED',
  supersededByEpicId: null,
  createdAt: AT,
  updatedAt: AT,
  workspaces: [],
};

const FEATURE: FeatureDto = {
  id: 'f1',
  epicId: 'e1',
  projectId: 'p1',
  title: 'The desk',
  slug: 'the-desk',
  description: null,
  number: 13,
  qualifiedId: 'qits-13',
  dependsOnFeatureId: null,
  implementedOn: AT,
  createdAt: AT,
  updatedAt: AT,
};

const TASK: TaskDto = {
  id: 'k1',
  featureId: 'f1',
  repositoryId: 'r1',
  projectId: 'p1',
  title: 'Route it',
  slug: 'route-it',
  description: null,
  number: 14,
  qualifiedId: 'qits-14',
  dependsOnTaskId: null,
  implementedAt: null,
  createdAt: AT,
  updatedAt: AT,
};

const TICKET: TicketDto = {
  id: 't1',
  projectId: 'p1',
  title: 'The badge',
  slug: 'the-badge',
  number: 41,
  qualifiedId: 'qits-41',
  type: 'BUG',
  status: 'REPORTED',
  assignee: null,
  createdBy: null,
  impetus: 'It is wrong.',
  description: null,
  createdAt: AT,
  updatedAt: AT,
  workspaces: [],
};

const NODES = flattenEntities([
  epicEntity(EPIC, [{ feature: FEATURE, tasks: [TASK] }]),
  ticketEntity(TICKET),
]);

/**
 * The flattened index the entity page resolves a number against — there is no read by number, so a
 * number that resolved to the wrong node, or a child missing from its parent, would be a page quietly
 * about the wrong thing.
 */
describe('entity nodes', () => {
  it('flattens every archetype, parents before their children', () => {
    expect(NODES.map((node) => [node.archetype, node.number])).toEqual([
      ['EPIC', 12],
      ['FEATURE', 13],
      ['TASK', 14],
      ['TICKET', 41],
    ]);
  });

  it('carries the parent links, the markers and the repository across', () => {
    const [epic, feature, task, ticket] = NODES;
    expect(epic.parentId).toBeNull();
    expect(feature.parentId).toBe('e1');
    expect(feature.implementedAt).toBe(AT);
    expect(task.parentId).toBe('f1');
    expect(task.repositoryId).toBe('r1');
    expect(task.epic?.id).toBe('e1');
    expect(task.status).toBeNull();
    expect(ticketOf(ticket)?.impetus).toBe('It is wrong.');
    expect(ticketOf(epic)).toBeNull();
  });

  /** qits-763: a feature and a task carry their own status once the service serves one. */
  it('reads a feature’s and a task’s own status once the service serves one', () => {
    const nodes = flattenEntities([
      epicEntity(EPIC, [
        {
          feature: { ...FEATURE, status: 'IMPLEMENTING' },
          tasks: [{ ...TASK, status: 'VERIFIED' }],
        },
      ]),
    ]);

    expect(nodes.find((node) => node.id === 'f1')?.status).toBe('IMPLEMENTING');
    expect(nodes.find((node) => node.id === 'k1')?.status).toBe('VERIFIED');
  });

  it('finds a node by its number, and its children in order', () => {
    expect(nodeByNumber(NODES, 14)?.id).toBe('k1');
    expect(nodeByNumber(NODES, 99)).toBeNull();
    expect(childrenOf(NODES, 'e1').map((node) => node.id)).toEqual(['f1']);
    expect(childrenOf(NODES, 't1')).toEqual([]);
  });

  describe('parseEntityNumber', () => {
    it('reads the qualified form and the bare number alike', () => {
      expect(parseEntityNumber('qits-1337')).toBe(1337);
      expect(parseEntityNumber('1337')).toBe(1337);
    });

    /** A project slug may itself carry hyphens; the number is the trailing digits after the last. */
    it('takes the digits after the last hyphen, whatever the prefix', () => {
      expect(parseEntityNumber('my-project-12')).toBe(12);
    });

    it('refuses a segment that names no number', () => {
      expect(parseEntityNumber('cancelled-badge')).toBeNull();
      expect(parseEntityNumber('qits-')).toBeNull();
      expect(parseEntityNumber('')).toBeNull();
      expect(parseEntityNumber('qits-0')).toBeNull();
    });
  });

  describe('addresses', () => {
    it('spells a node by its qualified number under the literal work segment', () => {
      expect(workRoute('qits')).toEqual(['/', 'qits', 'work']);
      expect(entityRoute('qits', NODES[2])).toEqual(['/', 'qits', 'work', 'qits-14']);
      expect(refinementRoute('qits', NODES[3])).toEqual([
        '/',
        'qits',
        'work',
        'qits-41',
        'refinement',
      ]);
    });

    /** A null qualified id is never drawn as `null-12`; the bare number reads just as well. */
    it('falls back to the bare number when there is no qualified id', () => {
      expect(entityAddress({ qualifiedId: null, number: 12 })).toBe('12');
    });

    it('spells the archetype filter lower-case in a URL and reads it back', () => {
      expect(archetypeFilterParam('TICKET')).toBe('ticket');
      expect(archetypeFromParam('ticket')).toBe('TICKET');
      expect(archetypeFromParam('')).toBeNull();
      expect(archetypeFromParam(null)).toBeNull();
    });
  });

  /**
   * qits-419: a campaign is a root with no children, read by its own arm — never as an epic whose
   * `features` are undefined, which is what the ticket-or-else-epic fallthrough would make of it.
   */
  describe('a campaign', () => {
    const campaign = campaignEntity({
      id: 'c1',
      number: 430,
      qualifiedId: 'qits-430',
      projectId: 'p1',
      title: 'Rename qits-x',
      status: 'REFINED',
      started: false,
      active: false,
      members: 3,
    });

    it('flattens to one root node carrying the campaign, and resolves by its number', () => {
      const nodes = flattenEntities([epicEntity(EPIC), campaign]);
      const node = nodeByNumber(nodes, 430);
      expect(node?.archetype).toBe('CAMPAIGN');
      expect(node?.campaign?.id).toBe('c1');
      expect(node?.entity).toBeNull();
      expect(node?.epic).toBeNull();
      expect(node?.parentId).toBeNull();
      expect(childrenOf(nodes, 'c1')).toEqual([]);
      expect(entityRoute('qits', node!)).toEqual(['/', 'qits', 'work', 'qits-430']);
    });

    it('is labelled and filtered like every other archetype', () => {
      expect(archetypeLabel('CAMPAIGN')).toBe('campaign');
      expect(archetypeFilterParam('CAMPAIGN')).toBe('campaign');
      expect(archetypeFromParam('campaign')).toBe('CAMPAIGN');
    });
  });

  /** qits-395: the SPA writes the refining prompt, and a ticket's room must refine the ticket. */
  describe('refinePrompt', () => {
    it('tells a ticket’s room to refine the ticket into its description and dossier', () => {
      const prompt = refinePrompt(NODES[3]);
      expect(prompt.split('\n')[0]).toBe('# Refine ticket qits-41: The badge');
      expect(prompt).toContain('entity id t1');
      expect(prompt).toContain('description');
      expect(prompt).toContain('dossier');
      expect(prompt).toContain('do not implement');
    });

    it('tells an epic’s room to refine its description, tree and dossier', () => {
      const prompt = refinePrompt(NODES[0]);
      expect(prompt.split('\n')[0]).toBe('# Refine epic qits-12: One desk');
      expect(prompt).toContain('feature/task tree');
    });
  });
});
