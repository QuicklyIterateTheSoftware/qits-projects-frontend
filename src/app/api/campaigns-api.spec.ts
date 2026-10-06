import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CampaignsApi } from './campaigns-api';
import { workOfCampaign } from '../../testing/work-fixtures';
import type { CampaignDto, CampaignMemberDto, CampaignProgressDto } from './dto';

const AT = '2026-09-07T09:00:00Z';

const MEMBER: CampaignMemberDto = {
  membershipId: 'm1',
  position: 0,
  entity: {
    id: 't1',
    archetype: 'TICKET',
    qualifiedId: 'qits-1',
    title: 'Step 1',
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
  groups: [],
};

const CAMPAIGN: CampaignDto = {
  id: 'c1',
  number: 4,
  qualifiedId: 'qits-4',
  projectId: 'p1',
  slug: 'rename-qits-x',
  title: 'Rename qits-x',
  description: 'in order',
  status: 'REPORTED',
  start: null,
  members: [MEMBER],
};

const PROGRESS: CampaignProgressDto = {
  campaign: {
    id: 'c1',
    qualifiedId: 'qits-4',
    title: 'Rename qits-x',
    status: 'REFINED',
    start: null,
  },
  evaluator: { connected: true, lastSweepCompletedAt: null, stalled: false },
  members: [],
};

/**
 * The campaign doors, one per method: the path, the verb, the body — and that an argument left out
 * is left off the body rather than sent as null, since the service reads an absent `inFlight` as
 * "decide for me" and an absent `note` as "nothing said".
 */
describe('CampaignsApi', () => {
  let api: CampaignsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(CampaignsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('summarises a listed campaign from its progress', async () => {
    const row = workOfCampaign({ id: 'c1', number: 4, qualifiedId: 'qits-4', status: 'REFINED' });
    const answer = api.summary(row);
    const request = http.expectOne('/projects/api/work/qits-4/progress');
    expect(request.request.method).toBe('GET');
    request.flush({
      progress: {
        ...PROGRESS,
        campaign: {
          ...PROGRESS.campaign,
          start: { firstStartedAt: AT, startedAt: AT, startedBy: 'kim', active: true },
        },
        members: [{}, {}, {}],
      },
    });
    expect(await answer).toMatchObject({
      qualifiedId: 'qits-4',
      started: true,
      active: true,
      members: 3,
    });
  });

  it('creates a campaign through POST /work, leaving an empty description off', async () => {
    const withText = api.create('p1', 'Rename qits-x', 'in order');
    const first = http.expectOne('/projects/api/work');
    expect(first.request.method).toBe('POST');
    expect(first.request.body).toEqual({
      archetype: 'CAMPAIGN',
      project: 'p1',
      title: 'Rename qits-x',
      description: 'in order',
    });
    first.flush(workOfCampaign({ id: 'c1', qualifiedId: 'qits-4' }), {
      status: 201,
      statusText: 'Created',
    });
    expect((await withText).id).toBe('c1');

    const bare = api.create('p1', 'Rename qits-x');
    const second = http.expectOne('/projects/api/work');
    expect(second.request.body).toEqual({
      archetype: 'CAMPAIGN',
      project: 'p1',
      title: 'Rename qits-x',
    });
    second.flush(workOfCampaign({ id: 'c1' }), { status: 201, statusText: 'Created' });
    await bare;
  });

  it('reads one campaign from the entity, its members and its progress', async () => {
    const read = api.get('qits-4');
    http
      .expectOne('/projects/api/work/qits-4')
      .flush({ ...workOfCampaign({ ...CAMPAIGN, members: 1 }), description: 'in order' });
    http.expectOne('/projects/api/work/qits-4/members').flush({ members: [MEMBER] });
    http.expectOne('/projects/api/work/qits-4/progress').flush({ progress: PROGRESS });
    expect(await read).toMatchObject({
      id: 'c1',
      slug: 'rename-qits-x',
      description: 'in order',
      start: null,
      members: [{ membershipId: 'm1' }],
    });
  });

  it('moves its status through the one lifecycle door', async () => {
    const moved = api.transition('qits-4', 'REFINED');
    const request = http.expectOne('/projects/api/work/qits-4/status');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ target: 'REFINED' });
    request.flush({ ...workOfCampaign({ ...CAMPAIGN, members: 1 }), status: 'REFINED' });
    expect((await moved).status).toBe('REFINED');
  });

  it('adds a member, sending inFlight and position only when given', async () => {
    const auto = api.addMember('qits-4', 't1');
    const first = http.expectOne('/projects/api/work/qits-4/members');
    expect(first.request.method).toBe('POST');
    expect(first.request.body).toEqual({ entityId: 't1' });
    first.flush({ member: MEMBER }, { status: 201, statusText: 'Created' });
    expect((await auto).membershipId).toBe('m1');

    const pinned = api.addMember('qits-4', 't2', 1, false);
    const second = http.expectOne('/projects/api/work/qits-4/members');
    expect(second.request.body).toEqual({ entityId: 't2', position: 1, inFlight: false });
    second.flush({ member: MEMBER }, { status: 201, statusText: 'Created' });
    await pinned;
  });

  it('moves, removes and restates a member', async () => {
    const moved = api.moveMember('qits-4', 'm1', 2);
    const move = http.expectOne('/projects/api/work/qits-4/members/m1/position');
    expect(move.request.method).toBe('PUT');
    expect(move.request.body).toEqual({ position: 2 });
    move.flush({ members: [MEMBER] });
    expect((await moved).map((member) => member.membershipId)).toEqual(['m1']);

    const removed = api.removeMember('qits-4', 'm1');
    const remove = http.expectOne('/projects/api/work/qits-4/members/m1');
    expect(remove.request.method).toBe('DELETE');
    remove.flush({ members: [] });
    expect(await removed).toEqual([]);

    const groups = [{ criteria: [{ kind: 'APPROVAL' as const, predicate: {} }] }];
    const restated = api.setCondition('qits-4', 'm1', groups);
    const condition = http.expectOne('/projects/api/work/qits-4/members/m1/condition');
    expect(condition.request.method).toBe('PUT');
    expect(condition.request.body).toEqual({ groups });
    condition.flush({ member: MEMBER });
    await restated;
  });

  it('approves with the note, and with none', async () => {
    const noted = api.approve('qits-4', 'm1', 'k1', 'go');
    const first = http.expectOne('/projects/api/work/qits-4/members/m1/criteria/k1/approve');
    expect(first.request.method).toBe('POST');
    expect(first.request.body).toEqual({ note: 'go' });
    first.flush({ member: MEMBER });
    await noted;

    const silent = api.approve('qits-4', 'm1', 'k1');
    const second = http.expectOne('/projects/api/work/qits-4/members/m1/criteria/k1/approve');
    expect(second.request.body).toEqual({});
    second.flush({ member: MEMBER });
    await silent;
  });

  it('reads the progress and unwraps it', async () => {
    const read = api.progress('qits-4');
    const request = http.expectOne('/projects/api/work/qits-4/progress');
    expect(request.request.method).toBe('GET');
    request.flush({ progress: PROGRESS });
    expect((await read).evaluator.connected).toBe(true);
  });
});
