import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AgentsApi, barePluginId, sessionsOfKey, type AgentSessionNodeDto } from './agents-api';

/**
 * The coding-agent reads, and the one verb that has a rule worth a test.
 *
 * **The install path takes the bare id.** The listing reports the marketplace-qualified form and the
 * daemon appends the suffix itself, so sending back what was read is a 400 — a mistake that is
 * invisible until somebody presses Install, which is exactly the kind this belongs in a test.
 */
describe('AgentsApi', () => {
  let api: AgentsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(AgentsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the session lineage as a tree, keeping the nesting', async () => {
    const reading = api.sessions(7);
    http.expectOne('/projects/refinement-container/7/agent-sessions').flush({
      sessions: [
        {
          sessionId: 'root',
          subagents: [],
          children: [
            { sessionId: 'fork', forkedFromSessionId: 'root', subagents: [], children: [] },
          ],
        },
      ],
    });
    const sessions = await reading;
    expect(sessions[0].children[0].forkedFromSessionId).toBe('root');
  });

  it('answers an empty lineage rather than throwing on a container with none', async () => {
    const reading = api.sessions(7);
    http.expectOne('/projects/refinement-container/7/agent-sessions').flush({});
    expect(await reading).toEqual([]);
  });

  it('reads the harnesses and the resolved default', async () => {
    const reading = api.available(7);
    http
      .expectOne('/projects/refinement-container/7/agents/available')
      .flush({ agents: ['CLAUDE', 'KIMI'], defaultAgent: 'CLAUDE' });
    expect((await reading).defaultAgent).toBe('CLAUDE');
  });

  it('installs by the bare id, whichever form the caller had', async () => {
    const installing = api.install(7, 'jdtls-lsp@claude-plugins-official');
    const request = http.expectOne('/projects/refinement-container/7/agent-plugins/jdtls-lsp/install');
    expect(request.request.method).toBe('POST');
    request.flush({
      installed: [{ pluginId: 'jdtls-lsp@claude-plugins-official', enabled: true }],
    });
    // The answer is the refreshed set, so there is no follow-up read — and there must not be.
    expect(await installing).toHaveLength(1);
  });

  it('refuses an id the marketplace cannot name before it reaches the daemon', async () => {
    await expect(api.install(7, 'Not A Plugin')).rejects.toThrow(/not a plugin id/i);
    http.expectNone(() => true);
  });

  it('strips the marketplace suffix and leaves a bare id alone', () => {
    expect(barePluginId('jdtls-lsp@claude-plugins-official')).toBe('jdtls-lsp');
    expect(barePluginId('jdtls-lsp')).toBe('jdtls-lsp');
  });
});

/** A session room's lineage on the desk (epic qits-770): its roots, kept whole. */
describe('sessionsOfKey', () => {
  const node = (
    sessionId: string,
    sessionKey?: string,
    children: AgentSessionNodeDto[] = [],
  ): AgentSessionNodeDto => ({
    sessionId,
    ...(sessionKey ? { sessionKey } : {}),
    subagents: [],
    children,
  });

  it('keeps the roots the key stamps, on themselves or beneath, with their whole tree', () => {
    const fork = node('fork', 'e-8');
    const tree = [
      node('desk', 'front-desk'),
      node('room', 'e-8'),
      node('older', undefined, [node('mid', undefined, [fork])]),
      node('peer', 'e-9', [node('peer-fork', 'e-9')]),
    ];

    const kept = sessionsOfKey(tree, 'e-8');

    expect(kept.map((entry) => entry.sessionId)).toEqual(['room', 'older']);
    expect(kept[1].children[0].children[0]).toBe(fork);
  });
});
