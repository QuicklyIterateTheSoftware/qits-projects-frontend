import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { RefinementDto } from '../api/refinements-api';
import type { WorkspaceDaemonReachability } from '../api/workspace-daemon-api';
import { StatusStrip, deskState } from './status-strip';

/** A legacy container room: it has a branch and no desk (epic qits-770). */
const legacy = (over: Partial<RefinementDto> = {}): RefinementDto => ({
  id: 7,
  entityId: 'e1',
  projectId: 'p1',
  repositoryId: 'qits-qits',
  branch: 'refining/task-widgets',
  parent: 'main',
  label: 'refining-task-widgets',
  runtimeStatus: 'RUNNING',
  runtimeError: null,
  agentActivity: null,
  createdAt: null,
  ...over,
});

/** A session room: a session of the project's front desk, no branch of its own. */
const session = (over: Partial<RefinementDto> = {}): RefinementDto =>
  legacy({
    branch: null,
    parent: null,
    runtimeStatus: 'RUNNING',
    sessionId: 's-1',
    commandId: 'c-1',
    deskStatus: 'RUNNING',
    deskDetail: null,
    deskBase: '/projects/container/p1/',
    ...over,
  });

/**
 * The room's state and the verbs beside it, for both kinds of room.
 *
 * **A session room shows two states, because one cannot say the other.** The session's own
 * (`runtimeStatus`, with `runtimeError`) is what the desk reported for the room; the desk's
 * (`deskStatus`, with `deskDetail`) is why a session is not running when the desk is queued for a
 * runner, its runner is gone, or it failed. Neither carries the container diagnostics a legacy room
 * used to show — daemon version, cleanliness, drift, Recreate — which the service stops serving.
 *
 * **Start and Stop are the room's `ensure` and `stop`** for either kind; no container verb is sent.
 */
describe('StatusStrip', () => {
  const render = async (
    row: RefinementDto = legacy(),
    options: { reachability?: WorkspaceDaemonReachability } = {},
  ) => {
    const fixture = TestBed.createComponent(StatusStrip);
    fixture.componentRef.setInput('workspace', row);
    fixture.componentRef.setInput('reachability', options.reachability ?? 'unknown');
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };

  const text = (fixture: { nativeElement: HTMLElement }): string =>
    fixture.nativeElement.textContent ?? '';

  const button = (fixture: { nativeElement: HTMLElement }, label: string) =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (candidate) => (candidate as HTMLButtonElement).textContent?.trim() === label,
    ) as HTMLButtonElement | undefined;

  const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  describe('a session room', () => {
    it('shows the session state and the desk state, and no container diagnostics', async () => {
      const fixture = await render(session());

      expect(fixture.nativeElement.querySelector('[aria-label="Session"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[aria-label="Front desk"]')).not.toBeNull();
      expect(text(fixture)).toContain('a session of the project’s front desk');
      expect(text(fixture)).not.toContain('Working tree');
      expect(text(fixture)).not.toContain('version');
      expect(text(fixture)).not.toContain('ahead');
      expect(button(fixture, 'Recreate')).toBeUndefined();
    });

    it('shows a starting session as wanted, offering Stop rather than another Start', async () => {
      const fixture = await render(session({ runtimeStatus: 'STARTING', commandId: null }));

      expect(text(fixture)).toContain('starting');
      expect(button(fixture, 'Stop')).toBeTruthy();
      expect(button(fixture, 'Start')).toBeUndefined();
    });

    it('carries the session’s failure as its detail', async () => {
      const fixture = await render(
        session({ runtimeStatus: 'FAILED', runtimeError: 'the room has no token yet' }),
      );

      expect(text(fixture)).toContain('failed');
      expect(text(fixture)).toContain('the room has no token yet');
      expect(button(fixture, 'Start')).toBeTruthy();
    });

    it('says a queued desk is waiting for a runner', async () => {
      const fixture = await render(session({ runtimeStatus: 'STARTING', deskStatus: 'QUEUED' }));

      expect(text(fixture)).toContain('queued');
      expect(text(fixture)).toContain('waiting for a front-desk runner');
    });

    it('says an unavailable desk cannot run the session until its runner is back', async () => {
      const fixture = await render(
        session({ runtimeStatus: 'STOPPED', deskStatus: 'UNAVAILABLE' }),
      );

      expect(text(fixture)).toContain('unavailable');
      expect(text(fixture)).toContain('until the runner is back');
    });

    it('shows a failed desk with its detail', async () => {
      const fixture = await render(
        session({
          runtimeStatus: 'STOPPED',
          deskStatus: 'FAILED',
          deskDetail: 'image pull refused',
        }),
      );

      expect(text(fixture)).toContain('failed');
      expect(text(fixture)).toContain('image pull refused');
    });

    it('starts the room through its ensure door', async () => {
      const fixture = await render(session({ runtimeStatus: 'STOPPED', commandId: null }));
      const changes: number[] = [];
      fixture.componentInstance.changed.subscribe(() => changes.push(1));

      button(fixture, 'Start')!.click();
      await fixture.whenStable();

      const ensure = TestBed.inject(HttpTestingController).expectOne(
        '/projects/api/refinements/7/ensure',
      );
      expect(ensure.request.method).toBe('POST');
      ensure.flush({ refinement: session({ runtimeStatus: 'STARTING' }) });
      await drain();

      expect(changes).toEqual([1]);
    });

    it('stops the room through its stop door', async () => {
      const fixture = await render(session());

      button(fixture, 'Stop')!.click();
      await fixture.whenStable();

      const stop = TestBed.inject(HttpTestingController).expectOne(
        '/projects/api/refinements/7/stop',
      );
      expect(stop.request.method).toBe('POST');
      stop.flush({ refinement: session({ runtimeStatus: 'STOPPED' }) });
      await drain();
    });

    it('says why a full project refused the start', async () => {
      const fixture = await render(session({ runtimeStatus: 'STOPPED' }));

      button(fixture, 'Start')!.click();
      await fixture.whenStable();
      TestBed.inject(HttpTestingController)
        .expectOne('/projects/api/refinements/7/ensure')
        .flush(
          { error: 'REFINEMENT_SESSIONS_FULL', message: 'qits-1, qits-2 are running' },
          { status: 409, statusText: 'Conflict' },
        );
      await drain();
      fixture.detectChanges();

      expect(text(fixture)).toContain('That did not work');
    });
  });

  describe('a legacy container room', () => {
    it('shows the container state and its verbs, and no desk', async () => {
      const fixture = await render(legacy());

      expect(fixture.nativeElement.querySelector('[aria-label="Container"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[aria-label="Front desk"]')).toBeNull();
      expect(button(fixture, 'Stop')).toBeTruthy();
      expect(button(fixture, 'Recreate')).toBeUndefined();
      expect(text(fixture)).not.toContain('Working tree');
    });

    it('says the daemon is gone when the proxy has just failed to reach it', async () => {
      const fixture = await render(legacy(), { reachability: 'unreachable' });

      expect(text(fixture)).toContain(
        'Files, terminals and the agent surface cannot work right now',
      );
    });

    it('does not claim a missing daemon when there is no container to hold one', async () => {
      const fixture = await render(legacy({ runtimeStatus: 'STOPPED' }), {
        reachability: 'unreachable',
      });

      expect(text(fixture)).not.toContain('cannot work right now');
    });

    it('starts the container through the room’s ensure door, not the container one', async () => {
      const fixture = await render(legacy({ runtimeStatus: 'STOPPED' }));

      button(fixture, 'Start')!.click();
      await fixture.whenStable();

      const http = TestBed.inject(HttpTestingController);
      http.expectNone('/projects/api/refinements/7/ensure-container');
      http.expectOne('/projects/api/refinements/7/ensure').flush({ refinement: legacy() });
      await drain();
    });
  });

  it('keeps epic lifecycle actions out of the room status', async () => {
    const fixture = await render(session());

    expect(text(fixture)).not.toContain('Resolution');
    expect(text(fixture)).not.toContain('Release');
    expect(text(fixture)).not.toContain('Integrate');
    expect(text(fixture)).not.toContain('Abandon');
  });

  it('draws the quiet marker when the hint channel is down, and nothing when it is up', async () => {
    const fixture = await render();
    expect(text(fixture)).not.toContain('Live updates are reconnecting');

    fixture.componentRef.setInput('live', false);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain('Live updates are reconnecting');
  });

  it('refreshes after a failed verb, because settled is what invalidates and not success', async () => {
    const fixture = await render(legacy({ runtimeStatus: 'STOPPED' }));
    const changes: number[] = [];
    fixture.componentInstance.changed.subscribe(() => changes.push(1));

    button(fixture, 'Start')!.click();
    await fixture.whenStable();

    TestBed.inject(HttpTestingController)
      .expectOne('/projects/api/refinements/7/ensure')
      .flush({ message: 'no' }, { status: 500, statusText: 'Server Error' });
    // The rejection settles through a promise chain the fixture does not own, so let the queue drain.
    await drain();
    fixture.detectChanges();

    expect(changes).toEqual([1]);
    expect(text(fixture)).toContain('That did not work');
  });
});

describe('deskState', () => {
  it('words every desk state the service names, and draws an unknown one as itself', () => {
    expect(deskState('RUNNING')).toEqual({ label: 'running', tone: 'success', note: null });
    expect(deskState('QUEUED').tone).toBe('info');
    expect(deskState('PROVISIONING').tone).toBe('info');
    expect(deskState('UNAVAILABLE').tone).toBe('warning');
    expect(deskState('FAILED').tone).toBe('danger');
    expect(deskState('STOPPED').tone).toBe('neutral');
    expect(deskState('ABSENT').label).toBe('not created');
    expect(deskState(null).label).toBe('state unknown');
    expect(deskState('HIBERNATING')).toEqual({
      label: 'hibernating',
      tone: 'neutral',
      note: null,
    });
  });
});
