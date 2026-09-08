import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AgentDesk, CommandDto } from '../../api/agent-daemon-api';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from '../../api/event-source';
import type { AgentContainerDto } from '../../api/project-agent-api';
import { ProjectEvents } from '../../api/project-events';
import { WEB_SOCKET_FACTORY, WEB_SOCKET_OPEN, type WebSocketLike } from '../../api/web-socket';
import { RefinementPanel } from './refinement-panel';

/** The PTY the browser would open, driven by hand — nothing else reaches these edges. */
class FakeSocket implements WebSocketLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;
  closedByClient = false;
  readonly sent: string[] = [];

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closedByClient = true;
  }

  connect(): void {
    this.readyState = WEB_SOCKET_OPEN;
    this.onopen?.(new Event('open'));
  }

  deliver(text: string): void {
    this.onmessage?.(new MessageEvent<string>('message', { data: text }));
  }

  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code }));
  }
}

/** The project's live channel, with its one interesting moment turned into a method call. */
class FakeStream implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  close(): void {
    // Nothing was opened.
  }

  emit(topic: string): void {
    this.onmessage?.(new MessageEvent<string>('message', { data: topic }));
  }
}

const AT = '2026-08-08T09:00:00Z';

function running(id: string, over: Partial<CommandDto> = {}): CommandDto {
  return {
    id,
    projectId: 'p1',
    repoName: 'qits-qits',
    branch: 'main',
    actionName: 'Claude agent',
    status: 'RUNNING',
    interactive: true,
    kind: 'TERMINAL',
    launchedAt: AT,
    agentSessions: [{ sessionId: 's1', source: 'PINNED', recordedAt: AT }],
    ...over,
  };
}

function container(over: Partial<AgentContainerDto> = {}): AgentContainerDto {
  return { runtimeStatus: 'RUNNING', daemonConnected: true, daemonVersion: '1', ...over };
}

/**
 * The refinement panel, in the terms its two expensive mistakes set.
 *
 * The first is **spending on a page nobody asked anything of**: a container is an image pull and a
 * clone, so the panel that is closed must not have created, started or even asked about one. The
 * second is **losing a conversation by mistake**: closing the panel and ending the session look the
 * same on screen and are not the same act, so the suite pins which button does which.
 */
describe('RefinementPanel', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<RefinementPanel>;
  let sockets: FakeSocket[];
  let stream: FakeStream;

  beforeEach(() => {
    sockets = [];
    stream = new FakeStream();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EVENT_SOURCE_FACTORY, useValue: () => stream },
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
  });

  afterEach(() => {
    http.verify();
  });

  async function mount(projectId = 'p1', desk: AgentDesk = 'EPICS'): Promise<void> {
    fixture = TestBed.createComponent(RefinementPanel);
    fixture.componentRef.setInput('projectId', projectId);
    fixture.componentRef.setInput('desk', desk);
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await fixture.whenStable();
    }
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent ?? '';
  }

  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(element().querySelectorAll('button')).find((candidate) =>
      (candidate.textContent ?? '').includes(label),
    );
  }

  async function press(label: string): Promise<void> {
    const target = button(label);
    expect(target, `no button reading "${label}"`).toBeTruthy();
    target?.click();
    await settle();
  }

  async function flush(url: string, body: object): Promise<void> {
    http.expectOne(url).flush(body);
    await settle();
  }

  async function fail(url: string, status: number): Promise<void> {
    http.expectOne(url).flush(null, { status, statusText: 'no' });
    await settle();
  }

  /** The harness read rides along with every resolution; naming it is all it is for. */
  async function flushHarness(): Promise<void> {
    await flush('/projects/container/p1/agents/available', {
      agents: ['CLAUDE'],
      defaultAgent: 'CLAUDE',
    });
  }

  // ---- dormancy ----------------------------------------------------------------------------

  it('asks for nothing at all while it is closed', async () => {
    await mount();
    expect(text()).toContain('Refinement agent');
    expect(text()).toContain('Not started');
    // No ensure, no status read, no daemon call. This is the whole reason the panel is collapsed.
    http.verify();
  });

  it('reads the container’s status on being opened, and creates nothing', async () => {
    await mount();
    await press('Refinement agent');

    await flush('/projects/api/projects/p1/agent-container', {
      container: container({
        runtimeStatus: 'ABSENT',
        daemonConnected: false,
        daemonVersion: null,
      }),
    });

    expect(text()).toContain('No container yet');
    expect(text()).toContain('Not started');
    // Opening is a read. Nothing has been ensured.
    http.verify();
  });

  // ---- the happy path ----------------------------------------------------------------------

  it('ensures the container, launches an agent and attaches to it', async () => {
    await mount();
    await press('Start');

    await flush('/projects/api/projects/p1/agent-container/ensure', { container: container() });
    await flush('/projects/container/p1/commands', { entries: [] });
    await flushHarness();
    // Nothing has ever run here, so resolution launches rather than offering a choice.
    await flush('/projects/container/p1/agent-sessions', { sessions: [] });

    const launch = http.expectOne('/projects/container/p1/agents');
    expect(launch.request.method).toBe('POST');
    // The desk is sent explicitly even though `EPICS` is what an absent one means: a body that says
    // which desk asked is readable in a proxy log without knowing the daemon's default.
    expect(launch.request.body).toEqual({
      scope: 'REPOSITORY',
      mode: 'INTERACTIVE',
      desk: 'EPICS',
    });
    launch.flush({ command: running('c1') });
    await settle();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain('/projects/container/p1/terminal/commands/c1');
    sockets[0].connect();
    await settle();

    expect(text()).toContain('Container running');
    expect(text()).toContain('daemon connected');
    expect(text()).toContain('Claude');
    expect(text()).toContain('attached');
  });

  it('attaches to a session that is already running instead of launching a second one', async () => {
    await mount();
    await press('Start');

    await flush('/projects/api/projects/p1/agent-container/ensure', { container: container() });
    await flush('/projects/container/p1/commands', {
      entries: [{ command: running('already') }],
    });
    await flushHarness();

    // No POST /agents and no lineage read: branch 1 answered before either was needed.
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain('/terminal/commands/already');
    http.verify();
  });

  it('never resumes a recorded session on its own, and offers the press instead', async () => {
    await mount();
    await press('Start');

    await flush('/projects/api/projects/p1/agent-container/ensure', { container: container() });
    // History exists, nothing is running: the container may no longer hold that session, so
    // resuming it is a choice rather than something resolution does.
    await flush('/projects/container/p1/commands', {
      entries: [{ command: running('old', { status: 'EXITED' }) }],
    });
    await flushHarness();

    expect(sockets).toHaveLength(0);
    expect(text()).toContain('Resume the last session');
    expect(text()).toContain('New session');
    http.verify();

    await press('Resume the last session');
    const launch = http.expectOne('/projects/container/p1/agents');
    expect(launch.request.body).toEqual({
      scope: 'REPOSITORY',
      mode: 'INTERACTIVE',
      desk: 'EPICS',
      resumeSessionId: 's1',
    });
    launch.flush({ command: running('c2') });
    await settle();
    expect(sockets).toHaveLength(1);
  });

  // ---- the socket's own rules ---------------------------------------------------------------

  it('treats a clean close as the end of the session and offers a new one', async () => {
    await attached();
    sockets[0].deliver('goodbye');
    sockets[0].serverClose(1000);
    await settle();

    // No second socket: reconnecting into a finished command would loop on the daemon's own notice.
    expect(sockets).toHaveLength(1);
    expect(text()).toContain('the session ended');
    expect(button('New session')).toBeTruthy();
  });

  // ---- detach, terminate, stop --------------------------------------------------------------

  it('detaches on close without ending the session', async () => {
    await attached();
    await press('Detach');

    expect(sockets[0].closedByClient).toBe(true);
    // Closing the panel asks the daemon nothing at all — the agent is still running.
    http.verify();
    expect(text()).toContain('Refinement agent');
    expect(button('Detach')).toBeUndefined();
  });

  it('ends the session only on a second press, and says so before it does', async () => {
    await attached();

    await press('End session');
    // The first press asks; it must not have terminated anything.
    http.verify();
    expect(text()).toContain('Confirm end session?');

    await press('Confirm end session?');
    const terminate = http.expectOne('/projects/container/p1/commands/c1/terminate');
    expect(terminate.request.method).toBe('POST');
    terminate.flush({ command: running('c1', { status: 'TERMINATED' }) });
    await settle();

    // Terminating re-resolves: the run is gone, and the lineage it left is what makes this idle.
    await flush('/projects/container/p1/commands', {
      entries: [{ command: running('c1', { status: 'TERMINATED' }) }],
    });
    expect(text()).toContain('New session');
  });

  it('stops the container on a second press, and lets the socket go with it', async () => {
    await attached();

    await press('Stop container');
    http.verify();
    expect(text()).toContain('Confirm stop container?');

    await press('Confirm stop container?');
    const stop = http.expectOne('/projects/api/projects/p1/agent-container/stop');
    expect(stop.request.method).toBe('POST');
    stop.flush({
      container: container({ runtimeStatus: 'STOPPED', daemonConnected: false }),
    });
    await settle();

    expect(sockets[0].closedByClient).toBe(true);
    expect(text()).toContain('Container stopped');
  });

  // ---- the daemon going away ----------------------------------------------------------------

  it('says the daemon is unreachable once, not once per request', async () => {
    await mount();
    await press('Start');

    await flush('/projects/api/projects/p1/agent-container/ensure', {
      container: container({ daemonConnected: false }),
    });
    await fail('/projects/container/p1/commands', 502);

    const sentence = 'The agent daemon is not answering';
    expect(text()).toContain(sentence);
    expect(text().split(sentence)).toHaveLength(2);
    expect(text()).toContain('The container is not answering yet');
  });

  // ---- the live channel ----------------------------------------------------------------------

  it('re-reads the container on an agent-activity hint, but only while it is open', async () => {
    await mount();
    // The channel belongs to the epics overview, which is not on screen here — so the connection is
    // stood up by hand, exactly as this panel finds it on the real page: already open, read-only.
    TestBed.inject(ProjectEvents).connect('p1');

    // Shut: a hint costs nothing, because the next open reads the status anyway.
    stream.emit('agent-activity');
    await settle();
    http.verify();

    await press('Refinement agent');
    await flush('/projects/api/projects/p1/agent-container', { container: container() });

    stream.emit('agent-activity');
    await settle();
    await flush('/projects/api/projects/p1/agent-container', {
      container: container({ daemonConnected: false }),
    });
    expect(text()).toContain('daemon not connected');
  });

  // ---- the two desks ------------------------------------------------------------------------

  /**
   * One panel, two front desks, and the one thing that keeps them apart.
   *
   * The run list carries no desk field, so the daemon writes the desk into the command's *name* — a
   * `TICKETS` launch is named with "(tickets desk)" in it — and this suite pins both halves of the
   * rule that reads it back. The ticket desk attaches only to named runs; the epic desk attaches only
   * to unnamed ones, which is what keeps every command from before desks existed belonging to it.
   *
   * Getting either direction wrong is not a cosmetic failure: it puts one board's conversation on the
   * other board's screen, under a heading that says it is about something else.
   */
  describe('at the ticket desk', () => {
    /** A run the daemon named for the ticket desk. The substring is the whole contract. */
    function triage(id: string, over: Partial<CommandDto> = {}): CommandDto {
      return running(id, { actionName: 'Claude Code (tickets desk · repository MCP)', ...over });
    }

    it('is named for triage rather than refinement, and says what it is for', async () => {
      await mount('p1', 'TICKETS');

      expect(element().querySelector('button.toggle')?.textContent).toContain('Triage agent');
      expect(text()).not.toContain('Refinement agent');

      await press('Triage agent');
      await flush('/projects/api/projects/p1/agent-container', {
        container: container({ runtimeStatus: 'ABSENT', daemonConnected: false }),
      });
      expect(text()).toContain('file and triage this project’s tickets');
    });

    /**
     * The lineage read is the epic desk's alone. `GET /agent-sessions` answers session ids with no
     * desk on them, so it cannot say whether the ticket desk has ever run anything — asking it would
     * mean the first press at this desk landed on an idle screen offering somebody else's session.
     * An empty filtered list is the answer, and `http.verify()` is what proves the read never left.
     */
    it('launches at its own desk without asking the desk-blind lineage read', async () => {
      await mount('p1', 'TICKETS');
      await press('Start');

      await flush('/projects/api/projects/p1/agent-container/ensure', { container: container() });
      // The container has epic history and no ticket history. That is still "nothing here yet".
      await flush('/projects/container/p1/commands', {
        entries: [{ command: running('epic-old', { status: 'EXITED' }) }],
      });
      await flushHarness();

      const launch = http.expectOne('/projects/container/p1/agents');
      expect(launch.request.method).toBe('POST');
      expect(launch.request.body).toEqual({
        scope: 'REPOSITORY',
        mode: 'INTERACTIVE',
        desk: 'TICKETS',
      });
      launch.flush({ command: triage('t1') });
      await settle();

      expect(sockets).toHaveLength(1);
      expect(sockets[0].url).toContain('/terminal/commands/t1');
      // No /agent-sessions read, and nothing else outstanding.
      http.verify();
    });

    it('adopts a running ticket-desk session and leaves the epic desk’s alone', async () => {
      await mount('p1', 'TICKETS');
      await press('Start');

      await flush('/projects/api/projects/p1/agent-container/ensure', { container: container() });
      await flush('/projects/container/p1/commands', {
        entries: [{ command: running('epic-run') }, { command: triage('tix-run') }],
      });
      await flushHarness();

      expect(sockets).toHaveLength(1);
      expect(sockets[0].url).toContain('/terminal/commands/tix-run');
      // No launch: branch 1 answered, at this desk.
      http.verify();
    });

    it('offers this desk’s last session to resume, never the other desk’s', async () => {
      await mount('p1', 'TICKETS');
      await press('Start');

      await flush('/projects/api/projects/p1/agent-container/ensure', { container: container() });
      await flush('/projects/container/p1/commands', {
        entries: [
          // Newest first, and the newest is the epic desk's. Ordering must not decide this.
          {
            command: running('epic-old', {
              status: 'EXITED',
              agentSessions: [{ sessionId: 'epic-9', source: 'PINNED', recordedAt: AT }],
            }),
          },
          {
            command: triage('tix-old', {
              status: 'EXITED',
              agentSessions: [{ sessionId: 'tix-1', source: 'PINNED', recordedAt: AT }],
            }),
          },
        ],
      });
      await flushHarness();

      expect(sockets).toHaveLength(0);
      expect(text()).toContain('tickets have been triaged before');
      http.verify();

      await press('Resume the last session');
      const launch = http.expectOne('/projects/container/p1/agents');
      expect(launch.request.body).toEqual({
        scope: 'REPOSITORY',
        mode: 'INTERACTIVE',
        desk: 'TICKETS',
        resumeSessionId: 'tix-1',
      });
      launch.flush({ command: triage('t2') });
      await settle();
    });
  });

  /**
   * The other direction of the same rule: an unnamed command is the epic desk's, and a named one is
   * not — so the epic desk launches rather than adopting the tickets terminal, and still consults the
   * lineage read, which is what keeps every pre-desk session resumable from this panel.
   */
  it('does not adopt the ticket desk’s running session onto the epics panel', async () => {
    await mount();
    await press('Start');

    await flush('/projects/api/projects/p1/agent-container/ensure', { container: container() });
    await flush('/projects/container/p1/commands', {
      entries: [{ command: running('tix-run', { actionName: 'Claude Code (tickets desk)' }) }],
    });
    await flushHarness();
    await flush('/projects/container/p1/agent-sessions', { sessions: [] });

    const launch = http.expectOne('/projects/container/p1/agents');
    expect(launch.request.body).toEqual({
      scope: 'REPOSITORY',
      mode: 'INTERACTIVE',
      desk: 'EPICS',
    });
    launch.flush({ command: running('e1') });
    await settle();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain('/terminal/commands/e1');
    expect(sockets[0].url).not.toContain('tix-run');
  });

  /** The common set-up: open, ensure, launch, attach, and an open PTY. */
  async function attached(): Promise<void> {
    await mount();
    await press('Start');
    await flush('/projects/api/projects/p1/agent-container/ensure', { container: container() });
    await flush('/projects/container/p1/commands', { entries: [] });
    await flushHarness();
    await flush('/projects/container/p1/agent-sessions', { sessions: [] });
    await flush('/projects/container/p1/agents', { command: running('c1') });
    sockets[0].connect();
    await settle();
  }
});
