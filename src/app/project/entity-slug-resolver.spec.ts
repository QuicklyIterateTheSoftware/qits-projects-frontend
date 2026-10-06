import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import type { EpicDto, TicketDto } from '../api/dto';
import { EVENT_SOURCE_FACTORY } from '../api/event-source';
import { workAnswer } from '../../testing/work-fixtures';

const AT = '2026-09-07T09:00:00Z';

/** A ticket and an epic sharing nothing but the project. */
const TICKET: Partial<TicketDto> = {
  id: 't1',
  projectId: 'p1',
  title: 'The badge',
  slug: 'cancelled-badge',
  number: 41,
  qualifiedId: 'qits-41',
  type: 'BUG',
  status: 'REPORTED',
  createdAt: AT,
  updatedAt: AT,
};

const EPIC: Partial<EpicDto> = {
  id: 'e1',
  projectId: 'p1',
  title: 'One desk',
  slug: 'one-desk',
  number: 12,
  qualifiedId: 'qits-12',
  status: 'REPORTED',
  createdAt: AT,
  updatedAt: AT,
};

/**
 * The old slug addresses keep working (qits-397): a ticket's page and an epic's refining room resolve
 * to the numbered addresses by one read of the archetype's list, carrying the query string along.
 */
describe('EntitySlugResolver', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: EVENT_SOURCE_FACTORY,
          useValue: () => ({
            onopen: null,
            onmessage: null,
            onerror: null,
            close: () => undefined,
          }),
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  async function projectList(): Promise<void> {
    for (const request of http.match('/projects/api/projects')) {
      request.flush({
        entries: [{ project: { id: 'p1', name: 'Qits', slug: 'qits', description: null } }],
      });
    }
    await settle();
  }

  it('replaces an old ticket address with the ticket’s numbered page', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await harness.navigateByUrl('/qits/tickets/cancelled-badge?page=notes');
    await projectList();

    // One read: the listing's summary rows are enough to resolve an address.
    http
      .expectOne('/projects/api/projects/p1/work')
      .flush(
        workAnswer(
          'p1',
          { epics: [EPIC], tickets: [TICKET] },
          '/projects/api/projects/p1/work',
        ) as object,
      );
    await settle();

    expect(navigate).toHaveBeenCalledWith(['/', 'qits', 'work', 'qits-41'], {
      queryParams: { page: 'notes' },
      replaceUrl: true,
    });
    http.verify();
  });

  it('replaces an old refining address with the epic’s room, keeping the tab', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await harness.navigateByUrl('/qits/epics/one-desk/refining?tab=chat');
    await projectList();

    http
      .expectOne('/projects/api/projects/p1/work')
      .flush(
        workAnswer(
          'p1',
          { epics: [EPIC], tickets: [TICKET] },
          '/projects/api/projects/p1/work',
        ) as object,
      );
    await settle();

    expect(navigate).toHaveBeenCalledWith(['/', 'qits', 'work', 'qits-12', 'refinement'], {
      queryParams: { tab: 'chat' },
      replaceUrl: true,
    });
    http.verify();
  });

  it('says so for a slug nobody has, rather than guessing', async () => {
    await harness.navigateByUrl('/qits/tickets/nobody');
    await projectList();
    http.expectOne('/projects/api/projects/p1/work').flush({ entities: [] });
    await settle();

    expect(harness.fixture.nativeElement.textContent).toContain(
      'Nothing in this project is called',
    );
    expect(TestBed.inject(Location).path()).toBe('/qits/tickets/nobody');
    http.verify();
  });
});
