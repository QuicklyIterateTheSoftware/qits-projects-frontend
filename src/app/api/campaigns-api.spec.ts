import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CampaignsApi } from './campaigns-api';
import type { CampaignDto, CampaignMemberDto, CampaignProgressDto } from './dto';

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

  it('lists a project’s campaigns and unwraps the envelope', async () => {
    const answer = api.list('p1');
    const request = http.expectOne('/projects/api/projects/p1/campaigns');
    expect(request.request.method).toBe('GET');
    request.flush({
      campaigns: [
        {
          id: 'c1',
          number: 4,
          qualifiedId: 'qits-4',
          projectId: 'p1',
          title: 'Rename qits-x',
          status: 'REFINED',
          started: false,
          active: false,
          members: 3,
        },
      ],
    });
    expect((await answer).map((row) => row.qualifiedId)).toEqual(['qits-4']);
  });

  it('creates a campaign, leaving an empty description off', async () => {
    const withText = api.create('p1', 'Rename qits-x', 'in order');
    const first = http.expectOne('/projects/api/projects/p1/campaigns');
    expect(first.request.method).toBe('POST');
    expect(first.request.body).toEqual({ title: 'Rename qits-x', description: 'in order' });
    first.flush({ campaign: CAMPAIGN });
    expect((await withText).id).toBe('c1');

    const bare = api.create('p1', 'Rename qits-x');
    const second = http.expectOne('/projects/api/projects/p1/campaigns');
    expect(second.request.body).toEqual({ title: 'Rename qits-x' });
    second.flush({ campaign: CAMPAIGN });
    await bare;
  });

  it('reads one campaign and moves its status through its own door', async () => {
    const read = api.get('c1');
    http.expectOne('/projects/api/campaigns/c1').flush({ campaign: CAMPAIGN });
    expect((await read).members.length).toBe(1);

    const moved = api.transition('c1', 'REFINED');
    const request = http.expectOne('/projects/api/campaigns/c1/transition');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ target: 'REFINED' });
    request.flush({ campaign: { ...CAMPAIGN, status: 'REFINED' } });
    expect((await moved).status).toBe('REFINED');
  });

  it('adds a member, sending inFlight and position only when given', async () => {
    const auto = api.addMember('c1', 't1');
    const first = http.expectOne('/projects/api/campaigns/c1/members');
    expect(first.request.method).toBe('POST');
    expect(first.request.body).toEqual({ entityId: 't1' });
    first.flush({ member: MEMBER });
    expect((await auto).membershipId).toBe('m1');

    const pinned = api.addMember('c1', 't2', 1, false);
    const second = http.expectOne('/projects/api/campaigns/c1/members');
    expect(second.request.body).toEqual({ entityId: 't2', position: 1, inFlight: false });
    second.flush({ member: MEMBER });
    await pinned;
  });

  it('moves, removes and restates a member', async () => {
    const moved = api.moveMember('c1', 'm1', 2);
    const move = http.expectOne('/projects/api/campaigns/c1/members/m1/position');
    expect(move.request.method).toBe('PUT');
    expect(move.request.body).toEqual({ position: 2 });
    move.flush({ campaign: CAMPAIGN });
    await moved;

    const removed = api.removeMember('c1', 'm1');
    const remove = http.expectOne('/projects/api/campaigns/c1/members/m1');
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null, { status: 204, statusText: 'No Content' });
    await removed;

    const groups = [{ criteria: [{ kind: 'APPROVAL' as const, predicate: {} }] }];
    const restated = api.setCondition('c1', 'm1', groups);
    const condition = http.expectOne('/projects/api/campaigns/c1/members/m1/condition');
    expect(condition.request.method).toBe('PUT');
    expect(condition.request.body).toEqual({ groups });
    condition.flush({ member: MEMBER });
    await restated;
  });

  it('approves with the note, and with none', async () => {
    const noted = api.approve('c1', 'm1', 'k1', 'go');
    const first = http.expectOne('/projects/api/campaigns/c1/members/m1/criteria/k1/approve');
    expect(first.request.method).toBe('POST');
    expect(first.request.body).toEqual({ note: 'go' });
    first.flush({ member: MEMBER });
    await noted;

    const silent = api.approve('c1', 'm1', 'k1');
    const second = http.expectOne('/projects/api/campaigns/c1/members/m1/criteria/k1/approve');
    expect(second.request.body).toEqual({});
    second.flush({ member: MEMBER });
    await silent;
  });

  it('reads the progress and unwraps it', async () => {
    const read = api.progress('c1');
    const request = http.expectOne('/projects/api/campaigns/c1/progress');
    expect(request.request.method).toBe('GET');
    request.flush({ progress: PROGRESS });
    expect((await read).evaluator.connected).toBe(true);
  });
});
