import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { EVENT_SOURCE_FACTORY, type EventSourceFactory } from '../api/event-source';

/**
 * A stream that never says anything. A finished create goes back to the project page, whose epics
 * overview opens a live channel — and jsdom has no `EventSource` at all.
 */
const SILENT: EventSourceFactory = () => ({
  onopen: null,
  onmessage: null,
  onerror: null,
  // Nothing to close: nothing was ever opened.
  close: () => undefined,
});

/**
 * The create form, and the one thing about it a server rule depends on: the body carries `name`
 * **or** `url`, never both and never one of them set to undefined beside the other.
 */
describe('CreateRepositoryPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EVENT_SOURCE_FACTORY, useValue: SILENT },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  /**
   * Open the form, and answer the shared project list — which is what turns the address's first
   * segment into the project **id** the create request is keyed on. The slug is `p1` here, so the
   * address needs no correcting and every URL in this spec stays the one that was asked for.
   */
  async function open(url = '/p1/repositories/new'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
    http.expectOne('/projects/api/projects').flush({
      entries: [{ project: { id: 'p1', name: 'Qits', slug: 'p1', description: null, dns: null } }],
    });
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  function pill(): string | null {
    return page().querySelector('.qits-picker-value')?.textContent?.trim() ?? null;
  }

  async function pick(label: string): Promise<void> {
    const row = Array.from(page().querySelectorAll<HTMLElement>('.qits-picker-option')).find(
      (option) => (option.textContent ?? '').includes(label),
    );
    expect(row, `no option reading "${label}"`).toBeTruthy();
    row?.click();
    await settle();
  }

  async function type(value: string): Promise<void> {
    const input = page().querySelector<HTMLInputElement>('input.text');
    expect(input).toBeTruthy();
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await settle();
  }

  /** The component field, which sits below the name or url and is optional in both modes. */
  async function typeComponent(value: string): Promise<void> {
    const input = page().querySelector<HTMLInputElement>('input.component');
    expect(input).toBeTruthy();
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await settle();
  }

  async function press(label: string): Promise<void> {
    const target = Array.from(page().querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes(label),
    );
    expect(target, `no button reading "${label}"`).toBeTruthy();
    target?.click();
    await settle();
  }

  function submitButton(): HTMLButtonElement | undefined {
    return Array.from(page().querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes('Add it to the project'),
    );
  }

  it('seeds the type from ?type= and shows where the submodule will land', async () => {
    await open('/p1/repositories/new?type=DAEMON');

    expect(pill()).toContain('daemon');
    await type('qits-watcher');
    expect(text()).toContain('daemons/qits-watcher');
  });

  /** A prefill is not an address: an unrecognised value seeds nothing rather than inventing a type. */
  it('leaves the picker open for a ?type= it does not recognise', async () => {
    await open('/p1/repositories/new?type=WIDGET');

    expect(pill()).toBeNull();
    expect(page().querySelectorAll('.qits-picker-option')).toHaveLength(6);
  });

  it('sends a name and no url in the blank mode, then goes back to the project', async () => {
    await open('/p1/repositories/new?type=SERVICE');
    await type('qits-widgets');

    await press('Add it to the project');
    const request = http.expectOne('/projects/api/projects/p1/repositories');
    expect(request.request.body).toEqual({ name: 'qits-widgets', archetype: 'SERVICE' });

    request.flush({
      repository: {
        id: 'r2',
        name: 'qits-widgets',
        backupUrl: null,
        mainBranch: 'main',
        archetype: 'SERVICE',
        projectId: 'p1',
      },
      projectId: 'p1',
      wrapperPath: 'services/qits-widgets',
    });
    await settle();

    expect(router.url).toBe('/p1');
    // The project hub took over, and it reads nothing: the project list is already read — one
    // flight per application instance — and the hub is a name and a card per way in. The component
    // rows live behind project-setup, and the epics behind the segment of their own.
    await settle();
    http.verify();
  });

  it('sends a url and no name in the attach mode', async () => {
    await open('/p1/repositories/new?type=LIBRARY');
    await press('Attach an existing one');
    await type('https://github.com/QuicklyIterate/qits-widgets.git');

    // The path preview follows the url's basename, which is the name the server will register.
    expect(text()).toContain('libs/qits-widgets');

    await press('Add it to the project');
    const request = http.expectOne('/projects/api/projects/p1/repositories');
    expect(request.request.body).toEqual({
      url: 'https://github.com/QuicklyIterate/qits-widgets.git',
      archetype: 'LIBRARY',
    });

    request.flush({
      repository: {
        id: 'r3',
        name: 'qits-widgets',
        backupUrl: 'https://github.com/QuicklyIterate/qits-widgets.git',
        mainBranch: 'main',
        archetype: 'LIBRARY',
        projectId: 'p1',
      },
      projectId: 'p1',
      wrapperPath: 'libs/qits-widgets',
    });
    await settle();

    expect(router.url).toBe('/p1');
    // The project list is already read — one flight per application instance — and the hub it
    // landed on adds no read of its own.
    await settle();
    http.verify();
  });

  /**
   * A stated component decides the destination outright, whatever the type says — which is what
   * makes this field the way a project in the archetype layout starts its flip.
   */
  it('previews the component layout as soon as a component is named', async () => {
    await open('/p1/repositories/new?type=SERVICE');
    await type('qits-widgets-service');
    expect(text()).toContain('services/qits-widgets-service');

    await typeComponent('qits-widgets');
    expect(text()).toContain('components/qits-widgets/qits-widgets-service');
  });

  it('puts the component on the body only when one is named', async () => {
    await open('/p1/repositories/new?type=SERVICE');
    await type('qits-widgets-service');
    await typeComponent('qits-widgets');

    await press('Add it to the project');
    const request = http.expectOne('/projects/api/projects/p1/repositories');
    expect(request.request.body).toEqual({
      name: 'qits-widgets-service',
      archetype: 'SERVICE',
      component: 'qits-widgets',
    });

    request.flush({
      repository: {
        id: 'r4',
        name: 'qits-widgets-service',
        backupUrl: null,
        mainBranch: 'main',
        archetype: 'SERVICE',
        component: 'qits-widgets',
        projectId: 'p1',
      },
      projectId: 'p1',
      wrapperPath: 'components/qits-widgets/qits-widgets-service',
    });
    await settle();

    expect(router.url).toBe('/p1');
    await settle();
    http.verify();
  });

  /** A component is a wrapper directory, so it is held to the same rule the name is. */
  it('says so before asking when the component cannot be a wrapper directory', async () => {
    await open('/p1/repositories/new?type=SERVICE');
    await type('qits-widgets-service');
    await typeComponent('components');

    expect(text()).toContain('That component cannot be a wrapper directory.');
    expect(submitButton()?.disabled).toBe(true);
    http.verify();
  });

  it('will not submit without a type', async () => {
    await open();
    await type('qits-widgets');

    expect(submitButton()?.disabled).toBe(true);

    await pick('service');
    expect(submitButton()?.disabled).toBe(false);
    http.verify();
  });

  it('says so before asking when the name cannot be a git-host repository', async () => {
    await open('/p1/repositories/new?type=SERVICE');
    await type('libs/qits-widgets');

    expect(text()).toContain('That name cannot be a git-host repository.');
    expect(submitButton()?.disabled).toBe(true);
    http.verify();
  });

  it('keeps the form and reports the failure when the server refuses', async () => {
    await open('/p1/repositories/new?type=SERVICE');
    await type('qits-widgets');

    await press('Add it to the project');
    http
      .expectOne('/projects/api/projects/p1/repositories')
      .flush({ message: 'name already registered' }, { status: 409, statusText: 'Conflict' });
    await settle();

    expect(text()).toContain('Could not add it — 409 name already registered');
    expect(router.url).toContain('/p1/repositories/new');
  });
});
