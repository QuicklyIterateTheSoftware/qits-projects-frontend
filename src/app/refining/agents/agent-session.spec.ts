import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CommandDto } from '../../api/commands-api';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from '../../api/event-source';
import { RefinementAgent } from '../../api/refinement-agent';
import type { RefinementDto } from '../../api/refinements-api';
import { WEB_SOCKET_FACTORY, WEB_SOCKET_OPEN, type WebSocketLike } from '../../api/web-socket';
import { WorkspaceCommands } from '../../api/workspace-commands';
import { WorkspaceDaemonApi } from '../../api/workspace-daemon-api';
import { AgentSession } from './agent-session';

/** Several turns, because a client call is several awaits deep. */
const settle = async () => {
  for (let turn = 0; turn < 12; turn++) {
    await Promise.resolve();
  }
};

class FakeStream implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 1;
  close(): void {
    this.readyState = 2;
  }
}

class FakeSocket implements WebSocketLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = WEB_SOCKET_OPEN;
  readonly sent: string[] = [];
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
}

const command = (over: Partial<CommandDto> & Pick<CommandDto, 'id'>): CommandDto => ({
  repoId: 'r',
  workspaceId: 'w',
  branch: 'b',
  actionName: 'claude',
  status: 'RUNNING',
  interactive: true,
  kind: 'TERMINAL',
  launchedAt: '2026-08-01T10:00:00Z',
  agentSessions: [],
  ...over,
});

/** Where a start goes: the room's one agent, named by its entity (qits-1285). */
const START = '/projects/refinement-container/7/agent-worktrees';

/** What `POST /agent-worktrees` answers — a command id, not a command. */
const started = (commandId: string) => ({
  agentId: 'e-7',
  path: '/workspace/agents/e-7/qits-qits',
  commandId,
  launched: true,
  resumed: false,
  sessionId: null,
});

const session = (sessionId: string) => ({
  sessionId,
  recordedAt: '2026-08-01T10:00:00Z',
  source: 'PINNED' as const,
});

/**
 * The embedded session's resolution, which is the most consequential piece of behaviour on the page.
 *
 * The four branches are asserted **including the two that do nothing**, because the value of the
 * order is entirely in what it refuses to do: a running chat must not be joined by a second
 * attachment, and a workspace with history must not be resumed without a press. Both of those failure
 * modes are silent — they look like the page working — which is why they are tested rather than
 * written down.
 */
describe('AgentSession', () => {
  let http: HttpTestingController;
  let sockets: FakeSocket[];

  beforeEach(() => {
    sockets = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EVENT_SOURCE_FACTORY, useValue: () => new FakeStream() },
        {
          provide: WEB_SOCKET_FACTORY,
          useValue: (url: string) => {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(RefinementAgent).observe([
      { id: 7, entityId: 'e-7', branch: 'refining/the-epic' } as RefinementDto,
    ]);
  });

  afterEach(() => http.verify());

  /** Point the service at a workspace and answer its three opening reads. */
  async function open(
    commands: readonly CommandDto[],
    sessions: readonly { sessionId: string; subagents: []; children: [] }[] = [],
  ): Promise<AgentSession> {
    const service = TestBed.inject(AgentSession);
    service.use(7);
    TestBed.tick();
    http.expectOne('/projects/refinement-container/7/agent-sessions').flush({ sessions });
    http
      .expectOne('/projects/refinement-container/7/agents/available')
      .flush({ agents: ['CLAUDE', 'KIMI'], defaultAgent: 'CLAUDE' });
    http
      .expectOne('/projects/refinement-container/7/commands')
      .flush({ entries: commands.map((entry) => ({ command: entry })) });
    await settle();
    TestBed.tick();
    await settle();
    return service;
  }

  /** Answer whatever a launch left in flight: the refreshed command list and lineage. */
  async function answer(commands: readonly CommandDto[]): Promise<void> {
    http
      .match('/projects/refinement-container/7/commands')
      .forEach((request) =>
        request.flush({ entries: commands.map((entry) => ({ command: entry })) }),
      );
    http
      .match('/projects/refinement-container/7/agent-sessions')
      .forEach((request) => request.flush({ sessions: [] }));
    await settle();
    TestBed.tick();
    await settle();
  }

  /** Push a fresh command list through the shared entry, the way a `commands` hint would. */
  async function refresh(commands: readonly CommandDto[]): Promise<void> {
    void TestBed.inject(WorkspaceCommands).refresh();
    await settle();
    await answer(commands);
  }

  it('1 — attaches to a running interactive agent run, wherever it was started', async () => {
    const service = await open([command({ id: 'c1', agentSessions: [session('s1')] })]);
    expect(service.branch()).toEqual({ kind: 'attached', commandId: 'c1' });
    expect(sockets[0].url).toContain('/projects/refinement-container/7/terminal/commands/c1');
    expect(service.liveSessionId()).toBe('s1');
    http.expectNone(START);
  });

  it('2 — defers to a running chat and launches nothing, even with no session history', async () => {
    const service = await open([
      command({ id: 'chat1', kind: 'CHAT', interactive: false, status: 'RUNNING' }),
    ]);
    expect(service.branch()).toEqual({ kind: 'deferred', commandId: 'chat1' });
    expect(sockets).toHaveLength(0);
    // The collision session-pinning exists to prevent: no launch, no attach, a jump link instead.
    http.expectNone(START);
  });

  it('3 — launches fresh when there is no session history at all, once', async () => {
    TestBed.inject(RefinementAgent).describe({
      id: 'e-7',
      qualifiedId: 'qits-7',
      title: 'The epic',
      status: 'REFINING',
      blocked: false,
    });
    const service = await open([]);
    const launch = http.expectOne(START);
    // No `harness`: the automatic launch takes the container's own resolved default rather than
    // this page naming one. Only a launch a person asked for may pick a harness.
    expect(launch.request.body).toEqual({
      // The room's one agent is its entity, on the room's own branch (qits-1285).
      agentId: 'e-7',
      workId: 'qits-7',
      wrapperBranch: 'refining/the-epic',
      entityId: 'e-7',
      mode: 'INTERACTIVE',
      // Sent on every launch: this daemon's four human surfaces are otherwise indistinguishable,
      // and an epic's agent tab must not take an ad-hoc workspace's configuration.
      surface: 'epic.agent',
      entityTitle: 'The epic',
      entityStatus: 'REFINING',
      entityBlocked: false,
    });
    launch.flush(started('c9'));
    await settle();
    http.expectOne('/projects/refinement-container/7/commands').flush({
      entries: [{ command: command({ id: 'c9', agentSessions: [session('s9')] }) }],
    });
    http.expectOne('/projects/refinement-container/7/agent-sessions').flush({ sessions: [] });
    await settle();
    TestBed.tick();
    await settle();
    expect(service.branch().kind).toBe('attached');
  });

  it('4 — idles on an explicit choice when history exists and nothing is running', async () => {
    const service = await open(
      [command({ id: 'c1', status: 'EXITED', agentSessions: [session('s1')] })],
      [{ sessionId: 's1', subagents: [], children: [] }],
    );
    expect(service.branch()).toEqual({ kind: 'idle' });
    expect(sockets).toHaveLength(0);
    // **Never automatic.** A recorded session can be gone from the agent's own state.
    http.expectNone(START);
    expect(service.lastSession()?.sessionId).toBe('s1');
  });

  it('resumes only on a press, and sends no fork the daemon has no field for', async () => {
    const service = await open(
      [command({ id: 'c1', status: 'EXITED', agentSessions: [session('s1')] })],
      [{ sessionId: 's1', subagents: [], children: [] }],
    );
    void service.resume('s1', true);
    await settle();
    const launch = http.expectOne(START);
    // Without `describe`, the entity id stands in for the work id and nothing seeds the name.
    expect(launch.request.body).toEqual({
      agentId: 'e-7',
      workId: 'e-7',
      wrapperBranch: 'refining/the-epic',
      entityId: 'e-7',
      mode: 'INTERACTIVE',
      surface: 'epic.agent',
      sessionId: 's1',
    });
    launch.flush(started('c2'));
    await settle();
    http.match('/projects/refinement-container/7/commands').forEach((request) =>
      request.flush({
        entries: [{ command: command({ id: 'c2', agentSessions: [session('s2')] }) }],
      }),
    );
    http
      .match('/projects/refinement-container/7/agent-sessions')
      .forEach((request) =>
        request.flush({ sessions: [{ sessionId: 's1', subagents: [], children: [] }] }),
      );
    await settle();
    TestBed.tick();
    await settle();
    expect(service.branch()).toEqual({ kind: 'attached', commandId: 'c2' });
  });

  /**
   * The refusal, the deliberate press, and the replay — in that order, which is the order that made
   * this worth changing.
   *
   * <p>A signed-out launch used to answer a login terminal *instead of* the session, and this tab
   * attached to it as if it were one. Now it refuses with `409 not-signed-in`, the tab says so, and
   * the terminal opens only because `openSignIn` was pressed. What survives from before is the good
   * half: the refused launch is held, and completing the sign-in issues it again rather than
   * dropping the reader on a menu.
   */
  it('refuses when nobody is signed in, then replays the launch the sign-in interrupted', async () => {
    const service = await open(
      [command({ id: 'c1', status: 'EXITED', agentSessions: [session('s1')] })],
      [{ sessionId: 's1', subagents: [], children: [] }],
    );

    void service.startFresh('CLAUDE');
    await settle();
    http.expectOne(START).flush(
      {
        error: 'not-signed-in',
        agentType: 'CLAUDE',
        message: 'Nobody has signed Claude Code in on this platform’s shared credential volume.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    await answer([command({ id: 'c1', status: 'EXITED', agentSessions: [session('s1')] })]);

    expect(service.branch()).toEqual({
      kind: 'signed-out',
      harness: 'Claude Code',
      message: 'Nobody has signed Claude Code in on this platform’s shared credential volume.',
    });
    // Nothing was attached: a refusal is not a session, and this is exactly what used to be hidden.
    expect(sockets).toHaveLength(0);

    // The press. Only now does a terminal exist, and it is the door's, not a substitution's.
    void service.openSignIn();
    await settle();
    const door = http.expectOne('/projects/refinement-container/7/agents/sign-in');
    expect(door.request.method).toBe('POST');
    expect(door.request.body).toEqual({ agentType: 'CLAUDE' });
    door.flush({ command: command({ id: 'login1', actionName: 'Claude sign-in' }) });
    await settle();
    await answer([command({ id: 'login1', actionName: 'Claude sign-in' })]);

    expect(service.branch()).toEqual({ kind: 'signin', commandId: 'login1' });
    expect(sockets[sockets.length - 1].url).toContain('/terminal/commands/login1');

    // The operator completes the sign-in and the terminal exits. That is the trigger.
    await refresh([command({ id: 'login1', actionName: 'Claude sign-in', status: 'EXITED' })]);

    const replay = http.expectOne(START);
    expect(replay.request.body).toMatchObject({
      agentId: 'e-7',
      mode: 'INTERACTIVE',
      surface: 'epic.agent',
      harness: 'CLAUDE',
    });
    replay.flush(started('c5'));
    await settle();
    await answer([command({ id: 'c5', agentSessions: [session('s5')] })]);
    expect(service.branch()).toEqual({ kind: 'attached', commandId: 'c5' });
  });

  it('says the container is gone rather than showing an empty session', async () => {
    const service = TestBed.inject(AgentSession);
    service.use(7);
    TestBed.tick();
    http
      .expectOne('/projects/refinement-container/7/agent-sessions')
      .flush({ message: 'no daemon' }, { status: 502, statusText: 'Bad Gateway' });
    http
      .expectOne('/projects/refinement-container/7/agents/available')
      .flush({}, { status: 502, statusText: 'Bad Gateway' });
    http
      .expectOne('/projects/refinement-container/7/commands')
      .flush({ message: 'no daemon' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    TestBed.tick();
    await settle();
    const branch = service.branch();
    expect(branch.kind).toBe('unavailable');
    expect(branch.kind === 'unavailable' && branch.message).toContain('container');
  });

  /**
   * A session room (epic qits-770): its daemon is the project's desk, shared with the desk's own
   * session and every other room's. Its Agents tab reads only what the desk keyed to the room's
   * entity, and launches nothing — the desk runs the room's session.
   */
  describe('in a session room', () => {
    const DESK = '/projects/container/p1';

    async function openSession(
      commands: readonly CommandDto[],
      sessions: readonly object[],
    ): Promise<AgentSession> {
      TestBed.inject(WorkspaceDaemonApi).observeRooms([
        {
          id: 8,
          entityId: 'e-8',
          branch: null,
          deskBase: '/projects/container/p1/',
        } as RefinementDto,
      ]);
      const service = TestBed.inject(AgentSession);
      service.use(8);
      TestBed.tick();
      http.expectOne(`${DESK}/agent-sessions`).flush({ sessions });
      http
        .expectOne(`${DESK}/agents/available`)
        .flush({ agents: ['CLAUDE'], defaultAgent: 'CLAUDE' });
      http
        .expectOne(`${DESK}/commands`)
        .flush({ entries: commands.map((entry) => ({ command: entry })) });
      await settle();
      TestBed.tick();
      await settle();
      return service;
    }

    const node = (sessionId: string, sessionKey?: string, children: object[] = []) => ({
      sessionId,
      ...(sessionKey ? { sessionKey } : {}),
      subagents: [],
      children,
    });

    it('lists only the sessions and runs keyed to the room’s entity', async () => {
      const service = await openSession(
        [
          command({ id: 'desk', agentSessions: [session('s-desk')], sessionKey: 'front-desk' }),
          command({ id: 'mine', agentSessions: [session('s-mine')], sessionKey: 'e-8' }),
        ],
        [
          node('s-desk', 'front-desk'),
          node('s-mine', 'e-8'),
          node('s-root', undefined, [node('s-fork', 'e-8')]),
          node('s-other', 'e-9'),
        ],
      );

      const state = service.sessions();
      expect(state.kind === 'ready' && state.value.map((entry) => entry.sessionId)).toEqual([
        's-mine',
        's-root',
      ]);
      expect(service.branch()).toEqual({ kind: 'attached', commandId: 'mine' });
      expect(sockets[0].url).toContain(`${DESK}/terminal/commands/mine`);
    });

    it('launches nothing with no history, and says the desk runs the session', async () => {
      const service = await openSession(
        [command({ id: 'desk', agentSessions: [session('s-desk')], sessionKey: 'front-desk' })],
        [node('s-desk', 'front-desk')],
      );

      expect(service.branch()).toEqual({ kind: 'desk' });
      http.expectNone(`${DESK}/agent-worktrees`);
      expect(sockets).toHaveLength(0);
    });

    it('refuses a press to start one, rather than sending a launch the desk does not serve', async () => {
      const service = await openSession([], []);

      await service.startFresh();

      http.expectNone(`${DESK}/agent-worktrees`);
      expect(service.problem()).toContain('front desk');
    });
  });
});
