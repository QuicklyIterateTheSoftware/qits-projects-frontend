import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { RefinementDto } from './refinements-api';
import { WorkspaceDaemonApi, daemonBaseOf } from './workspace-daemon-api';

/**
 * The transport every daemon-backed panel will be written against: the path it builds, and the one
 * inference it draws from a failure.
 *
 * **The proxy rewrites nothing.** `/agent-worktrees/{agentId}/files` on the daemon is `/projects/refinement-container/{id}/agent-worktrees/{agentId}/files` from
 * the browser, and a client that helpfully normalised a path would be describing a different route.
 *
 * **Only "nothing answered" means the daemon is gone.** The reverse tunnel made the daemon's control
 * socket load-bearing for this proxy, so a reconnect blip 502s the file browser, every terminal and
 * the whole agent surface at once — and the status strip needs to say that in one sentence rather
 * than leave seven panels each showing their own copy of it. But a 404 from the same path is the
 * daemon answering that a file does not exist, which is a working daemon; treating it as an outage
 * would make every missing file look like a dead container.
 */
describe('WorkspaceDaemonApi', () => {
  let api: WorkspaceDaemonApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(WorkspaceDaemonApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('appends the daemon path to the container proxy verbatim', async () => {
    const answer = api.get<{ paths: string[] }>(7, '/agent-worktrees/e-7/files');
    const request = http.expectOne('/projects/refinement-container/7/agent-worktrees/e-7/files');
    request.flush({ paths: [] });

    expect((await answer).paths).toEqual([]);
    expect(request.request.method).toBe('GET');
  });

  it('carries query parameters through to the daemon', async () => {
    const answer = api.get<unknown>(7, '/agent-worktrees/e-7/files/content', {
      path: 'src/main.ts',
    });
    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/projects/refinement-container/7/agent-worktrees/e-7/files/content' &&
        candidate.params.get('path') === 'src/main.ts',
    );
    request.flush({});
    await answer;
  });

  it('starts out saying nothing about a daemon it has not tried', () => {
    expect(api.reachability()).toBe('unknown');
  });

  it('reads any answer at all as a daemon that is there — including its own 404', async () => {
    const answer = api.get(7, '/agent-worktrees/e-7/files/content').catch(() => null);
    http
      .expectOne('/projects/refinement-container/7/agent-worktrees/e-7/files/content')
      .flush({ message: 'no such file' }, { status: 404, statusText: 'Not Found' });
    await answer;

    expect(api.reachability()).toBe('reachable');
  });

  it('reads the proxy failing to reach anything as a daemon that is gone', async () => {
    const answer = api.get(7, '/agent-worktrees/e-7/files').catch(() => null);
    http
      .expectOne('/projects/refinement-container/7/agent-worktrees/e-7/files')
      .flush({ message: 'No workspace here.' }, { status: 502, statusText: 'Bad Gateway' });
    await answer;

    expect(api.reachability()).toBe('unreachable');
  });

  it('says the daemon is back on the next answer, without being told to', async () => {
    const failing = api.get(7, '/agent-worktrees/e-7/files').catch(() => null);
    http
      .expectOne('/projects/refinement-container/7/agent-worktrees/e-7/files')
      .flush({}, { status: 502, statusText: 'Bad Gateway' });
    await failing;

    const succeeding = api.get(7, '/agent-worktrees/e-7/files');
    http
      .expectOne('/projects/refinement-container/7/agent-worktrees/e-7/files')
      .flush({ paths: [] });
    await succeeding;

    expect(api.reachability()).toBe('reachable');
  });

  it('forgets what it observed when the shell moves to another workspace', async () => {
    const answer = api.get(7, '/agent-worktrees/e-7/files').catch(() => null);
    http
      .expectOne('/projects/refinement-container/7/agent-worktrees/e-7/files')
      .flush({}, { status: 0, statusText: 'Unknown' });
    await answer;
    expect(api.reachability()).toBe('unreachable');

    api.resetReachability();

    expect(api.reachability()).toBe('unknown');
  });

  it('builds an absolute socket URL, because WebSocket takes no relative one', () => {
    expect(api.socketUrl(7, '/terminal/commands/c-1')).toMatch(
      /^wss?:\/\/[^/]+\/projects\/refinement-container\/7\/terminal\/commands\/c-1$/,
    );
  });

  /**
   * The base a room's daemon is reached on (epic qits-770): a session room's is the front desk's
   * proxy, which the row names; a legacy container room keeps its own until it is retired. The
   * branch decides, as on the service; a row without a desk base (an older service) is legacy.
   */
  describe('the base a room is reached on', () => {
    const row = (over: Partial<RefinementDto>) => ({ id: 7, ...over }) as RefinementDto;

    it('is the desk for a session room, and the room’s container for a legacy one', () => {
      expect(daemonBaseOf('', row({ branch: null, deskBase: '/projects/container/p1/' }))).toBe(
        '/projects/container/p1',
      );
      expect(
        daemonBaseOf('', row({ branch: 'refining/x', deskBase: '/projects/container/p1/' })),
      ).toBe('/projects/refinement-container/7');
      expect(daemonBaseOf('', row({ branch: null, deskBase: null }))).toBe(
        '/projects/refinement-container/7',
      );
      expect(daemonBaseOf('', row({}))).toBe('/projects/refinement-container/7');
      expect(daemonBaseOf('https://qits.test', row({ deskBase: '/projects/container/p1/' }))).toBe(
        'https://qits.test/projects/container/p1',
      );
    });

    it('sends a session room’s reads and sockets to the desk once the listing has named it', async () => {
      api.observeRooms([
        row({ id: 8, entityId: 'e-8', branch: null, deskBase: '/projects/container/p1/' }),
        row({ id: 7, entityId: 'e-7', branch: 'refining/x', deskBase: null }),
      ]);

      expect(api.isSession(8)).toBe(true);
      expect(api.sessionKey(8)).toBe('e-8');
      expect(api.sessionKey(7)).toBeNull();
      expect(api.socketUrl(8, '/chat/commands/c-1')).toMatch(
        /^wss?:\/\/[^/]+\/projects\/container\/p1\/chat\/commands\/c-1$/,
      );

      const answer = api.get<unknown>(8, '/commands');
      http.expectOne('/projects/container/p1/commands').flush({ entries: [] });
      await answer;
      const legacy = api.get<unknown>(7, '/commands');
      http.expectOne('/projects/refinement-container/7/commands').flush({ entries: [] });
      await legacy;
    });

    it('forgets a row that is no longer a session room', () => {
      api.observeRooms([row({ id: 8, entityId: 'e-8', deskBase: '/projects/container/p1/' })]);
      api.observeRooms([row({ id: 8, entityId: 'e-8', branch: 'refining/x', deskBase: null })]);

      expect(api.isSession(8)).toBe(false);
      expect(api.containerBase(8)).toBe('/projects/refinement-container/8');
    });
  });
});
