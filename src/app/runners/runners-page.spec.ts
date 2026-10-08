import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DeskRunnerDto, RunnerRegistrationDto } from '../api/runners-api';
import { VIEWER_ADMIN } from '../ui/viewer';
import { RunnersPage } from './runners-page';

const RUNNERS_URL = '/projects/api/runners';

const runner = (over: Partial<DeskRunnerDto> = {}): DeskRunnerDto => ({
  id: 'r-1',
  name: 'node-a',
  description: null,
  slots: 2,
  version: '2026.1003.1',
  registered: true,
  quarantined: false,
  quarantinedAt: null,
  quarantineReason: null,
  lastSeenAt: '2026-10-05T09:00:00Z',
  lastHealthCheckAt: null,
  lastHealthCheckOk: null,
  connected: true,
  connectedSince: '2026-10-05T08:00:00Z',
  pinnedVersion: '2026.1003.1',
  loginState: 'PRESENT',
  loginCommand: 'docker run --rm -it -v dot-claude:/root/.claude qits/claude login',
  desks: [{ projectId: 'p1', slug: 'qits', state: 'RUNNING' }],
  ...over,
});

/**
 * The front-desk runners page: what it lists, what it shows exactly once, and what it keeps from a
 * viewer who cannot press it.
 *
 * **The install line is the one thing the page must not keep.** Its token is single-use and the
 * service never answers it again, so a create shows it in a panel, closing the panel drops it, and
 * nothing re-reads it — the list after a create carries no trace of it.
 *
 * **A refused delete names the desks.** The 409 `RUNNER_OWNS_DESKS` says only that desks remain;
 * the runner's own row already lists which, so the refusal repeats that list.
 */
describe('RunnersPage', () => {
  let http: HttpTestingController;

  const configure = (admin = true) => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: VIEWER_ADMIN, useValue: admin },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  };

  afterEach(() => http.verify());

  const settle = async (fixture: ComponentFixture<RunnersPage>): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const open = async (
    runners: readonly DeskRunnerDto[],
  ): Promise<ComponentFixture<RunnersPage>> => {
    const fixture = TestBed.createComponent(RunnersPage);
    await settle(fixture);
    http.expectOne(RUNNERS_URL).flush(runners);
    await settle(fixture);
    return fixture;
  };

  const element = (fixture: ComponentFixture<RunnersPage>): HTMLElement =>
    fixture.nativeElement as HTMLElement;

  const text = (fixture: ComponentFixture<RunnersPage>): string =>
    element(fixture).textContent ?? '';

  const button = (fixture: ComponentFixture<RunnersPage>, label: string): HTMLButtonElement => {
    const found = Array.from(element(fixture).querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!found) {
      throw new Error(`no button labelled "${label}"`);
    }
    return found;
  };

  const type = (fixture: ComponentFixture<RunnersPage>, name: string, value: string): void => {
    const input = element(fixture).querySelector(`input[name="${name}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  describe('as an admin', () => {
    beforeEach(() => configure(true));

    it('lists what a runner is doing: connection, version against the pin, slots and desks', async () => {
      const fixture = await open([runner()]);

      expect(text(fixture)).toContain('node-a');
      expect(text(fixture)).toContain('connected');
      expect(text(fixture)).toContain('v2026.1003.1');
      expect(text(fixture)).toContain('at the pin');
      expect(text(fixture)).toContain('1/2 slots');
      const desks = element(fixture).querySelector('.desks')!;
      expect(desks.querySelector('a')?.getAttribute('href')).toBe('/qits');
      expect(desks.textContent).toContain('RUNNING');
      // No workspace-only columns on a front-desk runner.
      expect(text(fixture)).not.toContain('memory');
    });

    it('reads a missing registry (404) as no runners rather than a failure', async () => {
      const fixture = TestBed.createComponent(RunnersPage);
      await settle(fixture);
      http.expectOne(RUNNERS_URL).flush(null, { status: 404, statusText: 'Not Found' });
      await settle(fixture);

      expect(text(fixture)).toContain('No runners are registered yet.');
      expect(text(fixture)).not.toContain('Could not load runners');
    });

    it('renders a runner the server describes with only id, name and slots', async () => {
      const fixture = await open([{ id: 'r-9', name: 'bare', slots: 1 }]);

      expect(text(fixture)).toContain('bare');
      expect(text(fixture)).toContain('0/1 slots');
      expect(text(fixture)).toContain('not reported');
    });

    it('greenlights a quarantined runner', async () => {
      const fixture = await open([runner({ quarantined: true })]);

      button(fixture, 'Actions').click();
      await settle(fixture);
      button(fixture, 'Greenlight').click();
      await settle(fixture);

      const greenlight = http.expectOne(`${RUNNERS_URL}/r-1/greenlight`);
      expect(greenlight.request.method).toBe('POST');
      greenlight.flush(runner());
      await settle(fixture);
      http.expectOne(RUNNERS_URL).flush([runner()]);
      await settle(fixture);
      expect(text(fixture)).not.toContain('quarantined');
    });

    it('rotates the registration token and shows the new install line once', async () => {
      const fixture = await open([runner({ registered: false, connected: false })]);

      button(fixture, 'Actions').click();
      await settle(fixture);
      button(fixture, 'Rotate token').click();
      await settle(fixture);

      const rotate = http.expectOne(`${RUNNERS_URL}/r-1/registration-token`);
      expect(rotate.request.method).toBe('POST');
      rotate.flush({
        runner: runner(),
        registrationToken: 'tok-new',
        installLine: 'curl … tok-new',
      });
      await settle(fixture);
      http.expectOne(RUNNERS_URL).flush([runner()]);
      await settle(fixture);

      expect(element(fixture).querySelector('.install-line')?.textContent).toContain('tok-new');
    });

    it('says a connected runner off the pinned version is updating', async () => {
      const fixture = await open([
        runner({ name: 'behind', version: '2026.1001.1' }),
        runner({ id: 'r-2', name: 'current' }),
        runner({ id: 'r-3', name: 'offline', version: '2026.1001.1', connected: false }),
      ]);

      const row = (name: string) => element(fixture).querySelector(`[data-runner="${name}"]`)!;
      expect(row('behind').querySelector('.updating')?.textContent).toContain('updating');
      expect(row('current').querySelector('.updating')).toBeNull();
      // An offline runner is not rolling over to anything; it is offline.
      expect(row('offline').querySelector('.updating')).toBeNull();
      expect(row('offline').textContent).toContain('offline');
    });

    it('draws a quarantined runner with its reason', async () => {
      const fixture = await open([
        runner({
          quarantined: true,
          quarantinedAt: '2026-10-05T09:00:00Z',
          quarantineReason: 'image pull failed',
        }),
      ]);

      expect(text(fixture)).toContain('quarantined');
      expect(text(fixture)).toContain('image pull failed');
    });

    it('shows the install line once after a create, and never again', async () => {
      const fixture = await open([]);

      type(fixture, 'name', 'node-b');
      type(fixture, 'description', 'the CI VM');
      type(fixture, 'slots', '3');
      element(fixture)
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await settle(fixture);

      const create = http.expectOne(
        (request) => request.method === 'POST' && request.url === RUNNERS_URL,
      );
      expect(create.request.body).toEqual({ name: 'node-b', description: 'the CI VM', slots: 3 });
      const registration: RunnerRegistrationDto = {
        runner: runner({ id: 'r-b', name: 'node-b', registered: false, connected: false }),
        registrationToken: 'tok-123',
        installLine: 'curl -fsSL https://projects.example/install.sh | sh -s tok-123',
      };
      create.flush(registration, { status: 201, statusText: 'Created' });
      await settle(fixture);
      http
        .expectOne((request) => request.method === 'GET' && request.url === RUNNERS_URL)
        .flush([registration.runner]);
      await settle(fixture);

      const panel = element(fixture).querySelector('.panel')!;
      expect(panel.querySelector('.install-line')?.textContent).toContain(
        'install.sh | sh -s tok-123',
      );
      expect(panel.querySelector('.token')?.textContent).toContain('tok-123');
      expect(panel.textContent).toContain('reloading this page loses it');

      button(fixture, 'Close').click();
      await settle(fixture);

      expect(element(fixture).querySelector('.panel')).toBeNull();
      // The list the create re-read carries the runner and nothing of its token.
      expect(text(fixture)).toContain('node-b');
      expect(text(fixture)).not.toContain('tok-123');
    });

    it('surfaces a 409 RUNNER_OWNS_DESKS on delete, naming the desks the runner holds', async () => {
      const fixture = await open([runner()]);

      button(fixture, 'Actions').click();
      await settle(fixture);
      button(fixture, 'Delete').click();
      await settle(fixture);
      button(fixture, 'Yes, delete it').click();
      await settle(fixture);

      const remove = http.expectOne(`${RUNNERS_URL}/r-1`);
      expect(remove.request.method).toBe('DELETE');
      remove.flush({ error: 'RUNNER_OWNS_DESKS' }, { status: 409, statusText: 'Conflict' });
      await settle(fixture);

      const owners = element(fixture).querySelector('.owners')!;
      expect(owners.textContent).toContain('RUNNER_OWNS_DESKS');
      expect(owners.textContent).toContain('qits (RUNNING)');
    });

    it('deletes a runner that holds no desks', async () => {
      const fixture = await open([runner({ desks: [] })]);

      button(fixture, 'Actions').click();
      await settle(fixture);
      button(fixture, 'Delete').click();
      await settle(fixture);
      button(fixture, 'Yes, delete it').click();
      await settle(fixture);

      http.expectOne(`${RUNNERS_URL}/r-1`).flush(null, { status: 204, statusText: 'No Content' });
      await settle(fixture);
      http.expectOne(RUNNERS_URL).flush([]);
      await settle(fixture);
      expect(text(fixture)).toContain('No runners are registered yet.');
    });

    it.each([
      ['PRESENT', 'logged in'],
      ['ABSENT', 'not logged in'],
    ] as const)('draws a %s login as "%s", with the command to log in', async (state, label) => {
      const fixture = await open([runner({ loginState: state })]);

      const login = element(fixture).querySelector('.login')!;
      expect(login.querySelector('.presence-claude')?.textContent?.trim()).toBe(label);
      expect(login.querySelector('.login-command')?.textContent).toContain('qits/claude login');
    });

    it('waits for the node volume before offering a login command', async () => {
      const fixture = await open([runner({ loginState: null, loginCommand: null })]);

      const login = element(fixture).querySelector('.login')!;
      expect(login.textContent).toContain('not reported');
      expect(login.querySelector('.login-command')).toBeNull();
      expect(login.textContent).toContain('appears once the runner has reported its node volume');
    });

    it('asks the runner to re-check its login', async () => {
      const fixture = await open([runner()]);

      button(fixture, 'Re-check').click();
      await settle(fixture);

      const check = http.expectOne(`${RUNNERS_URL}/r-1/login-check`);
      expect(check.request.method).toBe('POST');
      check.flush(null, { status: 202, statusText: 'Accepted' });
      await settle(fixture);
    });

    it("renders the last health check's per-check list, highlighting a failing one", async () => {
      const fixture = await open([
        runner({
          health: {
            at: '2026-10-05T10:00:00Z',
            ok: false,
            detail: 'one check failed',
            checks: [
              { name: 'dockerPing', ok: true, detail: 'docker responded' },
              { name: 'nodeInventory', ok: false, detail: 'image pull failed' },
            ],
          },
        }),
      ]);

      const health = element(fixture).querySelector('.health')!;
      expect(health.textContent).toContain('health check failed');
      const checks = Array.from(health.querySelectorAll('.check'));
      expect(checks).toHaveLength(2);

      const passing = checks.find((row) => row.textContent?.includes('dockerPing'))!;
      expect(passing.classList.contains('check-failed')).toBe(false);
      expect(passing.textContent).toContain('passed');

      const failing = checks.find((row) => row.textContent?.includes('nodeInventory'))!;
      expect(failing.classList.contains('check-failed')).toBe(true);
      expect(failing.textContent).toContain('failed');
      expect(failing.textContent).toContain('image pull failed');
    });

    it('renders the plain health badge as before when the server sends no `health`', async () => {
      const fixture = await open([
        runner({
          health: undefined,
          lastHealthCheckAt: '2026-10-05T09:30:00Z',
          lastHealthCheckOk: true,
        }),
      ]);

      const health = element(fixture).querySelector('.health')!;
      expect(health.textContent).toContain('health check passed');
      expect(health.querySelectorAll('.check')).toHaveLength(0);
    });

    it('runs an on-demand health check, and shows the 409 reason when the runner is unavailable', async () => {
      const fixture = await open([runner()]);

      button(fixture, 'Run health check').click();
      await settle(fixture);

      const check = http.expectOne(`${RUNNERS_URL}/r-1/healthcheck`);
      expect(check.request.method).toBe('POST');
      check.flush(
        {
          message: 'RUNNER_UNAVAILABLE: runner node-a is not connected',
          code: 'RUNNER_UNAVAILABLE',
        },
        { status: 409, statusText: 'Conflict' },
      );
      await settle(fixture);

      const health = element(fixture).querySelector('.health')!;
      expect(health.textContent).toContain('This runner is not connected right now.');
    });

    it("loads and renders a runner's node details on request", async () => {
      const fixture = await open([runner()]);

      button(fixture, 'Node details').click();
      await settle(fixture);

      const detail = http.expectOne(`${RUNNERS_URL}/r-1/health`);
      expect(detail.request.method).toBe('GET');
      detail.flush({
        at: '2026-10-05T10:00:00Z',
        ok: true,
        detail: 'all checks passed',
        requestId: 'req-1',
        checks: [
          {
            name: 'nodeInventory',
            ok: true,
            detail: 'inventory read',
            data: {
              containers: [
                {
                  name: 'qits-projects-desk-runner-desk-p1-abcd1234',
                  id: 'c1',
                  rowId: 'p1',
                  state: 'running',
                  startedAt: '2026-10-05T09:00:00Z',
                  finishedAt: null,
                  exitCode: null,
                  image: 'qits/project-agent:2026.1003.1',
                },
              ],
              volumes: [
                { name: 'qits_project_p1', rowId: 'p1', createdAt: '2026-10-04T09:00:00Z' },
              ],
              runnerContainer: {
                name: 'qits-projects-desk-runner',
                id: 'rc1',
                version: '2026.1003.1',
                startedAt: '2026-10-05T08:00:00Z',
              },
            },
          },
          { name: 'diskSpace', ok: true, detail: 'plenty free', data: { freeBytes: 123456 } },
        ],
      });
      await settle(fixture);

      const nodeDetails = element(fixture).querySelector('.node-details')!;
      expect(nodeDetails.textContent).toContain('qits-projects-desk-runner-desk-p1-abcd1234');
      expect(nodeDetails.textContent).toContain('qits/project-agent:2026.1003.1');
      expect(nodeDetails.textContent).toContain('qits_project_p1');
      expect(nodeDetails.textContent).toContain('qits-projects-desk-runner');
      expect(nodeDetails.textContent).toContain('diskSpace');
      expect(nodeDetails.textContent).toContain('freeBytes');
      expect(nodeDetails.textContent).toContain('123456');
    });
  });

  describe('as a viewer who is not an admin', () => {
    beforeEach(() => configure(false));

    it('reads the list but draws none of the admin-only controls', async () => {
      const fixture = await open([runner({ quarantined: true })]);

      expect(text(fixture)).toContain('node-a');
      expect(text(fixture)).toContain('logged in');
      // The commands are reads: anyone can copy the line an operator would run.
      expect(element(fixture).querySelector('.login-command')).not.toBeNull();
      expect(element(fixture).querySelector('form')).toBeNull();
      expect(element(fixture).querySelector('.menu-toggle')).toBeNull();
      expect(text(fixture)).not.toContain('Re-check');
      expect(text(fixture)).not.toContain('Register a runner');
    });
  });
});
