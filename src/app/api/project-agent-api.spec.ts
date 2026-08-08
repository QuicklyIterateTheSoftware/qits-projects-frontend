import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ProjectAgentApi } from './project-agent-api';

/**
 * The transport, in the two terms that make it one rather than several.
 *
 * **The proxy rewrites nothing**, so a daemon path is appended verbatim — a client that guessed at a
 * prefix here would address a route the daemon does not serve, and the 404 would look like a missing
 * command. And **only proxied calls report reachability**: the host's own lifecycle routes answer
 * whether the daemon is up or down, so letting them set it would make a healthy host look like a
 * reachable daemon.
 */
describe('ProjectAgentApi', () => {
  let api: ProjectAgentApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ProjectAgentApi);
    http = TestBed.inject(HttpTestingController);
  });

  const container = {
    runtimeStatus: 'RUNNING' as const,
    daemonConnected: true,
    daemonVersion: '2026.808.1',
  };

  it('reads the container without creating one', async () => {
    const answer = api.container('p1');
    const request = http.expectOne('/projects/api/projects/p1/agent-container');
    expect(request.request.method).toBe('GET');
    request.flush({ container });
    expect(await answer).toEqual(container);
  });

  it('ensures and stops through the host, not through the proxy', async () => {
    const ensured = api.ensure('p1');
    http.expectOne('/projects/api/projects/p1/agent-container/ensure').flush({ container });
    expect(await ensured).toEqual(container);

    const stopped = api.stop('p1');
    const request = http.expectOne('/projects/api/projects/p1/agent-container/stop');
    expect(request.request.method).toBe('POST');
    request.flush({ container: { ...container, runtimeStatus: 'STOPPED' } });
    expect((await stopped).runtimeStatus).toBe('STOPPED');
  });

  it('appends a daemon path verbatim, because the proxy strips nothing', async () => {
    const answer = api.get('p1', '/commands');
    http.expectOne('/projects/container/p1/commands').flush({ entries: [] });
    await answer;

    const posted = api.post('p1', '/commands/c1/terminate');
    http.expectOne('/projects/container/p1/commands/c1/terminate').flush({});
    await posted;
  });

  it('builds an absolute socket url on the page’s own origin', () => {
    const url = api.socketUrl('p1', '/terminal/commands/c1');
    expect(url.startsWith('ws://') || url.startsWith('wss://')).toBe(true);
    expect(url).toContain('/projects/container/p1/terminal/commands/c1');
  });

  it('starts unknown, because an untried daemon is not a broken one', () => {
    expect(api.reachability()).toBe('unknown');
  });

  /** A 404 is the daemon answering. Only "nothing answered" means the daemon is not there. */
  it('reads the daemon’s own refusals as proof it is there', async () => {
    const answer = api.get('p1', '/commands/nope').catch(() => undefined);
    http.expectOne('/projects/container/p1/commands/nope').flush(null, {
      status: 404,
      statusText: 'Not Found',
    });
    await answer;
    expect(api.reachability()).toBe('reachable');
  });

  it('calls the daemon unreachable when the proxy could not find it', async () => {
    const answer = api.get('p1', '/commands').catch(() => undefined);
    http.expectOne('/projects/container/p1/commands').flush(null, {
      status: 502,
      statusText: 'Bad Gateway',
    });
    await answer;
    expect(api.reachability()).toBe('unreachable');
  });

  /** The host answering says nothing about the daemon behind it — see the class note. */
  it('leaves reachability alone for the host’s own routes', async () => {
    const answer = api.container('p1');
    http.expectOne('/projects/api/projects/p1/agent-container').flush({ container });
    await answer;
    expect(api.reachability()).toBe('unknown');
  });

  it('forgets what it saw when the project under it changes', async () => {
    const answer = api.get('p1', '/commands').catch(() => undefined);
    http.expectOne('/projects/container/p1/commands').flush(null, { status: 0, statusText: '' });
    await answer;
    expect(api.reachability()).toBe('unreachable');

    api.resetReachability();
    expect(api.reachability()).toBe('unknown');
  });
});
