import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CommandsApi, type CommandDto } from './commands-api';

const COMMAND: CommandDto = {
  id: 'cmd-1',
  repoId: 'qits-spa-workspaces',
  workspaceId: 'ws-chat',
  branch: 'ws/chat',
  actionName: 'claude chat',
  status: 'RUNNING',
  interactive: false,
  kind: 'CHAT',
  launchedAt: '2026-08-01T10:00:00Z',
  agentSessions: [{ sessionId: 's-1', source: 'PINNED', recordedAt: '2026-08-01T10:00:00Z' }],
};

/**
 * The daemon's command and agent surface, and the two things about it that are easy to get wrong.
 *
 * The proxy **rewrites nothing** — `/commands` on the daemon is `/projects/refinement-container/{id}/commands`
 * from the browser — and a coding agent **is** a command: `POST /agent-worktrees` answers the id of
 * the command its harness runs as.
 */
describe('CommandsApi', () => {
  let api: CommandsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(CommandsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the whole list, unfiltered, and unwraps the envelope', async () => {
    // Unfiltered on purpose: one entry is shared by Chat, the run history, the session tree and the
    // embedded session, and a narrower read here would be a second cache of the same thing.
    const answer = api.commands(7);
    const request = http.expectOne('/projects/refinement-container/7/commands');
    request.flush({ entries: [{ command: COMMAND }] });

    expect(request.request.method).toBe('GET');
    expect(await answer).toEqual([COMMAND]);
  });

  it('reads an absent entries array as an empty list rather than throwing', async () => {
    const answer = api.commands(7);
    http.expectOne('/projects/refinement-container/7/commands').flush({});
    expect(await answer).toEqual([]);
  });

  it('starts an agent in its own worktree and answers the start, not a command', async () => {
    // The checkout-wide `POST /agents` is gone from the workspace daemon (qits-1152): an agent is
    // started under `/agent-worktrees`, and what comes back names its harness's command by id.
    const answer = api.startAgentWorktree(7, {
      agentId: 'e-1',
      workId: 'qits-1285',
      wrapperBranch: 'refining/run-on-worktrees',
      mode: 'CHAT',
      instruction: 'add a health check',
    });
    const request = http.expectOne('/projects/refinement-container/7/agent-worktrees');
    request.flush({
      agentId: 'e-1',
      path: '/workspace/agents/e-1/qits-qits',
      commandId: 'cmd-1',
      launched: true,
      resumed: false,
      sessionId: 's-1',
    });

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      agentId: 'e-1',
      workId: 'qits-1285',
      wrapperBranch: 'refining/run-on-worktrees',
      mode: 'CHAT',
      instruction: 'add a health check',
    });
    expect((await answer).commandId).toBe('cmd-1');
  });

  it('reads one command bare, as `GET /commands/{id}` answers it', async () => {
    const answer = api.command(7, 'cmd-1');
    const request = http.expectOne('/projects/refinement-container/7/commands/cmd-1');
    request.flush(COMMAND);

    expect(request.request.method).toBe('GET');
    expect(await answer).toEqual(COMMAND);
  });

  it('terminates by id and answers the command in its post-terminate state', async () => {
    const answer = api.terminate(7, 'cmd-1');
    const request = http.expectOne('/projects/refinement-container/7/commands/cmd-1/terminate');
    request.flush({ command: { ...COMMAND, status: 'TERMINATED' } });

    expect(request.request.method).toBe('POST');
    expect((await answer).status).toBe('TERMINATED');
  });

  it('sends the preamble with a refinement when there is one', async () => {
    // The preamble is host-side workspace metadata with no source inside the container, so the
    // caller has to carry it.
    const answer = api.refinePrompt(7, 'uh make the thing faster', 'Speed up the export');
    const request = http.expectOne('/projects/refinement-container/7/prompt-refinements');
    request.flush({ prompt: 'Make the export faster.' });

    expect(request.request.body).toEqual({
      transcript: 'uh make the thing faster',
      preamble: 'Speed up the export',
    });
    expect(await answer).toBe('Make the export faster.');
  });

  it('omits the preamble entirely when the workspace has none', async () => {
    const answer = api.refinePrompt(7, 'transcript', null);
    const request = http.expectOne('/projects/refinement-container/7/prompt-refinements');
    request.flush({ prompt: 'refined' });

    expect(request.request.body).toEqual({ transcript: 'transcript' });
    await answer;
  });
});
