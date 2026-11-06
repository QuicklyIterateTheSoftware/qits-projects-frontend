import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ArchetypeRegistry } from '../api/archetypes-api';
import type { EpicDto, FeatureDto, TicketDto } from '../api/dto';
import { workAnswer, type WorkFixture } from '../../testing/work-fixtures';
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
      legalStatuses: ['REPORTED', 'REFINED'],
    },
    {
      archetype: 'TICKET',
      depth: 0,
      mayBeRoot: true,
      required: ['TITLE', 'STATUS', 'TICKET_TYPE', 'IMPETUS'],
      requiredOnTransition: ['TITLE', 'STATUS', 'TICKET_TYPE', 'IMPETUS'],
      permitted: ['TITLE', 'SLUG', 'DESCRIPTION', 'STATUS', 'TICKET_TYPE', 'IMPETUS', 'ASSIGNEE'],
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
  status: 'REFINED',
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

const FEATURE: FeatureDto = {
  id: 'f1',
  epicId: 'e1',
  projectId: 'p1',
  title: 'Read the merged row',
  slug: 'read',
  description: 'What the feature does, in a paragraph.',
  number: 13,
  qualifiedId: 'qits-13',
  needs: [],
  unmetNeeds: 0,
  implementedOn: null,
  createdAt: AT,
  updatedAt: AT,
};

/** The project: the epic with its feature, and the ticket — whose stored body the listing omits. */
const WORK: WorkFixture = {
  epics: [{ epic: EPIC, features: [{ feature: FEATURE }] }],
  tickets: [{ ...TICKET, description: 'Make it read as cancelled.' }],
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

  /**
   * The registry and the project's work, read the `/work` way — the panel's whole ground: the
   * listing's summary, and the whole read of the row the press came from. Answers every `/work`
   * read in `rounds` rounds, and says which were made.
   */
  async function flushGround(rounds = 3): Promise<string[]> {
    const urls: string[] = [];
    for (const request of http.match('/projects/api/work/archetypes')) {
      request.flush(REGISTRY);
    }
    for (let round = 0; round < rounds; round += 1) {
      for (const request of http.match((candidate) => candidate.method === 'GET')) {
        urls.push(request.request.url);
        request.flush(workAnswer('p1', WORK, request.request.url) as object);
      }
      await settle();
    }
    return urls;
  }

  /** Bring another row into the selection through the form's own picker. */
  async function addRow(id: string): Promise<void> {
    const picker = element().querySelector<HTMLSelectElement>(
      'select[aria-labelledby="reshape-add"]',
    );
    expect(picker, 'no add picker').toBeTruthy();
    picker!.value = id;
    picker!.dispatchEvent(new Event('change'));
    await settle();
    const add = Array.from(element().querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === 'Add',
    );
    add!.click();
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
      .expectOne('/projects/api/work/archetypes')
      .flush({ message: 'no' }, { status: 503, statusText: 'Unavailable' });
    http.expectOne('/projects/api/projects/p1/work').flush({ entities: [] });
    http.expectOne('/projects/api/projects/p1/work/workspaces').flush({ workspaces: [] });
    await settle();

    expect(element().textContent).toContain('Could not load the entity model');
    expect(element().querySelector('app-entity-transition-form')).toBe(null);
  });

  it('posts the assembled map to the transition door and says done', async () => {
    await mount();
    await flushGround();
    apply().click();
    await settle();

    const request = http.expectOne('/projects/api/work/transition');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      t1: {
        archetype: 'TICKET',
        membership: { parent: null },
        title: 'The badge is the wrong colour',
        // The listing carries no description: this one is the whole read's (qits-1815).
        description: 'Make it read as cancelled.',
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
      .expectOne('/projects/api/work/transition')
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
      .expectOne('/projects/api/work/transition')
      .flush(null, { status: 503, statusText: 'Unavailable' });
    await settle();

    expect(element().querySelector('.failed')?.textContent).toContain('503');
    expect(done).toBe(0);
  });

  /**
   * qits-1815: the door is PUT per entry, and the pool is the listing's summary — so the row the
   * press came from is read whole before the form is drawn, and nothing else is read per root.
   */
  it('reads the row the press came from whole, and only that one', async () => {
    await mount();
    const urls = await flushGround();

    expect([...urls].sort()).toEqual(
      [
        '/projects/api/projects/p1/work',
        '/projects/api/projects/p1/work/workspaces',
        '/projects/api/work/qits-41',
      ].sort(),
    );
    expect(
      element().querySelector<HTMLInputElement>('input[aria-labelledby="t1-DESCRIPTION"]')?.value,
    ).toBe('Make it read as cancelled.');
  });

  /**
   * Another row joins the selection as a summary: it is drawn being read, with nothing to change and
   * the press disabled, until its whole read — a feature's, out of its epic's children — lands.
   */
  it('reads every other restated row whole before it can be sent, a feature from its parent', async () => {
    await mount();
    await flushGround();
    await addRow('f1');

    expect(element().textContent).toContain('Reading its description and criteria');
    expect(element().querySelector('input[aria-labelledby="f1-TITLE"]')).toBeNull();
    expect(apply().disabled).toBe(true);

    const children = http.expectOne('/projects/api/work/qits-12/children');
    children.flush(workAnswer('p1', WORK, children.request.url) as object);
    await settle();

    expect(element().textContent).not.toContain('Reading its description and criteria');
    expect(apply().disabled).toBe(false);
    apply().click();
    await settle();

    const request = http.expectOne('/projects/api/work/transition');
    expect(request.request.body['f1']).toEqual({
      archetype: 'FEATURE',
      membership: { parent: 'e1' },
      title: 'Read the merged row',
      description: 'What the feature does, in a paragraph.',
    });
    expect(request.request.body['t1'].description).toBe('Make it read as cancelled.');
    request.flush({});
    await settle();
  });

  /** A whole read that fails leaves the row unsendable and says so — it never falls back. */
  it('keeps a row whose whole read failed unsendable, and says why', async () => {
    await mount();
    await flushGround();
    await addRow('e1');
    http
      .expectOne('/projects/api/work/qits-12')
      .flush({ message: 'gone' }, { status: 503, statusText: 'Unavailable' });
    await settle();

    expect(element().textContent).toContain('Could not read qits-12');
    expect(apply().disabled).toBe(true);
    http.expectNone('/projects/api/work/transition');
  });

  /** The last check, at the one place every write passes: a summary is never sent. */
  it('refuses, without sending, a request that names a row not read whole', async () => {
    await mount();
    await flushGround();
    const panel = fixture.componentInstance as unknown as {
      apply(request: ReadonlyMap<string, unknown>): Promise<void>;
    };
    await panel.apply(new Map([['e1', { archetype: 'EPIC', membership: { parent: null } }]]));
    await settle();

    http.expectNone('/projects/api/work/transition');
    expect(element().textContent).toContain('has not been read in full yet');
    expect(done).toBe(0);
  });

  afterEach(() => http.verify());
});
