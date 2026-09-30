import type { CampaignMemberDto, CriterionDto, CriterionGroupDto } from '../api/dto';
import {
  approvalCriterion,
  campaignEntity,
  campaignLine,
  criterionSentence,
  deploymentCriterion,
  editableMember,
  entityStatusCriterion,
  memberRefs,
  releaseCriterion,
  waitTargets,
  waitsForLine,
  withCriterion,
  withoutCriterion,
} from './campaign-model';

function member(
  id: string,
  qualified: string,
  groups: readonly CriterionGroupDto[] = [],
  over: Partial<CampaignMemberDto> = {},
): CampaignMemberDto {
  return {
    membershipId: `m-${id}`,
    position: 0,
    entity: {
      id,
      archetype: 'TICKET',
      qualifiedId: qualified,
      title: `Step ${qualified}`,
      status: 'REPORTED',
      blocked: false,
    },
    claimedAt: null,
    joinedRunning: false,
    dispatchedAt: null,
    dispatch: { workspaceId: null, branch: null, agentLaunch: null },
    dispatchRefusal: null,
    dispatchRefusedAt: null,
    dispatchError: null,
    groups,
    ...over,
  };
}

function waitsOn(id: string, entityId: string, seeded = false): CriterionDto {
  return {
    id,
    kind: 'ENTITY_STATUS',
    predicate: { entityId, status: 'VERIFIED' },
    seeded,
    satisfiedAt: null,
    evidence: null,
    approval: null,
  };
}

const APPROVAL: CriterionDto = {
  id: 'k-approve',
  kind: 'APPROVAL',
  predicate: {},
  seeded: false,
  satisfiedAt: null,
  evidence: null,
  approval: null,
};

/**
 * The campaign page's rules, as pure functions: the four forms' exact JSON (the service refuses a
 * key the shape does not have and wants every key written), what a ✕ PUTs, and the "waits for" line
 * that is read off the criteria and never off position.
 */
describe('campaign-model', () => {
  describe('the four typed forms', () => {
    it('member reaches status', () => {
      expect(entityStatusCriterion('e1', 'VERIFIED')).toEqual({
        kind: 'ENTITY_STATUS',
        predicate: { entityId: 'e1', status: 'VERIFIED' },
      });
    });

    it('deployment goes live, optional boxes as null', () => {
      expect(JSON.stringify(deploymentCriterion(' qits-projects ', '', ''))).toBe(
        '{"kind":"DEPLOYMENT_ACTIVE","predicate":{"applicationName":"qits-projects","environmentName":null,"minimumVersion":null}}',
      );
      expect(deploymentCriterion('qits-projects', 'dev', '2026.1001.1')).toEqual({
        kind: 'DEPLOYMENT_ACTIVE',
        predicate: {
          applicationName: 'qits-projects',
          environmentName: 'dev',
          minimumVersion: '2026.1001.1',
        },
      });
    });

    it('repository releases, projectId always null', () => {
      expect(JSON.stringify(releaseCriterion('qits-projects-service', ''))).toBe(
        '{"kind":"SCM_RELEASE","predicate":{"repositoryName":"qits-projects-service","projectId":null,"minimumVersion":null}}',
      );
      expect(releaseCriterion('qits-projects-service', '2026.1')).toEqual({
        kind: 'SCM_RELEASE',
        predicate: {
          repositoryName: 'qits-projects-service',
          projectId: null,
          minimumVersion: '2026.1',
        },
      });
    });

    it('a person approves', () => {
      expect(JSON.stringify(approvalCriterion())).toBe('{"kind":"APPROVAL","predicate":{}}');
    });
  });

  describe('the condition a gesture PUTs', () => {
    const groups: CriterionGroupDto[] = [
      { id: 'g1', criteria: [waitsOn('k1', 'a', true)] },
      { id: 'g2', criteria: [APPROVAL, waitsOn('k2', 'b')] },
    ];

    it('restates the rest with their ids, so their latches are kept', () => {
      expect(withoutCriterion(groups, 'k2')).toEqual([
        {
          criteria: [
            { id: 'k1', kind: 'ENTITY_STATUS', predicate: { entityId: 'a', status: 'VERIFIED' } },
          ],
        },
        { criteria: [{ id: 'k-approve', kind: 'APPROVAL', predicate: {} }] },
      ]);
    });

    it('drops a group its last criterion leaves empty', () => {
      expect(withoutCriterion(groups, 'k1')).toEqual([
        {
          criteria: [
            { id: 'k-approve', kind: 'APPROVAL', predicate: {} },
            { id: 'k2', kind: 'ENTITY_STATUS', predicate: { entityId: 'b', status: 'VERIFIED' } },
          ],
        },
      ]);
      expect(withoutCriterion([groups[0]], 'k1')).toEqual([]);
    });

    it('"…and wait for" adds to the group; "or instead…" adds a group', () => {
      const added = approvalCriterion();
      const and = withCriterion(groups, added, 0);
      expect(and.length).toBe(2);
      expect(and[0].criteria).toEqual([
        { id: 'k1', kind: 'ENTITY_STATUS', predicate: { entityId: 'a', status: 'VERIFIED' } },
        { kind: 'APPROVAL', predicate: {} },
      ]);
      const or = withCriterion(groups, added, null);
      expect(or.length).toBe(3);
      expect(or[2]).toEqual({ criteria: [{ kind: 'APPROVAL', predicate: {} }] });
    });
  });

  describe('dependency is not order', () => {
    it('names targets by qualified id with ↑ above and ↓ below, never from position', () => {
      // A, B (inserted later), C — and C still waits on A, not on the B now above it.
      const a = member('a', 'qits-1');
      const b = member('b', 'qits-2');
      const c = member('c', 'qits-3', [{ id: 'g', criteria: [waitsOn('k', 'a')] }]);
      const members = [a, b, c];
      expect(waitsForLine(waitTargets(c, members), true)).toBe('waits for: qits-1 ↑');
      expect(waitsForLine(waitTargets(b, members), false)).toBe(
        'runs as soon as the campaign starts',
      );

      // Reordered so the target sits below: the marker turns.
      expect(waitsForLine(waitTargets(c, [c, b, a]), true)).toBe('waits for: qits-1 ↓');
    });

    it('reads the progress read’s waitsFor when given, once per target', () => {
      const a = member('a', 'qits-1');
      const c = member('c', 'qits-3');
      expect(waitTargets(c, [a, c], ['a', 'a']).map((t) => t.name)).toEqual(['qits-1']);
    });

    it('says nothing for a condition that waits on no member', () => {
      const c = member('c', 'qits-3', [{ id: 'g', criteria: [APPROVAL] }]);
      expect(waitsForLine(waitTargets(c, [c]), true)).toBe('');
    });
  });

  it('writes each criterion as a sentence', () => {
    const refs = memberRefs([member('a', 'qits-1')]);
    expect(criterionSentence(entityStatusCriterion('a', 'VERIFIED'), refs)).toBe(
      'qits-1 reaches VERIFIED',
    );
    expect(criterionSentence(deploymentCriterion('qits-projects', 'dev', '2026.1'), refs)).toBe(
      'qits-projects goes live in dev at or above 2026.1',
    );
    expect(criterionSentence(releaseCriterion('qits-ci-service'), refs)).toBe(
      'qits-ci-service releases',
    );
    expect(criterionSentence(approvalCriterion(), refs)).toBe('a person approves');
  });

  it('is editable only while unclaimed on a campaign being shaped', () => {
    expect(editableMember(member('a', 'qits-1'), 'REFINED')).toBe(true);
    expect(
      editableMember(member('a', 'qits-1', [], { claimedAt: '2026-09-27T09:00:00Z' }), 'REFINED'),
    ).toBe(false);
    expect(editableMember(member('a', 'qits-1'), 'IMPLEMENTED')).toBe(false);
  });

  it('draws a listing row as a desk item', () => {
    const item = campaignEntity({
      id: 'c1',
      number: 4,
      qualifiedId: 'qits-4',
      projectId: 'p1',
      title: 'Rename qits-x',
      status: 'REFINED',
      started: true,
      active: false,
      members: 1,
    });
    expect(item.archetype).toBe('CAMPAIGN');
    expect(campaignLine(item)).toBe('1 member · paused');
  });

  /** `blocked` is optional on the wire, same as an epic's or a ticket's — absent resolves to false. */
  it('resolves a missing blocked to false, and carries a true one through', () => {
    const row = {
      id: 'c1',
      number: 4,
      qualifiedId: 'qits-4',
      projectId: 'p1',
      title: 'Rename qits-x',
      status: 'REFINED',
      started: true,
      active: false,
      members: 1,
    };
    expect(campaignEntity(row).blocked).toBe(false);
    expect(campaignEntity({ ...row, blocked: true }).blocked).toBe(true);
  });
});
