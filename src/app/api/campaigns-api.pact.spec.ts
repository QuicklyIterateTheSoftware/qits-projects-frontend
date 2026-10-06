import { PactV4 } from '@pact-foundation/pact';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addGoldenInteraction } from '@qits/angular/testing';
import { projectsGoldenMasters as masters } from '../../testing/golden-masters';
import { apiAt } from '../../testing/pact-client';
import { assertPactPart } from '../../testing/pact-part';
import { CampaignsApi } from './campaigns-api';

/**
 * `CampaignsApi`'s part of qits-projects-frontend's pact with qits-projects-service (epic qits-965):
 * a campaign's progress and its members — read, gathered, reordered, removed, conditioned and
 * approved — under `/work/{q}`, in the same file as the other api classes' parts
 * (`pacts/qits-projects-frontend_qits-projects-service.json`, see `src/testing/pact-part.ts`).
 *
 * A campaign's own read, create and move are `ProjectsApi`'s (`getWork`, `createWork`,
 * `setWorkStatus`), and pacted there.
 */
const CONSUMER = 'qits-projects-frontend';
const PROVIDER = 'qits-projects-service';
const COMMITTED = resolve(process.cwd(), `pacts/${CONSUMER}_${PROVIDER}.json`);
const OPERATIONS = [
  'getWorkProgress',
  'listWorkMembers',
  'addWorkMember',
  'moveWorkMember',
  'removeWorkMember',
  'setWorkMemberCondition',
  'approveWorkMemberCriterion',
];

/** One membership as the members tab draws it. */
const MEMBER = [
  'membershipId',
  'position',
  'entity',
  'claimedAt',
  'joinedRunning',
  'dispatchedAt',
  'dispatch',
  'dispatchRefusal',
  'dispatchRefusedAt',
  'dispatchError',
  'groups',
] as const;

const MEMBERS = MEMBER.map((path) => `members[].${path}`);
const ONE_MEMBER = MEMBER.map((path) => `member.${path}`);

/** How a campaign is running, as the progress tab draws it — and its start, for the campaign read. */
const GET_WORK_PROGRESS = [
  'progress.campaign.id',
  'progress.campaign.qualifiedId',
  'progress.campaign.title',
  'progress.campaign.status',
  'progress.campaign.start',
  'progress.evaluator.connected',
  'progress.evaluator.lastSweepCompletedAt',
  'progress.evaluator.stalled',
  'progress.members[].membershipId',
  'progress.members[].position',
  'progress.members[].entity',
  'progress.members[].state',
  'progress.members[].waitsFor',
  'progress.members[].joinedRunning',
  'progress.members[].groups',
  'progress.members[].dispatchedAt',
  'progress.members[].dispatch',
  'progress.members[].dispatchRefusal',
  'progress.members[].dispatchRefusedAt',
  'progress.members[].dispatchError',
] as const;

const MEMBERS_TO_EDIT = 'a campaign with members to edit';

const dir = mkdtempSync(join(tmpdir(), 'qits-projects-frontend-campaigns-api-pact-'));
const pact = new PactV4({ consumer: CONSUMER, provider: PROVIDER, dir, logLevel: 'warn' });

const given = (
  state: string,
  operationId: string,
  interaction: string,
  consumes: readonly string[],
) =>
  addGoldenInteraction(pact, masters, {
    provider: PROVIDER,
    state,
    operationId,
    trigger: { kind: 'ui', app: CONSUMER, interaction },
    consumes,
  });

/** `state`'s param `name`, as recorded for `operationId`. */
const param = (state: string, operationId: string, name: string) =>
  masters.operation(state, operationId).params[name];

/** What the recording sent. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the recorded JSON, read by key
const sent = (state: string, operationId: string): any =>
  masters.operation(state, operationId).body;

describe('qits-projects-frontend → qits-projects-service pact: CampaignsApi', () => {
  afterAll(() => {
    try {
      assertPactPart(
        join(dir, `${CONSUMER}-${PROVIDER}.json`),
        COMMITTED,
        OPERATIONS,
        'QITS_GOLDEN_UPDATE',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('show-work-item: how a campaign is running', () => {
    const state = 'a campaign in detail';
    return given(state, 'getWorkProgress', 'show-work-item', GET_WORK_PROGRESS).executeTest(
      async (server) => {
        const progress = await apiAt(server.url, CampaignsApi).progress(
          param(state, 'getWorkProgress', 'qualifiedId'),
        );
        expect(progress.members.length).toBeGreaterThan(0);
      },
    );
  });

  it.each([
    ['a campaign in detail', 'campaignQualifiedId'],
    [MEMBERS_TO_EDIT, 'qualifiedId'],
  ])('show-work-item: the members of %s', (state, name) =>
    given(state, 'listWorkMembers', 'show-work-item', MEMBERS).executeTest(async (server) => {
      const members = await apiAt(server.url, CampaignsApi).members(
        param(state, 'listWorkMembers', name),
      );
      expect(members.length).toBeGreaterThan(0);
    }),
  );

  it('edit-campaign-members: gathers an entity by its qualified id', () =>
    given(MEMBERS_TO_EDIT, 'addWorkMember', 'edit-campaign-members', ONE_MEMBER).executeTest(
      async (server) => {
        const member = await apiAt(server.url, CampaignsApi).addMember(
          param(MEMBERS_TO_EDIT, 'addWorkMember', 'qualifiedId'),
          sent(MEMBERS_TO_EDIT, 'addWorkMember').entityId,
        );
        expect(member.membershipId).toBeTruthy();
      },
    ));

  it('edit-campaign-members: moves a member, answering the members', () =>
    given(MEMBERS_TO_EDIT, 'moveWorkMember', 'edit-campaign-members', MEMBERS).executeTest(
      async (server) => {
        const members = await apiAt(server.url, CampaignsApi).moveMember(
          param(MEMBERS_TO_EDIT, 'moveWorkMember', 'qualifiedId'),
          param(MEMBERS_TO_EDIT, 'moveWorkMember', 'lastMembershipId'),
          sent(MEMBERS_TO_EDIT, 'moveWorkMember').position,
        );
        expect(members.length).toBeGreaterThan(0);
      },
    ));

  it('edit-campaign-members: removes a member, answering the members left', () =>
    given(MEMBERS_TO_EDIT, 'removeWorkMember', 'edit-campaign-members', MEMBERS).executeTest(
      async (server) => {
        const members = await apiAt(server.url, CampaignsApi).removeMember(
          param(MEMBERS_TO_EDIT, 'removeWorkMember', 'qualifiedId'),
          param(MEMBERS_TO_EDIT, 'removeWorkMember', 'lastMembershipId'),
        );
        expect(members.length).toBeGreaterThan(0);
      },
    ));

  it('edit-campaign-members: restates a member’s condition', () =>
    given(
      MEMBERS_TO_EDIT,
      'setWorkMemberCondition',
      'edit-campaign-members',
      ONE_MEMBER,
    ).executeTest(async (server) => {
      const member = await apiAt(server.url, CampaignsApi).setCondition(
        param(MEMBERS_TO_EDIT, 'setWorkMemberCondition', 'qualifiedId'),
        param(MEMBERS_TO_EDIT, 'setWorkMemberCondition', 'firstMembershipId'),
        sent(MEMBERS_TO_EDIT, 'setWorkMemberCondition').groups,
      );
      expect(member.groups.length).toBeGreaterThan(0);
    }));

  it('approve-campaign-criterion: a person’s yes, with a note', () =>
    given(
      MEMBERS_TO_EDIT,
      'approveWorkMemberCriterion',
      'approve-campaign-criterion',
      ONE_MEMBER,
    ).executeTest(async (server) => {
      const member = await apiAt(server.url, CampaignsApi).approve(
        param(MEMBERS_TO_EDIT, 'approveWorkMemberCriterion', 'qualifiedId'),
        param(MEMBERS_TO_EDIT, 'approveWorkMemberCriterion', 'lastMembershipId'),
        param(MEMBERS_TO_EDIT, 'approveWorkMemberCriterion', 'approvalCriterionId'),
        sent(MEMBERS_TO_EDIT, 'approveWorkMemberCriterion').note,
      );
      expect(member.membershipId).toBeTruthy();
    }));
});
