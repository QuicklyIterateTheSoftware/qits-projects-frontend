import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ArchetypeRegistry } from '../api/archetypes-api';
import type { EpicDto, TicketDto } from '../api/dto';
import { EntityTransitionPanel } from './entity-transition-panel';

const AT = '2026-09-19T09:00:00Z';

const REGISTRY: ArchetypeRegistry = {
  properties: ['TITLE', 'SLUG', 'DESCRIPTION', 'STATUS', 'TICKET_TYPE', 'IMPETUS', 'ASSIGNEE'],
  serverOwned: ['SLUG'],
  archetypes: [
    {
      archetype: 'EPIC',
      depth: 0,
      mayBeRoot: true,
      required: ['TITLE'],
      requiredOnTransition: ['TITLE', 'STATUS'],
      permitted: ['TITLE', 'SLUG', 'DESCRIPTION', 'STATUS'],
      legalStatuses: ['REFINING', 'IMPLEMENTATION'],
    },
    {
      archetype: 'TICKET',
      depth: 0,
      mayBeRoot: true,
      required: ['TITLE', 'STATUS', 'TICKET_TYPE', 'IMPETUS'],
      requiredOnTransition: ['TITLE', 'STATUS', 'TICKET_TYPE', 'IMPETUS'],
      permitted: [
        'TITLE',
        'SLUG',
        'DESCRIPTION',
        'STATUS',
        'TICKET_TYPE',
        'IMPETUS',
        'ASSIGNEE',
      ],
      legalStatuses: ['REPORTED', 'DONE'],
    },
    {
      archetype: 'FEATURE',
      depth: 1,
      mayBeRoot: false,
      required: ['TITLE'],
      requiredOnTransition: ['TITLE'],
      permitted: ['TITLE', 'SLUG', 'DESCRIPTION'],
      legalStatuses: [],
    },
  ],
};

const EPIC: EpicDto = {
  id: 'e1',
  projectId: 'p1',
  title: 'Merge the entities',
  slug: 'merge',
  description: null,
  number: 12,
  qualifiedId: 'qits-12',
  status: 'IMPLEMENTATION',
  supersededByEpicId: null,
  createdAt: AT,
  updatedAt: AT,
  workspaces: [],
};

const TICKET: TicketDto = {
  id: 't1',
  projectId: 'p1',
  title: 'The badge is the wrong colour',
  slug: 'badge',
  number: 41,
  qualifiedId: 'qits-41',
  type: 'BUG',
  status: 'REPORTED',
  assignee: null,
  createdBy: 'robin',
  impetus: 'It reads as success when a run is cancelled.',
  description: null,
  createdAt: AT,
  updatedAt: AT,
  workspaces: [],
};

describe('EntityTransitionPanel', () => {
  let fixture: ComponentFixture<EntityTransitionPanel>;
  let http: HttpTestingController;
  let done: number;

  beforeEach(() => {
    done = 0;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function mount(entityId = 't1'): Promise<void> {
    fixture = TestBed.createComponent(EntityTransitionPanel);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.componentRef.setInput('entityId', entityId);
    fixture.componentInstance.done.subscribe(() => (done += 1));
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  /** The registry, the epics, their features and the tickets — the panel's whole ground. */
  async function flushGround(): Promise<void> {
    http.expectOne('/projects/api/entities/archetypes').flush(REGISTRY);
    http.expectOne('/projects/api/projects/p1/epics').flush({ entries: [{ epic: EPIC }] });
    http.expectOne('/projects/api/projects/p1/tickets').flush({ entries: [{ ticket: TICKET }] });
    await settle();
    http.expectOne('/projects/api/epics/e1/features').flush({ entries: [] });
    await settle();
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function apply(): HTMLButtonElement {
    const found = Array.from(element().querySelectorAll('button')).find((node) =>
      node.textContent?.trim().startsWith('Apply'),
    );
    expect(found, 'no apply button').toBeTruthy();
    return found as HTMLButtonElement;
  }

  /**
   * Both archetypes, always: a ticket's legal parents live among the epics, so a filtered read would
   * make a reparent unexpressible.
   */
  it('reads the model and both archetypes of the project', async () => {
    await mount();
    await flushGround();

    expect(element().querySelector('app-entity-transition-form')).toBeTruthy();
    expect(element().textContent).toContain('The badge is the wrong colour');
  });

  it('shows one loading state for the whole ground, and one retry when it fails', async () => {
    await mount();
    http
      .expectOne('/projects/api/entities/archetypes')
      .flush({ message: 'no' }, { status: 503, statusText: 'Unavailable' });
    http.expectOne('/projects/api/projects/p1/epics').flush({ entries: [] });
    http.expectOne('/projects/api/projects/p1/tickets').flush({ entries: [] });
    await settle();

    expect(element().textContent).toContain('Could not load the entity model');
    expect(element().querySelector('app-entity-transition-form')).toBe(null);
  });

  it('posts the assembled map to the transition door and says done', async () => {
    await mount();
    await flushGround();
    apply().click();
    await settle();

    const request = http.expectOne('/projects/api/entities/transition');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      t1: {
        archetype: 'TICKET',
        membership: { parent: null },
        title: 'The badge is the wrong colour',
        status: 'REPORTED',
        ticketType: 'BUG',
        impetus: 'It reads as success when a run is cancelled.',
      },
    });

    request.flush({ t1: { id: 't1' } });
    await settle();

    expect(done).toBe(1);
  });

  /**
   * The raw sentence, not `describeError`'s `"<status> <message>"` — a status glued to the front of
   * the first fragment is the fragment that no longer matches a property label.
   */
  it('hands the refusal down as the service wrote it, and keeps the form up', async () => {
    await mount();
    await flushGround();
    apply().click();
    await settle();
    http
      .expectOne('/projects/api/entities/transition')
      .flush({ message: 'a TICKET requires impetus' }, { status: 400, statusText: 'Bad Request' });
    await settle();

    expect(element().querySelector('.field-failed')?.textContent?.trim()).toBe(
      'a TICKET requires impetus',
    );
    expect(done).toBe(0);
    expect(element().querySelector('app-entity-transition-form')).toBeTruthy();
  });

  it('falls back to a formatted sentence for a failure with no message body', async () => {
    await mount();
    await flushGround();
    apply().click();
    await settle();
    http
      .expectOne('/projects/api/entities/transition')
      .flush(null, { status: 503, statusText: 'Unavailable' });
    await settle();

    expect(element().querySelector('.failed')?.textContent).toContain('503');
    expect(done).toBe(0);
  });

  afterEach(() => http.verify());
});
