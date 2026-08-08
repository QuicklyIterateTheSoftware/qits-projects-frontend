import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal, type Signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';

/** Where a project's one agent container is. `ABSENT` means it has never been created. */
export type ContainerRuntimeStatus = 'RUNNING' | 'STOPPED' | 'PROVISIONING' | 'FAILED' | 'ABSENT';

/**
 * What the host knows about a project's agent container.
 *
 * `daemonConnected` is a separate fact from `runtimeStatus` and not a duplicate of it: a container
 * can be `RUNNING` for several seconds before its daemon dials back in, and the proxy resolves
 * through the tunnel registry the daemon fills — so "running but not connected" is the window in
 * which every request through the proxy is a 502. Saying both is what lets the panel explain that
 * window instead of reporting it as a failure.
 */
export interface AgentContainerDto {
  readonly runtimeStatus: ContainerRuntimeStatus;
  readonly daemonConnected: boolean;
  readonly daemonVersion: string | null;
}

/** The envelope all three lifecycle routes answer with. */
interface AgentContainerResponse {
  readonly container: AgentContainerDto;
}

/** What the last call **through the proxy** said about the project's daemon. */
export type DaemonReachability = 'unknown' | 'reachable' | 'unreachable';

/**
 * The statuses that mean "the daemon is not there", as opposed to "the daemon answered no".
 *
 * 0 is a request that never got an answer. 502/503/504 are the proxy's own words: it looked the
 * project's daemon up in the tunnel registry, found nothing listening, and said so. A 404 from the
 * same path is *not* here — that is the daemon answering that a command does not exist, which is a
 * working daemon.
 */
const UNREACHABLE_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * A project's agent container: the host routes that create and stop it, and the proxy that reaches
 * the daemon inside it.
 *
 * **One container per project, not one per epic.** The refinement agent is a conversation about the
 * project's whole plan, so the container is addressed by project id and every epic on the page is
 * refined through the same session.
 *
 * **The lifecycle is the host's; everything else is the daemon's.**
 * `/projects/api/projects/{id}/agent-container[/ensure|/stop]` are qits-projects' own typed routes.
 * `/projects/container/{id}/*` is a verbatim byte proxy: it rewrites no path, replaces
 * `Authorization` with the daemon's own token (so the browser never holds a daemon credential and
 * cannot smuggle one in), and passes websocket upgrades through. A daemon route is therefore
 * addressed exactly as the daemon spells it — `/commands` on the daemon is
 * `/projects/container/p1/commands` from here.
 *
 * The SPA is served by qits-projects at `/projects/`, so the proxy is same-origin with the page and
 * the gateway session cookie rides along with no CORS and no machine token.
 *
 * **This class is the transport and deliberately not the API.** The typed daemon client lives in
 * {@link ./agent-daemon-api#AgentDaemonApi} and is written against the daemon's own contract; the
 * two are split for the same reason the workspaces pair is, so that a new daemon route does not
 * touch the file that knows about proxies and websockets.
 *
 * **It watches for the daemon going away, because that is a panel-wide event.** The proxy resolves
 * through a tunnel registry that empties the instant the daemon's control socket closes, so one
 * blip takes the whole agent surface down at once. {@link reachability} is what lets the status
 * line say so in one sentence instead of turning every request into its own error.
 */
@Injectable({ providedIn: 'root' })
export class ProjectAgentApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);
  private readonly document = inject(DOCUMENT);

  private readonly reach = signal<DaemonReachability>('unknown');

  /**
   * What the proxy last said. `unknown` until something is asked — an untried daemon is not a broken
   * one, and drawing "unreachable" before the first request would be the panel's one outright lie.
   */
  readonly reachability: Signal<DaemonReachability> = this.reach.asReadonly();

  /** Forget what was observed. The panel calls this when the project under it changes. */
  resetReachability(): void {
    this.reach.set('unknown');
  }

  // ---- the host's lifecycle routes ---------------------------------------------------------

  /**
   * What the host knows about this project's container, without creating one.
   *
   * The read the collapsed panel makes on first expand. `ABSENT` is a normal answer and the common
   * one: most projects have never had a refinement session.
   */
  async container(projectId: string): Promise<AgentContainerDto> {
    const answer = await firstValueFrom(
      this.http.get<AgentContainerResponse>(this.hostBase(projectId)),
    );
    return answer.container;
  }

  /**
   * Create the container if it is not there, start it if it is stopped, and answer where it landed.
   *
   * Idempotent, and expensive the first time: it pulls an image and provisions a checkout. That is
   * the whole reason the panel is dormant until pressed — this never runs on page load.
   */
  async ensure(projectId: string): Promise<AgentContainerDto> {
    const answer = await firstValueFrom(
      this.http.post<AgentContainerResponse>(`${this.hostBase(projectId)}/ensure`, {}),
    );
    return answer.container;
  }

  /**
   * Stop the container. The volume survives, so a later {@link ensure} restarts it in place rather
   * than re-provisioning — which is why stopping is offered at all rather than being a thing only
   * the idle timer does.
   */
  async stop(projectId: string): Promise<AgentContainerDto> {
    const answer = await firstValueFrom(
      this.http.post<AgentContainerResponse>(`${this.hostBase(projectId)}/stop`, {}),
    );
    return answer.container;
  }

  // ---- the proxy --------------------------------------------------------------------------

  /**
   * The proxy prefix for one project. Every path below is appended verbatim, because the proxy
   * strips nothing: `/commands` on the daemon is `/projects/container/p1/commands` from here.
   */
  containerBase(projectId: string): string {
    return `${this.base}/projects/container/${encodeURIComponent(projectId)}`;
  }

  /** A read against the daemon. `path` starts with a slash and is the daemon's own. */
  async get<T>(
    projectId: string,
    path: string,
    params?: Record<string, string | number>,
  ): Promise<T> {
    return this.observe(
      firstValueFrom(
        this.http.get<T>(`${this.containerBase(projectId)}${path}`, { params: toParams(params) }),
      ),
    );
  }

  /** A write against the daemon. */
  async post<T>(projectId: string, path: string, body: unknown = {}): Promise<T> {
    return this.observe(
      firstValueFrom(this.http.post<T>(`${this.containerBase(projectId)}${path}`, body)),
    );
  }

  /**
   * The absolute `ws://` (or `wss://`) URL for the daemon's terminal socket.
   *
   * It is absolute because `WebSocket` takes no relative URL, and the scheme is derived from the
   * page's rather than configured: the SPA is same-origin with the proxy by construction, so any
   * other answer would describe a deployment that does not exist. The bearer is set by the proxy on
   * the inbound request rather than by an interceptor, because a proxy skips its interceptor chain
   * on an upgrade — without that every socket here would be a 401.
   */
  socketUrl(projectId: string, path: string): string {
    const page = this.document.defaultView?.location;
    const scheme = page?.protocol === 'https:' ? 'wss:' : 'ws:';
    const origin = page ? `${scheme}//${page.host}` : '';
    return `${origin}${this.containerBase(projectId)}${path}`;
  }

  private hostBase(projectId: string): string {
    return `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/agent-container`;
  }

  /**
   * Record what one proxied call implies about the daemon, then hand the result on unchanged.
   *
   * Any answer at all means the daemon is there — including its own 4xx. Only the statuses that
   * mean "nothing answered" flip it the other way, so an unknown command does not report the
   * container as gone.
   */
  private async observe<T>(call: Promise<T>): Promise<T> {
    try {
      const value = await call;
      this.reach.set('reachable');
      return value;
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.reach.set(UNREACHABLE_STATUSES.includes(status) ? 'unreachable' : 'reachable');
      throw error;
    }
  }
}

function toParams(params: Record<string, string | number> | undefined): HttpParams | undefined {
  if (!params) {
    return undefined;
  }
  let built = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    built = built.set(key, value);
  }
  return built;
}
