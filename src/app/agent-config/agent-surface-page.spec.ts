import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import type {
  AgentSurfaceConfigurationDto,
  SurfaceListResponse,
} from '../api/agent-configuration-api';

function configuration(
  over: Partial<AgentSurfaceConfigurationDto> = {},
): AgentSurfaceConfigurationDto {
  return {
    surface: 'project.tickets',
    harness: 'CLAUDE',
    model: '',
    effort: '',
    remoteControl: false,
    permissionMode: 'SKIP_PERMISSIONS',
    activityTracking: true,
    systemPrompt: 'Triage the tickets.',
    initialPrompt: '',
    mcpServers: [
      {
        server: 'repository',
        narrowProject: true,
        narrowRepository: false,
        narrowWorkspace: false,
        readOnly: false,
        allowedTools: ['list_epics', 'get_epic'],
      },
    ],
    externalMcpServers: [],
    shipped: true,
    ...over,
  };
}

function list(over: Partial<AgentSurfaceConfigurationDto> = {}): SurfaceListResponse {
  return {
    surfaces: [configuration(over)],
    builtInServers: ['repository', 'observability', 'actions'],
  };
}

const CLAUDE = {
  harness: 'CLAUDE',
  imageVersion: '2026.909.1',
  harnessVersion: 'claude 2.1.0',
  models: ['opus', 'sonnet'],
  modelsEnumerated: false,
  effortSupported: true,
  effortLevels: ['low', 'high'],
  authenticated: true,
  authDetail: '',
  probeFailed: false,
  probeDetail: '',
  reportedBy: 'daemon',
  reportedAt: '2026-09-09T10:00:00Z',
  shipped: false,
  otherImageVersions: [],
};

const KIMI = { ...CLAUDE, harness: 'KIMI', effortSupported: false, effortLevels: [] };

/**
 * One surface, edited.
 *
 * <p>What is worth asserting here is not that a form saves. It is the three places this page could
 * quietly lie: showing an effort control for a harness that has none, refusing a model the harness
 * never enumerated, and letting somebody move permissions off skip without saying what that does.
 * Each of those is invisible until it costs somebody a run.
 */
describe('AgentSurfacePage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  async function open(
    answer: SurfaceListResponse = list(),
    capabilities: object = { harnesses: [CLAUDE, KIMI] },
  ): Promise<void> {
    harness = await RouterTestingHarness.create('/agent-configuration/surfaces/project.tickets');
    http.expectOne('/projects/api/agent-surfaces').flush(answer);
    http.expectOne('/projects/api/agent-capabilities').flush(capabilities);
    http.expectOne('/projects/api/agent-mcp-catalog').flush({
      entries: [],
      reservedKeys: ['repository', 'observability', 'actions'],
      credentialApplication: 'qits-agent-mcp',
    });
    await settle();
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  function field<T extends HTMLElement>(selector: string): T {
    const found = page().querySelector<T>(selector);
    expect(found, `no element at “${selector}”`).toBeTruthy();
    return found as T;
  }

  async function choose(selector: string, value: string): Promise<void> {
    const control = field<HTMLSelectElement | HTMLInputElement>(selector);
    control.value = value;
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input'));
    await settle();
  }

  it('names the surface for where it is, and keeps the key beside it', async () => {
    await open();
    expect(page().querySelector('h1')?.textContent).toContain('Triage agent');
    expect(text()).toContain('project.tickets');
    expect(text()).toContain('tickets board');
  });

  /**
   * A model control that only accepted what was reported would refuse the one thing this page is
   * for. Claude Code has no command that lists models, so the list is a shipped alias set and the
   * free-text value is the point — which is why this is an `<input list>` and not a `<select>`.
   */
  it('takes a model the harness never enumerated, and says why it can', async () => {
    await open();

    const model = field<HTMLInputElement>('input[list="agent-model-options"]');
    expect(model.tagName).toBe('INPUT');
    expect(text()).toContain('cannot list its models');

    await choose('input[list="agent-model-options"]', 'claude-opus-5-20260501');
    field<HTMLElement>('.actions').querySelector('button')?.click();
    await settle();

    const save = http.expectOne('/projects/api/agent-surfaces/project.tickets');
    expect(save.request.method).toBe('PUT');
    expect(save.request.body.model).toBe('claude-opus-5-20260501');
  });

  /**
   * No effort control at all for a harness that has no effort concept — not a disabled one carrying
   * Claude's values — and the value it was holding is cleared rather than left invisible in the row.
   */
  it('shows no effort control for Kimi, and stores no effort for it', async () => {
    await open(list({ effort: 'high' }));

    expect(page().querySelectorAll('select').length).toBeGreaterThan(0);
    expect(text()).toContain('Effort');

    await choose('select', 'KIMI');
    expect(text()).not.toContain('Effort');
    expect(text()).toContain('has no effort setting');

    field<HTMLElement>('.actions').querySelector('button')?.click();
    await settle();

    const save = http.expectOne('/projects/api/agent-surfaces/project.tickets');
    expect(save.request.body.harness).toBe('KIMI');
    expect(save.request.body.effort).toBe('');
  });

  /**
   * Every session on this platform has run auto-approved since there were sessions, so "PROMPT" is a
   * word whose consequence is not guessable. It is said on the change, in place.
   */
  it('says plainly what moving off skip-permissions does', async () => {
    await open();
    expect(text()).not.toContain('The agent will start asking');

    const selects = page().querySelectorAll('select');
    const permission = Array.from(selects).find((select) =>
      Array.from(select.options).some((option) => option.value === 'PROMPT'),
    );
    expect(permission).toBeTruthy();
    permission!.value = 'PROMPT';
    permission!.dispatchEvent(new Event('change'));
    await settle();

    expect(text()).toContain('The agent will start asking');
  });

  /** Remote control is on every surface — the owner's rule, and this one is a chat surface. */
  it('offers remote control here as everywhere else', async () => {
    await open(list({ surface: 'project.tickets' }));
    expect(text()).toContain('Enable remote control');
  });

  /** The names an initial prompt may use, shown as they must be typed. */
  it('lists the template placeholders beside the initial prompt', async () => {
    await open();
    expect(text()).toContain('{{epic}}');
    expect(text()).toContain('{{ticket}}');
    expect(text()).toContain('left exactly as written');
  });

  /**
   * The staleness rule is deliberately unsaid: an edit applies to the next container, and there is
   * no badge, flag or warning about it anywhere on this page.
   */
  it('says nothing about when an edit takes effect', async () => {
    await open();
    expect(text().toLowerCase()).not.toContain('recreate');
    expect(text().toLowerCase()).not.toContain('pending');
    expect(text().toLowerCase()).not.toContain('takes effect');
  });

  it('says whose settings these are when the store refuses the reader', async () => {
    harness = await RouterTestingHarness.create('/agent-configuration/surfaces/project.tickets');
    http.expectOne('/projects/api/agent-surfaces').flush(null, { status: 403, statusText: 'no' });
    http
      .expectOne('/projects/api/agent-capabilities')
      .flush(null, { status: 403, statusText: 'no' });
    http
      .expectOne('/projects/api/agent-mcp-catalog')
      .flush(null, { status: 403, statusText: 'no' });
    await settle();

    expect(text()).toContain('administrator settings');
    expect(text()).toContain('qits:admin');
  });
});
