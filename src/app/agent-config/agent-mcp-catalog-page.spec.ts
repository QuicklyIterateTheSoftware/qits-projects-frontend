import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';

const CATALOG = {
  entries: [
    {
      key: 'sentry',
      displayName: 'Sentry',
      url: 'https://sentry.example/mcp',
      headerName: 'Authorization',
      credentialKey: 'env.SENTRY_MCP_TOKEN',
      allowedTools: ['list_issues'],
      attachedBy: ['epic.agent'],
    },
  ],
  reservedKeys: ['repository', 'observability', 'actions'],
  credentialApplication: 'qits-agent-mcp',
};

/**
 * The external MCP catalog.
 *
 * <p>Two sentences on this page are load-bearing rather than decorative, and both are asserted here.
 * The first is why a reserved key is refused: an entry taking one of the platform's own names would
 * *displace* a platform server rather than collide with it, and the session would look entirely
 * normal while talking to somebody else's server — a bare "already in use" would hide exactly the
 * dangerous half. The second is that the credential is a **reference**: the value lives in
 * qits-configuration, which is what lets it become a secret later without this page changing.
 */
describe('AgentMcpCatalogPage', () => {
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

  async function open(): Promise<void> {
    harness = await RouterTestingHarness.create('/agent-configuration/mcp-catalog');
    http.expectOne('/projects/api/agent-mcp-catalog').flush(CATALOG);
    await settle();
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  function fieldNamed(label: string): HTMLInputElement {
    const found = Array.from(page().querySelectorAll('label.field')).find((node) =>
      (node.querySelector('.label')?.textContent ?? '').trim().startsWith(label),
    );
    expect(found, `no field named “${label}”`).toBeTruthy();
    return found!.querySelector('input') as HTMLInputElement;
  }

  async function type(label: string, value: string): Promise<void> {
    const input = fieldNamed(label);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  it('lists an entry by key, with its credential named and never its value', async () => {
    await open();
    expect(text()).toContain('sentry');
    expect(text()).toContain('env.SENTRY_MCP_TOKEN');
    expect(text()).toContain('epic.agent');
  });

  /** Explained, and explained before the name is committed to — not left to the service's 400. */
  it('explains a reserved key rather than refusing it bare', async () => {
    await open();
    expect(text()).toContain('repository, observability, actions');

    await type('Key', 'repository');
    expect(text()).toContain('one of the platform’s own servers');
    expect(text()).toContain('not a collision to be resolved');

    // And the press does not turn that explanation into a shorter sentence from the server.
    Array.from(page().querySelectorAll('button'))
      .find((node) => (node.textContent ?? '').includes('Add'))
      ?.click();
    await settle();
    http.verify();
  });

  /** The reference is the design, so the page says where the value lives and what to spell. */
  it('says the credential lives in qits-configuration, under the reserved application', async () => {
    await open();
    expect(text()).toContain('A reference, not the value');
    expect(text()).toContain('qits-agent-mcp');
    expect(text()).toContain('env.');
  });

  it('writes a new entry under its key', async () => {
    await open();
    await type('Key', 'sonar');
    await type('URL', 'https://sonar.example/mcp');
    await type('Header name', 'Authorization');
    await type('Credential key', 'env.SONAR_MCP_TOKEN');
    await type('Pre-approved tools', 'list_issues, get_issue');

    Array.from(page().querySelectorAll('button'))
      .find((node) => (node.textContent ?? '').includes('Add'))
      ?.click();
    await settle();

    const save = http.expectOne('/projects/api/agent-mcp-catalog/sonar');
    expect(save.request.method).toBe('PUT');
    expect(save.request.body.url).toBe('https://sonar.example/mcp');
    expect(save.request.body.credentialKey).toBe('env.SONAR_MCP_TOKEN');
    expect(save.request.body.allowedTools).toEqual(['list_issues', 'get_issue']);
    save.flush({ ...CATALOG.entries[0], key: 'sonar' });
    await settle();

    http.expectOne('/projects/api/agent-mcp-catalog').flush(CATALOG);
    await settle();
  });
});
