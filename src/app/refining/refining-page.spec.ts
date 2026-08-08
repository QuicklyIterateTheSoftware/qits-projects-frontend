import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from '../api/event-source';
import type { WorkspaceDto } from '../api/workspaces-dto';
import { routes } from '../app.routes';
import { RefiningPage } from './refining-page';

class FakeStream implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 1;
  closed = false;
  constructor(readonly url: string) {}
  close(): void {
    this.closed = true;
  }
}

const AT = '2026-08-08T09:00:00Z';

const EPIC = {
  id: 'e1',
  projectId: 'p1',
  title: 'Epic refining workspace',
  slug: 'epic-refining-workspace',
  description: 'a third action on a **draft**',
  status: 'REFINING',
  supersededByEpicId: null,
  createdAt: AT,
  updatedAt: AT,
};

const WRAPPER = {
  id: 'qits-qits',
  name: 'qits-qits',
  backupUrl: null,
  mainBranch: 'main',
  archetype: 'PROJECT',
  projectId: 'p1',
  lastBackup: null,
};

const workspace = (over: Partial<WorkspaceDto> = {}): WorkspaceDto => ({
  id: 7,
  workspaceId: 'refining-epic-refining-workspace',
  parent: 'main',
  branch: 'refining/epic-refining-workspace',
  ahead: 1,
  behind: 0,
  conflictsWithParent: false,
  status: 'ACTIVE',
  runtimeStatus: 'RUNNING',
  runtimeError: null,
  clean: true,
  agentActivity: null,
  preamble: null,
  result: null,
  resolvedAt: null,
  daemonConnectedAt: AT,
  daemonVersion: '1.4.0',
  daemonBuildTime: null,
  daemonOutdated: null,
  ...over,
});

const URL_BASE = '/p1/epics/epic-refining-workspace/refining';
const COMPONENTS_URL = '/projects/api/projects/p1/repositories';
const EPICS_URL = '/projects/api/projects/p1/epics';
const WORKSPACES_URL = '/workspaces/api/workspaces?repositoryId=qits-qits';

/**
 * The shell, and the one thing about it that is not the workspace detail page it was copied from:
 * **the URL names an epic and the workspace is resolved from it.**
 *
 * That resolution is what these tests are mostly about, because it is where the page can go wrong while
 * still looking fine. A branch match against the wrapper's ACTIVE workspaces is the *only* association
 * between an epic and its refining workspace — nothing stores one — so a page that matched loosely would
 * open somebody else's workspace, and a page that treated an absence as a failure would send a reader
 * back to the epics list to press the button that does exactly what the offer here does.
 *
 * **A tab change reuses the page and an epic change does not.** Angular reuses a component across a
 * path-parameter change, which is right for one and a bug for the other: the page reads its identity
 * into a dozen signals and a live channel, and a reused instance would go on showing the previous
 * epic's workspace.
 */
describe('RefiningPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let streams: FakeStream[];

  beforeEach(async () => {
    streams = [];
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: EVENT_SOURCE_FACTORY,
          useValue: (url: string) => {
            const stream = new FakeStream(url);
            streams.push(stream);
            return stream;
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  /** Let the request chain land, then render. One `whenStable` can return mid-chain. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  function element(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent ?? '';
  }

  function page(): RefiningPage {
    return harness.fixture.debugElement.query(By.directive(RefiningPage))
      .componentInstance as RefiningPage;
  }

  function tabs(): HTMLButtonElement[] {
    return Array.from(element().querySelectorAll('.strip .tab'));
  }

  function buttonNamed(label: string): HTMLButtonElement {
    const found = Array.from(element().querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === label,
    );
    expect(found, `no button named “${label}”`).toBeTruthy();
    return found as HTMLButtonElement;
  }

  /** The wrapper read and the epic fan-out — the two halves of the page's subject. */
  async function flushSubject(wrapper: unknown = WRAPPER): Promise<void> {
    http.expectOne(COMPONENTS_URL).flush({
      entries: wrapper ? [{ repository: wrapper }] : [],
      wrapper: wrapper ? { repositoryId: 'qits-qits', branch: 'main', entries: [] } : null,
    });
    http.expectOne(EPICS_URL).flush({ entries: [{ epic: EPIC }] });
    await settle();
    http.expectOne('/projects/api/epics/e1/features').flush({ entries: [] });
    await settle();
  }

  /**
   * Open the page and answer everything it asks for: the subject, the wrapper's workspaces, and — when
   * one matched — the transient tab's process lookup and the selected tab's own budget.
   */
  async function open(
    url = URL_BASE,
    workspaces: readonly WorkspaceDto[] = [workspace()],
    processId: string | null = null,
  ): Promise<void> {
    await harness.navigateByUrl(url);
    await flushSubject();
    http
      .expectOne(WORKSPACES_URL)
      .flush({ entries: workspaces.map((entry) => ({ workspace: entry })) });
    await settle();
    for (const request of http.match((candidate) => candidate.url.endsWith('/active-process'))) {
      request.flush({ technicalProcessId: processId });
    }
    await settle();
    await answerChatPanel();
  }

  /**
   * The Chat panel's own budget, paid whenever Chat is the selected tab — which a bare URL makes it.
   *
   * It is the panel's and not the shell's, which is the whole reason the tab is in the URL: expensive
   * state is addressable state. The container's command list first, then the saved draft once the list
   * has said nothing is running. Matched rather than expected, because a page showing no workspace — or
   * one showing the transient tab — mounts no chat panel and asks for neither.
   */
  async function answerChatPanel(): Promise<void> {
    for (const request of http.match((candidate) => candidate.url.endsWith('/commands'))) {
      request.flush({ entries: [] });
    }
    await settle();
    for (const request of http.match((candidate) => candidate.url.endsWith('/prompt-draft'))) {
      request.flush({ message: 'none' }, { status: 404, statusText: 'Not Found' });
    }
    await settle();
  }

  /**
   * The Files panel's own budget: the whole eager tree, and the detection behind the framework footer.
   *
   * Two requests and no more, however deep the tree — only wholly-ignored directories are fetched a
   * level at a time, and nothing here opens one.
   */
  function answerFilesPanel(workspaceRowId = 7): void {
    http
      .expectOne(`/workspaces/container/${workspaceRowId}/files`)
      .flush({ paths: [], lazyDirs: [], generation: 'gen-1' });
    http
      .expectOne(`/workspaces/container/${workspaceRowId}/detection`)
      .flush({ projects: [], frameworks: [], links: [], generation: 'gen-1' });
  }

  /**
   * The Agents panel's own budget: the session lineage, the harnesses, the plugin store, and the
   * detection that sorts the recommended plugins first.
   *
   * The detection read is here because the Files tab is the other end of that shared entry and these
   * tests do not open it. Open Files first and this read is already paid — which is the entry's whole
   * purpose, and why the id is a parameter rather than a constant.
   *
   * The lineage answers **one** session rather than none, and that is not padding: no history at all is
   * the one branch that launches an agent by itself, so an empty answer here would put a `POST /agents`
   * on a test about mounting a panel.
   */
  async function answerAgentsPanel(workspaceRowId = 7): Promise<void> {
    const base = `/workspaces/container/${workspaceRowId}`;
    http
      .expectOne(`${base}/agent-sessions`)
      .flush({ sessions: [{ sessionId: 's-1', subagents: [], children: [] }] });
    http
      .expectOne(`${base}/agents/available`)
      .flush({ agents: ['CLAUDE'], defaultAgent: 'CLAUDE' });
    await settle();
    http.expectOne(`${base}/agent-plugins`).flush({ installed: [] });
    http
      .expectOne(`${base}/detection`)
      .flush({ projects: [], frameworks: [], links: [], generation: 'gen-1' });
    await settle();
  }

  describe('resolution', () => {
    it('resolves the wrapper, the epic and the branch’s workspace, and opens one stream', async () => {
      await harness.navigateByUrl(URL_BASE);

      // The wrapper and the epic are read in parallel: two services, neither waiting on the other,
      // and nothing else is asked for before either has answered.
      const first = http.match(() => true);
      expect(first.map((request) => request.request.url).sort()).toEqual(
        [COMPONENTS_URL, EPICS_URL].sort(),
      );
      for (const request of first) {
        if (request.request.url === COMPONENTS_URL) {
          request.flush({
            entries: [{ repository: WRAPPER }],
            wrapper: { repositoryId: 'qits-qits', branch: 'main', entries: [] },
          });
        } else {
          request.flush({ entries: [{ epic: EPIC }] });
        }
      }
      await settle();
      http.expectOne('/projects/api/epics/e1/features').flush({ entries: [] });
      await settle();

      // Only now is there a repository to scope the workspace listing by.
      http.expectOne(WORKSPACES_URL).flush({ entries: [{ workspace: workspace() }] });
      await settle();
      http.expectOne('/workspaces/api/workspaces/7/active-process').flush({
        technicalProcessId: null,
      });
      await settle();

      expect(streams.map((stream) => stream.url)).toEqual(['/workspaces/api/workspaces/7/events']);
      await answerChatPanel();
    });

    it('names the epic and the branch it is refined on', async () => {
      await open();

      expect(text()).toContain('Epic refining workspace');
      expect(text()).toContain('refining/epic-refining-workspace');
      expect(text()).toContain('a third action on a draft');
    });

    /** The description is markdown, so the header renders it rather than printing its punctuation. */
    it('renders the epic’s description as markdown', async () => {
      await open();

      expect(element().querySelector('.description strong')?.textContent).toBe('draft');
      expect(text()).not.toContain('**');
    });

    /** Loose matching would open another epic's workspace, which is the worst thing this page can do. */
    it('takes only the workspace whose branch is this epic’s, never a near miss', async () => {
      await open(URL_BASE, [
        workspace({ id: 3, branch: 'epic/epic-refining-workspace' }),
        workspace({ id: 4, branch: 'refining/epic-refining-workspace-2' }),
        workspace({ id: 9 }),
      ]);

      expect(streams.map((stream) => stream.url)).toEqual(['/workspaces/api/workspaces/9/events']);
    });

    it('reports a project with no wrapper as the page failure it is', async () => {
      await harness.navigateByUrl(URL_BASE);
      await flushSubject(null);

      expect(text()).toContain('Could not open this refining workspace');
      expect(text()).toContain('no wrapper repository');
      expect(element().querySelector('app-tab-host')).toBeNull();
    });
  });

  /**
   * A discard resolves the workspace and leaves the branch behind, so this is the ordinary state of an
   * epic that was refined and then stopped — not an error, and not a 404.
   */
  describe('when no workspace is open', () => {
    it('offers to start one instead of drawing a broken page', async () => {
      await open(URL_BASE, []);

      expect(text()).toContain('No refining workspace is open for this epic');
      expect(element().querySelector('app-tab-host')).toBeNull();
      expect(buttonNamed('Start refining')).toBeTruthy();
    });

    it('starts one through the same find-or-create the epic card presses, then shows it', async () => {
      await open(URL_BASE, []);

      buttonNamed('Start refining').click();
      await settle();

      // The flow re-resolves the wrapper and re-checks the listing before creating anything, which is
      // what makes a workspace started in another tab meanwhile a find rather than a failure.
      http.expectOne(COMPONENTS_URL).flush({
        entries: [{ repository: WRAPPER }],
        wrapper: { repositoryId: 'qits-qits', branch: 'main', entries: [] },
      });
      await settle();
      http.expectOne(WORKSPACES_URL).flush({ entries: [] });
      await settle();

      const create = http.expectOne(
        (candidate) =>
          candidate.method === 'POST' && candidate.url === '/workspaces/api/workspaces',
      );
      expect(create.request.body).toMatchObject({
        repositoryId: 'qits-qits',
        branch: 'refining/epic-refining-workspace',
        parent: '',
        adoptExisting: false,
      });
      create.flush({ workspace: workspace() });
      await settle();

      http.expectOne(WORKSPACES_URL).flush({ entries: [{ workspace: workspace() }] });
      await settle();
      http.expectOne('/workspaces/api/workspaces/7/active-process').flush({
        technicalProcessId: null,
      });
      await settle();
      await answerChatPanel();

      expect(element().querySelector('app-tab-host')).not.toBeNull();
      expect(text()).not.toContain('No refining workspace is open');
    });

    it('keeps the offer and says why when starting one fails', async () => {
      await open(URL_BASE, []);

      buttonNamed('Start refining').click();
      await settle();
      http
        .expectOne(COMPONENTS_URL)
        .flush({ message: 'projects is down' }, { status: 503, statusText: 'Down' });
      await settle();

      expect(text()).toContain('That did not work — 503 projects is down.');
      expect(text()).toContain('No refining workspace is open for this epic');
    });

    /** An unanswered listing is not an absence; flashing the offer at a running workspace is a lie. */
    it('does not offer to start one while the listing is still in flight', async () => {
      await harness.navigateByUrl(URL_BASE);
      await flushSubject();

      expect(text()).not.toContain('No refining workspace is open');

      http.expectOne(WORKSPACES_URL).flush({ entries: [{ workspace: workspace() }] });
      await settle();
      http.expectOne('/workspaces/api/workspaces/7/active-process').flush({
        technicalProcessId: null,
      });
      await settle();
      await answerChatPanel();
    });
  });

  describe('the URL', () => {
    it('selects the first tab for a bare URL, and does not write the slug into it', async () => {
      await open();

      expect(TestBed.inject(Location).path()).toBe(URL_BASE);
      expect(element().querySelector('.tab.active')?.textContent?.trim()).toBe('Chat');
    });

    it('puts the chosen tab in the query string, so every tab is a link', async () => {
      await open();

      tabs()
        .find((tab) => tab.textContent?.trim() === 'Files')!
        .click();
      await settle();
      // Selecting a tab that has never been opened costs that tab's requests, which is exactly why the
      // tab is in the URL: it is expensive state, so it is addressable state.
      answerFilesPanel();
      await settle();

      expect(TestBed.inject(Location).path()).toContain('tab=files');
      expect(element().querySelector('.tab.active')?.textContent?.trim()).toBe('Files');
    });

    it('normalises an unknown slug away rather than obeying it', async () => {
      await open(`${URL_BASE}?tab=sketch`);
      await settle();

      expect(TestBed.inject(Location).path()).toBe(URL_BASE);
    });

    it('reuses the page across a tab change and rebuilds it across an epic change', async () => {
      await open();
      const refining = page();
      expect(refining.remounts()).toBe(0);

      await harness.navigateByUrl(`${URL_BASE}?tab=files`);
      await settle();
      answerFilesPanel();
      await settle();
      expect(refining.remounts()).toBe(0);

      await harness.navigateByUrl('/p1/epics/another-epic/refining?tab=files');
      await settle();
      http.expectOne(COMPONENTS_URL).flush({
        entries: [{ repository: WRAPPER }],
        wrapper: { repositoryId: 'qits-qits', branch: 'main', entries: [] },
      });
      http
        .expectOne(EPICS_URL)
        .flush({ entries: [{ epic: { ...EPIC, id: 'e2', slug: 'another-epic' } }] });
      await settle();
      http.expectOne('/projects/api/epics/e2/features').flush({ entries: [] });
      await settle();
      http.expectOne(WORKSPACES_URL).flush({ entries: [] });
      await settle();

      expect(refining.remounts()).toBe(1);
      expect(text()).toContain('refining/another-epic');
    });
  });

  describe('the tab row', () => {
    /** The shell was final before any panel landed, so no phase ever moved a link's neighbours. */
    it('keeps all six tabs, in the order a fresh page opens with', async () => {
      await open();

      expect(tabs().map((tab) => tab.textContent?.trim())).toEqual([
        'Chat',
        'Files',
        'Services',
        'Actions',
        'Web view',
        'Agents',
      ]);
      // Every one of them has its panel now, so the fallback placeholder is never what a tab draws.
      expect(element().querySelector('app-panel-placeholder')).toBeNull();
    });

    it('grows the transient tab when a process is running, pinned to the front and selected', async () => {
      await open(URL_BASE, [workspace()], 'proc-1');

      expect(tabs()[0].textContent?.trim()).toBe('Starting');
      expect(element().querySelector('.tab.active')?.textContent?.trim()).toBe('Starting');
      // The transient tab is deliberately not in the URL: it unmounts, and a link to it lands nowhere.
      expect(TestBed.inject(Location).path()).toBe(URL_BASE);
      expect(streams.map((stream) => stream.url)).toContain(
        '/workspaces/api/technical-processes/proc-1/events',
      );
    });

    /** The dot is read off the workspace row the strip already holds, so it costs no request. */
    it('marks the Agents tab from the workspace’s own activity rollup', async () => {
      await open(URL_BASE, [workspace({ agentActivity: 'BUSY' })]);
      const agents = tabs().find((tab) => tab.textContent?.includes('Agents'))!;

      expect(agents.querySelector('.dot')?.classList.contains('accent')).toBe(true);
      expect(agents.querySelector<HTMLElement>('.dot')?.title).toBe('The agent is working');
    });
  });

  /**
   * The interactive panels, mounted where the workspace detail page mounts them.
   *
   * What is asserted here is the *wiring*, not the panels — each has its own spec, copied with it. What
   * only this page can get wrong is which workspace row a panel is pointed at, and when it is built at
   * all: a panel created on page open rather than on tab selection would put its whole budget on every
   * reader of every tab.
   */
  describe('the panels', () => {
    it('mounts the chat panel on the tab a bare URL selects, pointed at the resolved workspace', async () => {
      await open();

      expect(element().querySelector('app-chat-panel')).not.toBeNull();
      // The prompt panel, because nothing is running — which is the chat tab's other half.
      expect(element().querySelector('app-prompt-panel')).not.toBeNull();
      expect(text()).toContain('The prompt');
      expect(text()).toContain('Start the conversation');
      expect(element().querySelector('app-agents-panel')).toBeNull();
    });

    it('builds the files panel on its tab, pointed at the resolved workspace’s container', async () => {
      await open();
      expect(element().querySelector('app-files-panel')).toBeNull();

      tabs()
        .find((tab) => tab.textContent?.trim() === 'Files')!
        .click();
      await settle();
      answerFilesPanel();
      await settle();

      expect(element().querySelector('app-files-panel')).not.toBeNull();
    });

    /**
     * The services feed is narrowed server-side by **repository and workspace label**, neither of which
     * is in this page's URL — the wrapper comes from the repositories read and the label off the
     * resolved workspace row. Getting either wrong would show another workspace's events under this
     * epic's heading, which is the one thing this wiring can do that looks fine.
     */
    it('builds the services panel with the wrapper and the workspace label it resolved', async () => {
      await open();

      tabs()
        .find((tab) => tab.textContent?.trim() === 'Services')!
        .click();
      await settle();
      http.expectOne('/workspaces/container/7/services').flush({ services: [] });
      const feed = http.expectOne(
        (candidate) => candidate.url === '/workspaces/api/service-events',
      );
      expect(feed.request.params.get('repoId')).toBe('qits-qits');
      expect(feed.request.params.get('workspaceId')).toBe('refining-epic-refining-workspace');
      feed.flush({ events: [] });
      await settle();

      expect(element().querySelector('app-services-panel')).not.toBeNull();
    });

    /** The command list is already in hand from Chat, so this tab pays for three reads and not four. */
    it('builds the actions panel on its tab, and shares the command list with chat', async () => {
      await open();

      tabs()
        .find((tab) => tab.textContent?.trim() === 'Actions')!
        .click();
      await settle();
      http.expectOne('/workspaces/container/7/commands/actions').flush({ actions: [] });
      http.expectOne('/workspaces/container/7/bootstrap-commands').flush({ steps: [] });
      http.expectOne('/workspaces/api/workspaces/7/bootstrap-runs').flush({ runs: [] });
      http.expectNone('/workspaces/container/7/commands');
      await settle();

      expect(element().querySelector('app-actions-panel')).not.toBeNull();
    });

    it('builds the web view panel on its tab, off the same shared services entry', async () => {
      await open();

      tabs()
        .find((tab) => tab.textContent?.trim() === 'Web view')!
        .click();
      await settle();
      http.expectOne('/workspaces/container/7/services').flush({ services: [] });
      await settle();

      expect(element().querySelector('app-web-view-panel')).not.toBeNull();
    });

    it('builds the agents panel only when its tab is chosen, and then reads that container', async () => {
      await open();
      expect(element().querySelector('app-agents-panel')).toBeNull();

      tabs()
        .find((tab) => tab.textContent?.trim() === 'Agents')!
        .click();
      await settle();
      await answerAgentsPanel();

      expect(element().querySelector('app-agents-panel')).not.toBeNull();
      expect(text()).toContain('Plugins');
    });

    /**
     * The activity bar is a "who needs me next" queue, and a press has to land somewhere. This SPA
     * addresses a workspace by the epic it refines, so a workspace on any other branch has no page here
     * — carrying it would draw a button that goes nowhere.
     */
    it('shows only refining workspaces in the activity bar, and presses through to that epic', async () => {
      await open(URL_BASE, [
        workspace(),
        workspace({ id: 8, branch: 'refining/another-epic', agentActivity: 'WAITING' }),
        workspace({ id: 9, branch: 'epic/some-frozen-epic', agentActivity: 'BUSY' }),
      ]);

      const entries = Array.from(element().querySelectorAll<HTMLElement>('.bar .entry'));
      expect(entries.map((entry) => entry.textContent?.trim())).toEqual([
        'refining/another-epicWaiting on you',
      ]);

      entries[0].click();
      await settle();

      expect(TestBed.inject(Location).path()).toBe('/p1/epics/another-epic/refining?tab=chat');

      // The destination resolves itself from the URL, exactly as this page did — the row id the button
      // was drawn from is not carried. What it finds is that page's business; these reads are answered
      // only so the verifier has nothing left over.
      for (const request of http.match(() => true)) {
        request.flush({ entries: [] });
      }
      await settle();
    });
  });
});
