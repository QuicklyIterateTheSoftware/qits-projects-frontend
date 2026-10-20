import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RefinementAgent } from './refinement-agent';
import type { RefinementDto } from './refinements-api';

const ROOM = { id: 7, entityId: 'e-7', branch: 'refining/the-epic' } as RefinementDto;

/**
 * The rule the refining room's agent is started by (qits-1285): one agent per room, named by the
 * room's entity, on the room's own branch.
 */
describe('RefinementAgent', () => {
  let agent: RefinementAgent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    agent = TestBed.inject(RefinementAgent);
    http = TestBed.inject(HttpTestingController);
    agent.observe([ROOM]);
  });

  afterEach(() => http.verify());

  it('names the agent by the entity and addresses its routes under it', () => {
    expect(agent.agentId(7)).toBe('e-7');
    expect(agent.path(7, '/files')).toBe('/agent-worktrees/e-7/files');
  });

  it('starts with the entity as the agent, the qualified id as the work, the branch as the wrapper', async () => {
    agent.describe({
      id: 'e-7',
      qualifiedId: 'qits-7',
      title: 'The epic',
      status: 'REFINING',
      blocked: true,
    });
    const answer = agent.start(7, {
      mode: 'CHAT',
      surface: 'epic.chat',
      harness: 'KIMI',
      instruction: 'go',
    });
    const request = http.expectOne('/projects/refinement-container/7/agent-worktrees');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      agentId: 'e-7',
      workId: 'qits-7',
      wrapperBranch: 'refining/the-epic',
      entityId: 'e-7',
      mode: 'CHAT',
      surface: 'epic.chat',
      harness: 'KIMI',
      instruction: 'go',
      entityTitle: 'The epic',
      entityStatus: 'REFINING',
      entityBlocked: true,
    });
    expect(agent.started(7)).toBe(0);
    request.flush({
      agentId: 'e-7',
      path: '/workspace/agents/e-7/qits-qits',
      commandId: 'cmd-1',
      launched: true,
      resumed: false,
    });

    expect((await answer).commandId).toBe('cmd-1');
    expect(agent.started(7)).toBe(1);
  });

  it('falls back to the entity id for the work when no qualified id is on hand', () => {
    expect(agent.body(7, { mode: 'CHAT', surface: 'epic.chat' }).workId).toBe('e-7');
  });

  it('counts no start that was refused', async () => {
    const answer = agent.start(7, { mode: 'CHAT', surface: 'epic.chat' }).catch(() => null);
    http
      .expectOne('/projects/refinement-container/7/agent-worktrees')
      .flush(
        { error: 'not-signed-in', agentType: 'CLAUDE', message: 'Nobody has signed in.' },
        { status: 409, statusText: 'Conflict' },
      );
    await answer;

    expect(agent.started(7)).toBe(0);
  });

  it('refuses to guess the agent of a room it has not seen', () => {
    expect(() => agent.agentId(8)).toThrow(/8/);
  });
});
