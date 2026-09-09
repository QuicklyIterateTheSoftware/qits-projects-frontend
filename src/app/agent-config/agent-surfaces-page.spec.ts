import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import type { AgentSurfaceConfigurationDto } from '../api/agent-configuration-api';

function surface(
  key: string,
  over: Partial<AgentSurfaceConfigurationDto> = {},
): AgentSurfaceConfigurationDto {
  return {
    surface: key,
    harness: 'CLAUDE',
    model: '',
    effort: '',
    remoteControl: false,
    permissionMode: 'SKIP_PERMISSIONS',
    activityTracking: true,
    systemPrompt: '',
    initialPrompt: '',
    mcpServers: [],
    externalMcpServers: [],
    shipped: true,
    ...over,
  };
}

/**
 * The list of surfaces.
 *
 * <p>The one thing worth pinning is the naming. `epic.chat` and `workspace.chat` are one word apart
 * and are two different tabs in two different routes; a reader about to change what an agent runs as
 * has to know which screen they are changing, and a title-cased key would tell them the opposite as
 * often as not.
 */
describe('AgentSurfacesPage', () => {
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

  function text(): string {
    return (harness.fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('names every surface for where it is, and keeps its key beside it', async () => {
    harness = await RouterTestingHarness.create('/agent-configuration');
    http.expectOne('/projects/api/agent-surfaces').flush({
      surfaces: [
        surface('project.epics'),
        surface('epic.chat'),
        surface('workspace.chat'),
        surface('ticket.dispatch'),
      ],
      builtInServers: ['repository', 'observability', 'actions'],
    });
    await settle();

    expect(text()).toContain('Refinement agent');
    expect(text()).toContain('Chat tab, refining an epic');
    expect(text()).toContain('Chat tab, on a workspace');
    // The two nobody presses a button for say so, or they cannot be found at all.
    expect(text()).toContain('Nobody presses a button for this one');
    // The key is still there: it is what a launch sends and what a log spells.
    expect(text()).toContain('epic.chat');
  });

  /** A ninth surface must be visible and configurable the day the service ships it. */
  it('renders a surface this build has no sentence for, under its key', async () => {
    harness = await RouterTestingHarness.create('/agent-configuration');
    http.expectOne('/projects/api/agent-surfaces').flush({
      surfaces: [surface('design.review')],
      builtInServers: [],
    });
    await settle();

    expect(text()).toContain('design.review');
    expect(text()).toContain('newer than this page');
  });

  it('says whose settings these are when the store refuses the reader', async () => {
    harness = await RouterTestingHarness.create('/agent-configuration');
    http.expectOne('/projects/api/agent-surfaces').flush(null, { status: 403, statusText: 'no' });
    await settle();

    expect(text()).toContain('administrator settings');
    expect(text()).toContain('qits:admin');
  });
});
