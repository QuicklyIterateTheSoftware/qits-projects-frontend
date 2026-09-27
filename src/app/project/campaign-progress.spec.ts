import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  CampaignCriterionProgressDto,
  CampaignMemberProgressDto,
  CampaignMemberState,
  CampaignProgressDto,
} from '../api/dto';
import { CampaignProgress } from './campaign-progress';

const AT = '2026-09-27T09:00:00Z';

function criterion(over: Partial<CampaignCriterionProgressDto> = {}): CampaignCriterionProgressDto {
  return {
    id: 'k1',
    kind: 'ENTITY_STATUS',
    seeded: true,
    satisfied: false,
    wouldBeSatisfiedBy: 'qits-411 (Some epic) reaches VERIFIED',
    satisfiable: true,
    reason: null,
    evidence: null,
    approval: null,
    satisfiedAt: null,
    ...over,
  };
}

function member(
  id: string,
  state: CampaignMemberState,
  over: Partial<CampaignMemberProgressDto> = {},
): CampaignMemberProgressDto {
  return {
    membershipId: `m-${id}`,
    position: 0,
    entity: {
      id,
      archetype: 'TICKET',
      qualifiedId: `qits-${id}`,
      title: `Member ${id}`,
      status: 'REFINED',
      blocked: false,
    },
    state,
    waitsFor: [],
    joinedRunning: false,
    groups: [],
    dispatchedAt: null,
    dispatch: { workspaceId: null, branch: null, agentLaunch: null },
    dispatchRefusal: null,
    dispatchRefusedAt: null,
    dispatchError: null,
    ...over,
  };
}

function progress(
  members: readonly CampaignMemberProgressDto[],
  evaluator = { connected: true, lastSweepCompletedAt: AT, stalled: false },
): CampaignProgressDto {
  return {
    campaign: {
      id: 'c1',
      qualifiedId: 'qits-430',
      title: 'Rename',
      status: 'REFINED',
      start: null,
    },
    evaluator,
    members,
  };
}

/**
 * The running view (qits-420): a line per state, the unsatisfiable criterion in the warning variant,
 * satisfied criteria as records, the evaluator line only when nothing is listening, and the approval
 * ask — a note, then a confirm press — with no decline.
 */
describe('CampaignProgress', () => {
  let fixture: ComponentFixture<CampaignProgress>;
  let http: HttpTestingController;
  let current: CampaignProgressDto;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    current = progress([]);
  });

  afterEach(() => http.verify());

  async function mount(): Promise<void> {
    fixture = TestBed.createComponent(CampaignProgress);
    fixture.componentRef.setInput('campaignId', 'c1');
    fixture.componentRef.setInput('projectSlug', 'qits');
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const request of http.match('/projects/api/campaigns/c1/progress')) {
        request.flush({ progress: current });
      }
    }
    fixture.detectChanges();
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function row(id: string): HTMLElement {
    const found = element().querySelector<HTMLElement>(`[data-membership="m-${id}"]`);
    expect(found, `no row for ${id}`).toBeTruthy();
    return found!;
  }

  function line(id: string): string {
    return row(id).querySelector('.state-line')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('draws a chip for each of the eight states, with its meaning on hover', async () => {
    const states: CampaignMemberState[] = [
      'WAITING',
      'READY',
      'REFUSED',
      'RUNNING',
      'JOINED_RUNNING',
      'DONE',
      'DROPPED',
      'DISPATCH_FAILED',
    ];
    current = progress(states.map((state, index) => member(`${index + 1}`, state)));
    await mount();

    const chips = Array.from(element().querySelectorAll<HTMLElement>('.state-chip'));
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual([
      'waiting',
      'ready',
      'refused',
      'running',
      'joined running',
      'done',
      'dropped',
      'dispatch failed',
    ]);
    for (const chip of chips) {
      expect(chip.getAttribute('title')?.length).toBeGreaterThan(10);
    }
  });

  it('lists what a WAITING member waits for', async () => {
    current = progress([
      member('1', 'WAITING', {
        groups: [{ id: 'g', satisfied: false, criteria: [criterion()] }],
      }),
    ]);
    await mount();

    expect(row('1').querySelector('.would')?.textContent?.trim()).toBe(
      'qits-411 (Some epic) reaches VERIFIED',
    );
    expect(row('1').querySelector('.unsatisfiable')).toBeNull();
  });

  it('flags an unsatisfiable criterion in the warning variant with its reason, not as an error', async () => {
    current = progress([
      member('1', 'WAITING', {
        groups: [
          {
            id: 'g',
            satisfied: false,
            criteria: [criterion({ satisfiable: false, reason: 'target dropped' })],
          },
        ],
      }),
    ]);
    await mount();

    const flagged = row('1').querySelector('.would.unsatisfiable');
    expect(flagged?.textContent).toContain('target dropped');
    expect(element().querySelector('[role="alert"]')).toBeNull();
  });

  it('says why a REFUSED member was refused, when, and links to it', async () => {
    current = progress([
      member('1', 'REFUSED', { dispatchRefusal: 'qits-1 is blocked', dispatchRefusedAt: AT }),
    ]);
    await mount();

    expect(line('1')).toContain('Refused 27 Sep 2026 09:00:00Z: qits-1 is blocked');
    expect(row('1').querySelector('a.fix')?.getAttribute('href')).toBe('/qits/work/qits-1');
  });

  it('gives a RUNNING member its status, dispatch time, branch and workspace', async () => {
    current = progress([
      member('1', 'RUNNING', {
        dispatchedAt: AT,
        dispatch: { workspaceId: '7', branch: 'ticket/one', agentLaunch: 'SCHEDULED' },
      }),
    ]);
    await mount();

    expect(line('1')).toBe(
      'refined · dispatched 27 Sep 2026 09:00:00Z · branch ticket/one · workspace 7',
    );
  });

  it('says a JOINED_RUNNING member was never dispatched by this campaign', async () => {
    current = progress([
      member('1', 'JOINED_RUNNING', {
        joinedRunning: true,
        dispatch: { workspaceId: '9', branch: 'epic/one', agentLaunch: null },
      }),
    ]);
    await mount();

    expect(line('1')).toContain('joined already running — never dispatched by this campaign');
    expect(line('1')).toContain('branch epic/one · workspace 9');
  });

  it('gives a DISPATCH_FAILED member its error and the hint to dispatch by hand', async () => {
    current = progress([member('1', 'DISPATCH_FAILED', { dispatchError: 'workspaces is down' })]);
    await mount();

    expect(line('1')).toBe('workspaces is down');
    expect(row('1').querySelector('.hint')?.textContent?.trim()).toBe(
      'the claim is kept; dispatch the member by hand if no workspace came up',
    );
  });

  it('gives DONE and DROPPED members their status', async () => {
    current = progress([
      member('1', 'DONE', {
        entity: { ...member('1', 'DONE').entity, status: 'VERIFIED' },
      }),
      member('2', 'DROPPED', { entity: { ...member('2', 'DROPPED').entity, status: 'DROPPED' } }),
    ]);
    await mount();

    expect(line('1')).toBe('verified');
    expect(line('2')).toBe('dropped');
  });

  it('draws satisfied criteria as records: the event, the state at start, the approval', async () => {
    current = progress([
      member('1', 'READY', {
        groups: [
          {
            id: 'g',
            satisfied: true,
            criteria: [
              criterion({
                id: 'a',
                kind: 'DEPLOYMENT_ACTIVE',
                satisfied: true,
                satisfiedAt: AT,
                evidence: {
                  eventId: '0f3c9a12-aaaa-bbbb',
                  signature: 'DeploymentActive',
                  summary: 'qits-projects 2026.1001.91244 in dev',
                },
              }),
              criterion({
                id: 'b',
                satisfied: true,
                satisfiedAt: AT,
                evidence: {
                  eventId: null,
                  signature: 'STATE_AT_START',
                  summary: 'qits-412 was already VERIFIED when the campaign started',
                },
              }),
              criterion({
                id: 'c',
                kind: 'APPROVAL',
                satisfied: true,
                satisfiedAt: AT,
                approval: { approvedBy: 'xion', note: 'go' },
              }),
            ],
          },
        ],
      }),
    ]);
    await mount();

    const records = Array.from(row('1').querySelectorAll('.evidence li')).map((li) =>
      li.textContent?.trim(),
    );
    expect(records).toEqual([
      'matched DeploymentActive: qits-projects 2026.1001.91244 in dev at 27 Sep 2026 09:00:00Z · event 0f3c9a12',
      'qits-412 was already VERIFIED when the campaign started',
      'approved by xion at 27 Sep 2026 09:00:00Z: go',
    ]);
    // No ask form on an approval already given.
    expect(row('1').querySelector('.ask')).toBeNull();
  });

  describe('the evaluator line', () => {
    const WARNING =
      'The campaign evaluator is not listening. Waiting members may be waiting on nothing.';

    it('is absent while the evaluator is connected and not stalled', async () => {
      await mount();
      expect(element().querySelector('.evaluator-warning')).toBeNull();
    });

    it('appears when the evaluator is disconnected', async () => {
      current = progress([], { connected: false, lastSweepCompletedAt: AT, stalled: false });
      await mount();
      expect(element().querySelector('.evaluator-warning')?.textContent).toBe(WARNING);
    });

    it('appears when the sweep has stalled', async () => {
      current = progress([], { connected: true, lastSweepCompletedAt: AT, stalled: true });
      await mount();
      expect(element().querySelector('.evaluator-warning')?.textContent).toBe(WARNING);
    });
  });

  describe('the approval', () => {
    beforeEach(() => {
      current = progress([
        member('1', 'WAITING', {
          groups: [
            {
              id: 'g',
              satisfied: false,
              criteria: [
                criterion({ id: 'ok', kind: 'APPROVAL', wouldBeSatisfiedBy: 'a person approves' }),
              ],
            },
          ],
        }),
      ]);
    });

    function approveButton(): HTMLButtonElement {
      return row('1').querySelector<HTMLButtonElement>('.approve button')!;
    }

    it('needs the confirm press, then posts the note', async () => {
      await mount();
      expect(
        Array.from(element().querySelectorAll('button')).map((b) => b.textContent?.trim()),
      ).not.toContain('Decline');

      const note = row('1').querySelector<HTMLInputElement>('.note-field')!;
      note.value = 'ship it';
      note.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(approveButton().textContent?.trim()).toBe('Approve');
      approveButton().click();
      fixture.detectChanges();
      expect(http.match((request) => request.method === 'POST')).toEqual([]);
      expect(approveButton().textContent?.trim()).toBe('Confirm approve?');

      approveButton().click();
      fixture.detectChanges();
      const post = http.expectOne('/projects/api/campaigns/c1/members/m-1/criteria/ok/approve');
      expect(post.request.method).toBe('POST');
      expect(post.request.body).toEqual({ note: 'ship it' });
      post.flush({ member: {} });
      await settle();
    });

    it('shows a 409 as the service said it', async () => {
      await mount();
      approveButton().click();
      fixture.detectChanges();
      approveButton().click();
      fixture.detectChanges();
      http
        .expectOne('/projects/api/campaigns/c1/members/m-1/criteria/ok/approve')
        .flush(
          { message: 'Criterion ok was already approved by dev at 2026-09-27T09:00:00Z.' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(row('1').querySelector('.failed')?.textContent).toBe(
        'Criterion ok was already approved by dev at 2026-09-27T09:00:00Z.',
      );
    });

    it('shows a non-admin’s 403 with the service’s sentence', async () => {
      await mount();
      approveButton().click();
      fixture.detectChanges();
      approveButton().click();
      fixture.detectChanges();
      http
        .expectOne('/projects/api/campaigns/c1/members/m-1/criteria/ok/approve')
        .flush({ message: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
      await settle();

      expect(row('1').querySelector('.failed')?.textContent).toBe(
        'That did not work — 403 forbidden.',
      );
    });
  });
});
