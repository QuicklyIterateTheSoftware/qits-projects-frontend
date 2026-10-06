import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignDto, CampaignMemberDto, CriterionDto } from '../api/dto';
import { progressOfSummary, workOfCampaign } from '../../testing/work-fixtures';
import { CampaignMembers } from './campaign-members';

const AT = '2026-09-27T09:00:00Z';

function member(
  id: string,
  qualified: string,
  position: number,
  over: Partial<CampaignMemberDto> = {},
): CampaignMemberDto {
  return {
    membershipId: `m-${id}`,
    position,
    entity: {
      id,
      archetype: 'TICKET',
      qualifiedId: qualified,
      title: `Step ${position + 1}`,
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
    ...over,
  };
}

function seeded(id: string, entityId: string): CriterionDto {
  return {
    id,
    kind: 'ENTITY_STATUS',
    predicate: { entityId, status: 'VERIFIED' },
    seeded: true,
    satisfiedAt: null,
    evidence: null,
    approval: null,
  };
}

const APPROVAL: CriterionDto = {
  id: 'k-ok',
  kind: 'APPROVAL',
  predicate: {},
  seeded: false,
  satisfiedAt: null,
  evidence: null,
  approval: null,
};

/** Three members: A; B seeded on A; C seeded on B, and also any-of an approval. */
function campaign(over: Partial<CampaignDto> = {}): CampaignDto {
  return {
    id: 'c1',
    number: 430,
    qualifiedId: 'qits-430',
    projectId: 'p1',
    slug: 'rename',
    title: 'Rename qits-x',
    description: 'in order',
    status: 'REFINED',
    start: null,
    members: [
      member('a', 'qits-411', 0),
      member('b', 'qits-409', 1, { groups: [{ id: 'g-b', criteria: [seeded('k-b', 'a')] }] }),
      member('c', 'qits-412', 2, {
        groups: [
          { id: 'g-c1', criteria: [seeded('k-c', 'b')] },
          { id: 'g-c2', criteria: [APPROVAL] },
        ],
      }),
    ],
    ...over,
  };
}

/**
 * The authoring half of the CAMPAIGN body (qits-419): the seeded row is visible and one click away
 * from gone; a ✕ that empties a group drops the group; a reorder is a reorder and nothing more; and
 * the "waits for" line is the criteria's, never the order's.
 */
describe('CampaignMembers', () => {
  let fixture: ComponentFixture<CampaignMembers>;
  let http: HttpTestingController;
  let current: CampaignDto;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    current = campaign();
    fixture = TestBed.createComponent(CampaignMembers);
    fixture.componentRef.setInput('campaignId', 'c1');
    fixture.componentRef.setInput('projectSlug', 'qits');
    fixture.componentRef.setInput('entities', [
      { id: 'a', archetype: 'TICKET', qualifiedId: 'qits-411', title: 'Step 1' },
      { id: 'e9', archetype: 'EPIC', qualifiedId: 'qits-9', title: 'An epic' },
      { id: 't8', archetype: 'TICKET', qualifiedId: 'qits-8', title: 'A ticket' },
    ]);
    fixture.componentRef.setInput('repositories', ['qits-ci-service']);
    await settle();
  });

  afterEach(() => http.verify());

  /** Answer the campaign read whenever it is asked for, and render. */
  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The campaign's read is three: the entity, its members, and its start off the progress.
      for (const request of http.match({ method: 'GET', url: '/projects/api/work/c1' })) {
        request.flush({
          ...workOfCampaign({ ...current, members: current.members.length }),
          slug: current.slug,
          description: current.description,
        });
      }
      for (const request of http.match({ method: 'GET', url: '/projects/api/work/c1/members' })) {
        request.flush({ members: current.members });
      }
      for (const request of http.match({ method: 'GET', url: '/projects/api/work/c1/progress' })) {
        request.flush({
          progress: {
            ...progressOfSummary({ ...current, members: 0 }),
            campaign: {
              id: current.id,
              qualifiedId: current.qualifiedId,
              title: current.title,
              status: current.status,
              start: current.start,
            },
          },
        });
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

  function press(host: Element, selector: string): void {
    const target = host.querySelector(selector);
    const button = (target?.querySelector('button') ?? target) as HTMLButtonElement | null;
    expect(button, `no button at ${selector}`).toBeTruthy();
    button!.click();
    fixture.detectChanges();
  }

  function answer(request: TestRequest, body: object): void {
    request.flush(body);
  }

  it('draws each member by position with its seeded criterion as a sentence', () => {
    const titles = Array.from(element().querySelectorAll('.member .qualified')).map(
      (node) => node.textContent,
    );
    expect(titles).toEqual(['qits-411', 'qits-409', 'qits-412']);

    const b = row('b');
    expect(b.querySelector('.sentence')?.textContent).toBe('qits-411 reaches VERIFIED');
    expect(b.querySelector('.seeded')?.textContent).toBe('seeded');
    expect(b.querySelector('.remove-criterion')?.textContent?.trim()).toBe('✕');
    expect(b.querySelector('.waits-for')?.textContent).toBe('waits for: qits-411 ↑');

    expect(row('a').querySelector('.waits-for')?.textContent).toBe(
      'runs as soon as the campaign starts',
    );
    // Two groups read as any-of boxes, each an all-of list.
    expect(row('c').querySelectorAll('.group').length).toBe(2);
    expect(row('c').querySelector('.or')?.textContent).toBe('or');
  });

  it('deletes the seeded row in one click: the PUT drops it and its emptied group', async () => {
    press(row('b'), '.remove-criterion');
    const put = http.expectOne('/projects/api/work/c1/members/m-b/condition');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ groups: [] });
    answer(put, { member: { ...current.members[1], groups: [] } });
    await settle();

    expect(row('b').querySelector('.criterion')).toBeNull();
    expect(row('b').querySelector('.waits-for')?.textContent).toBe(
      'runs as soon as the campaign starts',
    );
  });

  it('drops only the group its last criterion leaves empty, keeping the others by id', async () => {
    press(row('c'), '[data-group="g-c1"] .remove-criterion');
    const put = http.expectOne('/projects/api/work/c1/members/m-c/condition');
    expect(put.request.body).toEqual({
      groups: [{ criteria: [{ id: 'k-ok', kind: 'APPROVAL', predicate: {} }] }],
    });
    answer(put, { member: current.members[2] });
    await settle();
  });

  it('reorders with ↑ and ↓ through moveMember, and sends no condition', async () => {
    press(row('c'), '.up');
    const move = http.expectOne('/projects/api/work/c1/members/m-c/position');
    expect(move.request.method).toBe('PUT');
    expect(move.request.body).toEqual({ position: 1 });
    const [a, b, c] = current.members;
    current = { ...current, members: [a, { ...c, position: 1 }, { ...b, position: 2 }] };
    answer(move, { members: current.members });
    await settle();

    expect(http.match((request) => request.url.endsWith('/condition'))).toEqual([]);
    // C still waits on B, which now sits below it.
    expect(row('c').querySelector('.waits-for')?.textContent).toBe('waits for: qits-409 ↓');
    expect(row('a').querySelector('.up button')?.hasAttribute('disabled')).toBe(true);
  });

  it('adds to a group with "…and wait for" and opens a group with "or instead…"', async () => {
    press(row('b'), '.and-wait');
    const form = row('b').querySelector('app-campaign-criterion-form')!;
    const kind = form.querySelector<HTMLSelectElement>('.kind')!;
    kind.value = 'APPROVAL';
    kind.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    press(form, '.save-criterion');
    const and = http.expectOne('/projects/api/work/c1/members/m-b/condition');
    expect(and.request.body).toEqual({
      groups: [
        {
          criteria: [
            { id: 'k-b', kind: 'ENTITY_STATUS', predicate: { entityId: 'a', status: 'VERIFIED' } },
            { kind: 'APPROVAL', predicate: {} },
          ],
        },
      ],
    });
    answer(and, { member: current.members[1] });
    await settle();

    press(row('b'), '.or-instead');
    const orForm = row('b').querySelector('app-campaign-criterion-form')!;
    // The member picker defaults to the previous member.
    expect(orForm.querySelector<HTMLSelectElement>('.target')?.value).toBe('a');
    press(orForm, '.save-criterion');
    const or = http.expectOne('/projects/api/work/c1/members/m-b/condition');
    expect(or.request.body).toEqual({
      groups: [
        {
          criteria: [
            { id: 'k-b', kind: 'ENTITY_STATUS', predicate: { entityId: 'a', status: 'VERIFIED' } },
          ],
        },
        { criteria: [{ kind: 'ENTITY_STATUS', predicate: { entityId: 'a', status: 'VERIFIED' } }] },
      ],
    });
    answer(or, { member: current.members[1] });
    await settle();
  });

  it('offers only this campaign’s other members to wait for', () => {
    press(row('b'), '.and-wait');
    const offered = Array.from(row('b').querySelectorAll('.target option')).map((option) =>
      option.getAttribute('value'),
    );
    expect(offered).toEqual(['a', 'c']);
  });

  it('adds a member from the epics and tickets not in it, sending nothing on auto', async () => {
    const offered = Array.from(element().querySelectorAll('.candidate option')).map((option) =>
      option.getAttribute('value'),
    );
    expect(offered).toEqual(['e9', 't8']);

    press(element(), '.add');
    const auto = http.expectOne('/projects/api/work/c1/members');
    expect(auto.request.body).toEqual({ entityId: 'e9' });
    answer(auto, { member: member('e9', 'qits-9', 3, { joinedRunning: true }) });
    await settle();
    expect(element().querySelector('.added')?.textContent).toContain(
      'qits-9 joined already running',
    );

    const inFlight = element().querySelector<HTMLSelectElement>('.in-flight')!;
    inFlight.value = 'no';
    inFlight.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    press(element(), '.add');
    const no = http.expectOne('/projects/api/work/c1/members');
    expect(no.request.body).toEqual({ entityId: 'e9', inFlight: false });
    answer(no, { member: member('e9', 'qits-9', 3) });
    await settle();
  });

  it('removes an unclaimed member on a second press, and shows a 409 as the service said it', async () => {
    press(row('a'), '.remove-member');
    expect(http.match('/projects/api/work/c1/members/m-a')).toEqual([]);
    press(row('a'), '.remove-member');
    const remove = http.expectOne('/projects/api/work/c1/members/m-a');
    expect(remove.request.method).toBe('DELETE');
    remove.flush(
      {
        message:
          'Cannot remove qits-411 from campaign qits-430: qits-409 (member m-b) waits on it.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    expect(element().querySelector('.failed')?.textContent).toBe(
      'Cannot remove qits-411 from campaign qits-430: qits-409 (member m-b) waits on it.',
    );
  });

  it('draws a claimed member read-only, with no remove', async () => {
    current = campaign();
    current = {
      ...current,
      members: current.members.map((row) =>
        row.membershipId === 'm-b' ? { ...row, claimedAt: AT, joinedRunning: true } : row,
      ),
    };
    void fixture.componentInstance.load();
    await settle();

    const b = row('b');
    expect(b.querySelector('.remove-criterion')).toBeNull();
    expect(b.querySelector('.and-wait')).toBeNull();
    expect(b.querySelector('.or-instead')).toBeNull();
    expect(b.querySelector('.remove-member')).toBeNull();
    expect(b.querySelector('.joined')).toBeTruthy();
    // The seeded row is still visible: read-only, not hidden.
    expect(b.querySelector('.seeded')?.textContent).toBe('seeded');
  });
});
