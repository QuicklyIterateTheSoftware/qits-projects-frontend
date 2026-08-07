import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { BackupOutcome, RepositoryDto } from '../api/dto';
import { WEB_SOCKET_FACTORY, type WebSocketLike } from '../api/web-socket';
import { BACKUP_REFRESH_DELAY_MS, BackupPanel } from './backup-panel';

function repository(id: string, over: Partial<RepositoryDto> = {}): RepositoryDto {
  return {
    id,
    name: id,
    backupUrl: `https://github.com/QuicklyIterate/${id}.git`,
    mainBranch: 'main',
    archetype: 'SERVICE',
    projectId: 'p1',
    lastBackup: null,
    ...over,
  };
}

function attempt(outcome: BackupOutcome) {
  return { outcome, at: '2026-08-07T12:00:00Z', detail: null };
}

/** A socket that records nothing but its own existence; the terminal has its own spec. */
class SilentSocket implements WebSocketLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;
  readonly sent: string[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }
}

/**
 * The backup controls: what they say, what they ask the service for, and when they re-read.
 *
 * The refresh is the part worth pinning. A 202 means the work has not happened, so the panel is
 * making a claim about the near future rather than reporting a result — and it must do that exactly
 * once, because a page that kept asking would poll for the rest of its life.
 */
describe('BackupPanel', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<BackupPanel>;
  let changes: number;

  beforeEach(() => {
    // Only the two this panel uses. Faking the whole clock stalls `fixture.whenStable()`,
    // which schedules its own work — the same narrowing qits-spa-ci's tree spec makes.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WEB_SOCKET_FACTORY, useValue: () => new SilentSocket() },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    changes = 0;
  });

  afterEach(() => vi.useRealTimers());

  async function mount(
    repositories: readonly RepositoryDto[],
    projectRepositoryId: string | null = 'qits-qits',
  ): Promise<void> {
    fixture = TestBed.createComponent(BackupPanel);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.componentRef.setInput('repositories', repositories);
    fixture.componentRef.setInput('projectRepositoryId', projectRepositoryId);
    fixture.componentInstance.changed.subscribe(() => (changes += 1));
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

  it('counts only the repositories that have a backup remote', async () => {
    await mount([repository('a'), repository('b', { backupUrl: null })]);

    expect(text()).toContain('1 repository has a backup remote');
  });

  it('says there is nothing to push, and offers no sync, when none has a remote', async () => {
    await mount([repository('a', { backupUrl: null })]);

    expect(text()).toContain('nothing to push');
    expect(button('Sync backups')?.disabled).toBe(true);
  });

  it('breaks the summary down by what last happened', async () => {
    await mount([
      repository('a', { lastBackup: attempt('SUCCEEDED') }),
      repository('b', { lastBackup: attempt('FAILED') }),
      repository('c'),
    ]);

    expect(text()).toContain('3 repositories have a backup remote');
    expect(text()).toContain('1 last failed');
    expect(text()).toContain('1 never attempted');
  });

  it('schedules the whole project and says how many, then re-reads once', async () => {
    await mount([repository('a'), repository('b')]);

    await press('Sync backups');
    const request = http.expectOne('/projects/api/projects/p1/repositories/backup-sync');
    expect(request.request.method).toBe('POST');
    request.flush({ scheduled: 2 });
    await settle();

    expect(text()).toContain('Scheduled 2 repositories');
    expect(changes).toBe(0);

    // The pushes run after the response, so the re-read is a timer rather than a continuation.
    vi.advanceTimersByTime(BACKUP_REFRESH_DELAY_MS);
    await settle();
    expect(changes).toBe(1);

    // Once, not forever.
    vi.advanceTimersByTime(BACKUP_REFRESH_DELAY_MS * 10);
    await settle();
    expect(changes).toBe(1);
  });

  it('reports a refused schedule and re-reads nothing', async () => {
    await mount([repository('a')]);

    await press('Sync backups');
    http
      .expectOne('/projects/api/projects/p1/repositories/backup-sync')
      .flush({ message: 'no backup remotes' }, { status: 409, statusText: 'Conflict' });
    await settle();

    expect(text()).toContain('Could not schedule the backups — 409 no backup remotes');

    vi.advanceTimersByTime(BACKUP_REFRESH_DELAY_MS * 2);
    await settle();
    expect(changes).toBe(0);
  });

  it('asks for a re-read the moment Refresh is pressed', async () => {
    await mount([repository('a')]);

    await press('Refresh');
    expect(changes).toBe(1);
    http.verify();
  });

  /** One sign-in fixes every repository, so the prompt is the project's, not a row's. */
  it('prompts for a sign-in when any repository’s credentials were refused', async () => {
    await mount([
      repository('qits-qits', { archetype: 'PROJECT' }),
      repository('b', { lastBackup: attempt('AUTH_REQUIRED') }),
    ]);

    expect(text()).toContain('Sign in once and every repository');
    expect(button('Sign in to backup remote')).toBeTruthy();
  });

  it('offers the sign-in even when nothing is failing, because a reader may ask', async () => {
    await mount([repository('qits-qits', { archetype: 'PROJECT' })]);

    expect(text()).not.toContain('Sign in once and every repository');
    expect(button('Sign in to backup remote')).toBeTruthy();
  });

  /** The server refuses to open a terminal for a repository with no remote to sign in to. */
  it('offers no sign-in when the project repository has no backup remote', async () => {
    await mount([repository('qits-qits', { archetype: 'PROJECT', backupUrl: null })]);

    expect(button('Sign in to backup remote')).toBeUndefined();
  });

  it('offers no sign-in when the project has no project repository at all', async () => {
    await mount([repository('a')], null);

    expect(button('Sign in to backup remote')).toBeUndefined();
  });

  it('opens the terminal against the project repository', async () => {
    await mount([repository('qits-qits', { archetype: 'PROJECT' })]);

    await press('Sign in to backup remote');

    expect(element().querySelector('app-remote-login-terminal')).not.toBeNull();
  });

  /**
   * A close says the terminal ended, not that it worked — so the panel re-reads *and* nudges a
   * sync, and lets the badges that come back say whether the credentials landed.
   */
  it('re-reads and nudges a sync when the terminal closes', async () => {
    await mount([repository('qits-qits', { archetype: 'PROJECT' })]);
    await press('Sign in to backup remote');

    // Through the terminal's own Close, so the panel is driven by the output it really listens to.
    await press('Close');

    expect(changes).toBe(1);
    http.expectOne('/projects/api/projects/p1/repositories/backup-sync').flush({ scheduled: 1 });
    await settle();

    expect(element().querySelector('app-remote-login-terminal')).toBeNull();
  });
});
