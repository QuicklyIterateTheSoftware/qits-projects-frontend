import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from '../api/event-source';
import type { RefinementDto } from '../api/refinements-api';
import { routes } from '../app.routes';
import { LINGER_MS, RefiningPage } from './refining-page';

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

const workspace = (over: Partial<RefinementDto> = {}): RefinementDto => ({
  id: 7,
  epicId: 'e1',
  projectId: 'p1',
  repositoryId: 'qits-qits',
  branch: 'refining/epic-refining-workspace',
  parent: 'main',
  label: 'refining-epic-refining-workspace',
  preamble: null,
  runtimeStatus: 'RUNNING',
  runtimeError: null,
  clean: true,
  ahead: 1,
  behind: 0,
  conflictsWithParent: false,
  agentActivity: null,
  daemonConnectedAt: AT,
  daemonVersion: '1.4.0',
  daemonOutdated: null,
  createdAt: AT,
  ...over,
});

const URL_BASE = '/p1/epics/epic-refining-workspace/refining';
const EPICS_URL = '/projects/api/projects/p1/epics';
const REFINEMENTS_URL = '/projects/api/projects/p1/refinements';

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

  /**
   * The shared project list, which the address's first segment is resolved against.
   *
   * Every read on this page is keyed on the project **id** and the URL names the slug, so nothing
   * else can be asked for until this has answered. Matched rather than expected: one flight per
   * application instance, so a test that opens the page twice sees it once.
   */
  async function flushProjectList(): Promise<void> {
    for (const request of http.match('/projects/api/projects')) {
      request.flush({
        entries: [
          { project: { id: 'p1', name: 'Qits', slug: 'p1', description: null, dns: null } },
        ],
      });
    }
    await settle();
  }

  /** The epic fan-out — the page's whole subject now the wrapper is the server's business. */
  async function flushSubject(): Promise<void> {
    await flushProjectList();
    http.expectOne(EPICS_URL).flush({ entries: [{ epic: EPIC }] });
    await settle();
    http.expectOne('/projects/api/epics/e1/features').flush({ entries: [] });
    await settle();
  }

  /**
   * The refinements listing, plus — when one matched this page's branch — the full-row upgrade the
   * page issues for its own subject.
   */
  async function flushRefinements(rows: readonly RefinementDto[]): Promise<void> {
    http.expectOne(REFINEMENTS_URL).flush({ refinements: rows });
    await settle();
    const match = rows.find((row) => row.branch === 'refining/epic-refining-workspace');
    if (match) {
      http.expectOne(`/projects/api/refinements/${match.id}`).flush({ refinement: match });
      await settle();
    }
  }

  /**
   * Open the page and answer everything it asks for: the subject, the project's refinements, and —
   * when one matched — the transient tab's process lookup and the selected tab's own budget.
   */
  async function open(
    url = URL_BASE,
    workspaces: readonly RefinementDto[] = [workspace()],
    processId: string | null = null,
  ): Promise<void> {
    await harness.navigateByUrl(url);
    await flushSubject();
    await flushRefinements(workspaces);
    for (const request of http.match((candidate) => candidate.url.endsWith('/active-process'))) {
      request.flush({ technicalProcessId: processId });
    }
    await settle();
    if (url.includes('tab=chat')) {
      await answerChatPanel();
    }
  }

  /**
   * The Chat panel's own budget, paid only when Chat is explicitly selected.
   *
   * It is the panel's and not the shell's, which is the whole reason the tab is in the URL: expensive
   * state is addressable state. The container's command list first, then the saved draft once the list
   * has said nothing is running. Matched rather than expected, because a page showing no workspace — or
   * one showing the transient tab — mounts no chat panel and asks for neither.
   */
  async function answerChatPanel(savedContent: string | null = null): Promise<void> {
    for (const request of http.match((candidate) => candidate.url.endsWith('/commands'))) {
      request.flush({ entries: [] });
    }
    await settle();
    for (const request of http.match((candidate) => candidate.url.endsWith('/prompt-draft'))) {
      if (savedContent === null) {
        request.flush({ message: 'none' }, { status: 404, statusText: 'Not Found' });
      } else {
        request.flush({
          draft: { content: savedContent, updatedAt: '2026-08-09T10:00:00Z' },
        });
      }
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
      .expectOne(`/projects/refinement-container/${workspaceRowId}/files`)
      .flush({ paths: [], lazyDirs: [], generation: 'gen-1' });
    http
      .expectOne(`/projects/refinement-container/${workspaceRowId}/detection`)
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
    const base = `/projects/refinement-container/${workspaceRowId}`;
    http.expectOne(`${base}/commands`).flush({ entries: [] });
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
    it('resolves the epic and the refinement in parallel, and opens one stream', async () => {
      await harness.navigateByUrl(URL_BASE);
      // The project list first, on its own: the URL names a slug and every read below is keyed on
      // the id, so nothing can be in flight beside it.
      await flushProjectList();

      // The epic and the refinements listing are then read in parallel: both are keyed off the
      // resolved project alone, and neither waits on the other.
      const first = http.match(() => true);
      expect(first.map((request) => request.request.url).sort()).toEqual(
        [EPICS_URL, REFINEMENTS_URL].sort(),
      );
      for (const request of first) {
        if (request.request.url === REFINEMENTS_URL) {
          request.flush({ refinements: [workspace()] });
        } else {
          request.flush({ entries: [{ epic: EPIC }] });
        }
      }
      await settle();
      http.expectOne('/projects/api/epics/e1/features').flush({ entries: [] });
      http.expectOne('/projects/api/refinements/7').flush({ refinement: workspace() });
      await settle();
      http.expectOne('/projects/api/refinements/7/active-process').flush({
        technicalProcessId: null,
      });
      await settle();

      expect(streams.map((stream) => stream.url)).toEqual(['/projects/api/refinements/7/events']);
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

    it('puts the implementation and abandonment decisions directly below the epic', async () => {
      await open();

      const actions = element().querySelector('.head app-epic-actions');
      expect(actions).not.toBeNull();
      expect(actions?.textContent).toContain('Start implementation');
      expect(actions?.textContent).toContain('Abandon');
    });

    it('starts implementation through the same epic transition as the overview', async () => {
      await open();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      buttonNamed('Start implementation').click();
      await settle();

      const request = http.expectOne('/projects/api/epics/e1/transition');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ target: 'IMPLEMENTATION' });
      request.flush({ epic: { ...EPIC, status: 'IMPLEMENTATION' }, successor: null });
      await settle();

      expect(navigate).toHaveBeenCalledWith(['p1', 'epics'], { fragment: 'epic-e1' });
      http.expectNone('/projects/api/refinements/7/discard');
    });

    it('confirms abandonment, deletes the refinement workspace first, then abandons the epic', async () => {
      await open();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      buttonNamed('Abandon').click();
      await settle();
      http.expectNone('/projects/api/refinements/7/discard');
      http.expectNone('/projects/api/epics/e1/transition');

      buttonNamed('Confirm abandon?').click();
      await settle();
      const discard = http.expectOne('/projects/api/refinements/7/discard');
      discard.flush({ success: true });
      await settle();

      const transition = http.expectOne('/projects/api/epics/e1/transition');
      expect(transition.request.body).toEqual({ target: 'ABANDONED' });
      transition.flush({ epic: { ...EPIC, status: 'ABANDONED' }, successor: null });
      await settle();

      expect(navigate).toHaveBeenCalledWith(['p1', 'epics'], { fragment: 'epic-e1' });
    });

    /** Loose matching would open another epic's workspace, which is the worst thing this page can do. */
    it('takes only the workspace whose branch is this epic’s, never a near miss', async () => {
      await open(URL_BASE, [
        workspace({ id: 3, branch: 'epic/epic-refining-workspace' }),
        workspace({ id: 4, branch: 'refining/epic-refining-workspace-2' }),
        workspace({ id: 9 }),
      ]);

      expect(streams.map((stream) => stream.url)).toEqual(['/projects/api/refinements/9/events']);
    });

    it('reports a subject that could not be resolved as the page failure it is', async () => {
      await harness.navigateByUrl(URL_BASE);
      await flushProjectList();
      http
        .expectOne(EPICS_URL)
        .flush({ message: 'projects is down' }, { status: 503, statusText: 'Down' });
      http.expectOne(REFINEMENTS_URL).flush({ refinements: [] });
      await settle();

      expect(text()).toContain('Could not open this refining workspace');
      expect(element().querySelector('app-tab-host')).toBeNull();
    });
  });

  /** A missing or discarded workspace is an ordinary recoverable state, not an error or a 404. */
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

      // One idempotent POST keyed by the epic — the find, the branch cut and the adopt-existing
      // dance are the server's business now, which is what makes a refinement started in another
      // tab meanwhile a find rather than a failure.
      const create = http.expectOne(
        (candidate) => candidate.method === 'POST' && candidate.url === '/projects/api/refinements',
      );
      expect(create.request.body).toEqual({ epicId: 'e1' });
      create.flush({ refinement: workspace() });
      await settle();

      await flushRefinements([workspace()]);
      http.expectOne('/projects/api/refinements/7/active-process').flush({
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
        .expectOne('/projects/api/refinements')
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

      await flushRefinements([workspace()]);
      http.expectOne('/projects/api/refinements/7/active-process').flush({
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
      expect(element().querySelector('.tab.active')?.textContent?.trim()).toBe('Epic');
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
      await open(`${URL_BASE}?tab=whiteboard`);
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
      http
        .expectOne(EPICS_URL)
        .flush({ entries: [{ epic: { ...EPIC, id: 'e2', slug: 'another-epic' } }] });
      await settle();
      http.expectOne('/projects/api/epics/e2/features').flush({ entries: [] });
      http.expectOne(REFINEMENTS_URL).flush({ refinements: [] });
      await settle();

      expect(refining.remounts()).toBe(1);
      expect(text()).toContain('refining/another-epic');
    });
  });

  describe('the tab row', () => {
    /**
     * The epic document leads, followed by the workspace tools inherited from workspace detail.
     */
    it('keeps the epic first and all workspace tools after it', async () => {
      await open();

      expect(tabs().map((tab) => tab.textContent?.trim())).toEqual([
        'Epic',
        'Files',
        'Sketch',
        'Design',
        'Web view',
        'Agents',
        'Container',
        'Chat',
      ]);
      // Every one of them has its panel now, so the fallback placeholder is never what a tab draws.
      expect(element().querySelector('app-panel-placeholder')).toBeNull();
    });

    it('grows the transient tab when a process is running, pinned to the front and selected', async () => {
      await open(URL_BASE, [workspace()], 'proc-1');

      expect(tabs()[0].textContent?.trim()).toBe('Epic');
      expect(tabs()[1].textContent?.trim()).toBe('Starting');
      expect(element().querySelector('.tab.active')?.textContent?.trim()).toBe('Starting');
      // The transient tab is deliberately not in the URL: it unmounts, and a link to it lands nowhere.
      expect(TestBed.inject(Location).path()).toBe(URL_BASE);
      expect(streams.map((stream) => stream.url)).toContain(
        '/projects/api/technical-processes/proc-1/events',
      );
    });

    it('keeps the clone/setup tab open after setup failed, so its diagnosis remains readable', async () => {
      await open(URL_BASE, [workspace()], 'proc-1');
      const timers = vi.spyOn(globalThis, 'setTimeout');
      try {
        const process = streams.find((stream) =>
          stream.url.endsWith('/technical-processes/proc-1/events'),
        );
        expect(process).toBeTruthy();

        process!.onmessage?.(
          new MessageEvent<string>('message', {
            data: JSON.stringify({
              kind: 'done',
              segment: null,
              seq: 1,
              line: null,
              status: 'failed',
              hint: null,
              hintTarget: null,
            }),
          }),
        );
        await settle();
        await flushRefinements([workspace()]);
        http.expectOne('/projects/api/refinements/7/active-process').flush({
          technicalProcessId: null,
        });
        await settle();

        expect(element().querySelector('.tab.active')?.textContent?.trim()).toBe('Starting');
        expect(tabs().map((tab) => tab.textContent?.trim())).toContain('Starting');
        expect(text()).toContain('Finished with a failure. Review the log before trying again.');
        expect(timers.mock.calls.filter(([, delay]) => delay === LINGER_MS)).toEqual([]);
      } finally {
        timers.mockRestore();
      }
    });

    /** The dot is read off the workspace row the strip already holds, so it costs no request. */
    it('marks the Agents tab from the workspace’s own activity rollup', async () => {
      await open(URL_BASE, [workspace({ agentActivity: 'BUSY' })]);
      const agents = tabs().find((tab) => tab.textContent?.includes('Agents'))!;

      expect(agents.querySelector('.dot')?.classList.contains('accent')).toBe(true);
      expect(agents.querySelector<HTMLElement>('.dot')?.title).toBe('The agent is working');
    });

    it('starts a stopped container once on route entry and exposes its process', async () => {
      await harness.navigateByUrl(URL_BASE);
      await flushSubject();
      const stopped = workspace({ runtimeStatus: 'STOPPED' });
      http.expectOne(REFINEMENTS_URL).flush({ refinements: [stopped] });
      await settle();
      http.expectOne('/projects/api/refinements/7').flush({ refinement: stopped });
      await settle();

      http.expectOne('/projects/api/refinements/7/active-process').flush({
        technicalProcessId: null,
      });
      const ensure = http.expectOne('/projects/api/refinements/7/ensure-container');
      expect(ensure.request.method).toBe('POST');
      ensure.flush({
        refinement: workspace({ runtimeStatus: 'PROVISIONING' }),
        technicalProcessId: 'p1',
      });
      await settle();

      await flushRefinements([workspace()]);

      expect(element().querySelector('.tab.active')?.textContent?.trim()).toBe('Starting');
      expect(tabs().map((tab) => tab.textContent?.trim())).toContain('Container');
      http.expectNone('/projects/api/refinements/7/ensure-container');
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
    it('keeps container status out of Epic and mounts it on the Container tab', async () => {
      await open();

      expect(element().querySelector('app-status-strip')).toBeNull();
      tabs()
        .find((tab) => tab.textContent?.trim() === 'Container')!
        .click();
      await settle();

      expect(element().querySelector('app-status-strip')).not.toBeNull();
      expect(text()).toContain('Working tree');
      expect(text()).not.toContain('Resolution');
      expect(text()).not.toContain('Release');
      expect(text()).not.toContain('Integrate');
    });

    it('places a saved image at a chosen writing point in the epic markdown', async () => {
      await open();
      const paragraph = element().querySelector<HTMLElement>('app-epic-document .block')!;

      paragraph.dispatchEvent(
        new MouseEvent('contextmenu', { clientX: 250, clientY: 250, bubbles: true }),
      );
      await settle();
      element().querySelector<HTMLButtonElement>('[aria-label="Insert a saved image"]')!.click();
      await settle();
      http.expectOne('/projects/api/refinements/7/prompt-attachments').flush({
        attachments: [
          {
            id: 'image-1',
            mimeType: 'image/png',
            label: 'Sketch 1',
            source: 'SKETCH',
            createdAt: AT,
            dataBase64: 'cG5n',
          },
        ],
      });
      await settle();

      element().querySelector<HTMLButtonElement>('.insert')!.click();
      await settle();
      buttonNamed('Sketch 1').click();
      await settle();

      const update = http.expectOne('/projects/api/epics/e1');
      expect(update.request.method).toBe('PUT');
      expect(update.request.body.description).toBe(
        '![Sketch 1](/projects/api/refinements/7/prompt-attachments/image-1/content)\n\na third action on a **draft**',
      );
      update.flush({
        epic: {
          ...EPIC,
          description: update.request.body.description,
        },
      });
      await settle();

      expect(element().querySelector('app-epic-document img')?.getAttribute('src')).toBe(
        'data:image/png;base64,cG5n',
      );
    });

    it('sends a clicked epic paragraph to Chat with its source lines', async () => {
      await open();

      const paragraph = element().querySelector<HTMLElement>('app-epic-document .block')!;
      paragraph.click();
      await settle();
      expect(element().querySelector('.tab.active')?.textContent?.trim()).toBe('Epic');

      paragraph.dispatchEvent(
        new MouseEvent('contextmenu', { clientX: 250, clientY: 250, bubbles: true }),
      );
      await settle();
      element()
        .querySelector<HTMLButtonElement>('[aria-label="Attach this epic passage to chat"]')!
        .click();
      await settle();
      await answerChatPanel(
        JSON.stringify({ text: 'An existing draft', references: [], elements: [], epics: [] }),
      );

      expect(element().querySelector('.tab.active')?.textContent?.trim()).toBe('Chat');
      expect(text()).toContain('Epic: epic-refining-workspace');
      expect(text()).toContain('Lines: 1:1');
      expect(element().querySelector<HTMLTextAreaElement>('textarea.prompt')?.value).toBe(
        'An existing draft',
      );
    });

    it('keeps chat dormant on the epic, then mounts it when explicitly selected', async () => {
      await open();

      expect(element().querySelector('app-chat-panel')).toBeNull();

      tabs()
        .find((tab) => tab.textContent?.trim() === 'Chat')!
        .click();
      await settle();
      await answerChatPanel();

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
     * The sketch panel attaches to the **host's** workspace row rather than to a container, so the
     * only thing this wiring can get wrong is which workspace a drawing lands on.
     */
    it('builds the sketch panel on its tab, pointed at the resolved workspace row', async () => {
      await open();
      expect(element().querySelector('app-sketch-panel')).toBeNull();

      tabs()
        .find((tab) => tab.textContent?.trim() === 'Sketch')!
        .click();
      await settle();
      http.expectOne('/projects/api/refinements/7/prompt-attachments').flush({ attachments: [] });
      await settle();

      expect(element().querySelector('app-sketch-panel')).not.toBeNull();
    });

    it('builds the design panel on its tab, pointed at the resolved refinement', async () => {
      await open();
      expect(element().querySelector('app-design-panel')).toBeNull();

      tabs()
        .find((tab) => tab.textContent?.trim() === 'Design')!
        .click();
      await settle();
      http.expectOne('/projects/api/refinements/7/designs').flush({ designs: [] });
      await settle();

      expect(element().querySelector('app-design-panel')).not.toBeNull();
      expect(text()).toContain('Freeze a page from the Web view tab to start.');
    });

    /**
     * A freeze is a create and a jump, and the jump is the point: a capture that filed itself away
     * silently would leave the reader pressing Freeze twice to see whether it worked.
     */
    it('stores a frozen page as a design and opens it', async () => {
      await open();

      void page()['freezeIntoDesign']({
        html: '<!doctype html><html></html>',
        route: 'epics/e1',
        title: 'Epics',
        truncated: false,
      });
      await settle();

      const create = http.expectOne('/projects/api/refinements/7/designs');
      expect(create.request.method).toBe('POST');
      expect(create.request.body).toEqual({
        title: 'Epics',
        html: '<!doctype html><html></html>',
        sourceRoute: 'epics/e1',
        truncated: false,
      });
      create.flush(
        {
          id: 'd1',
          title: 'Epics',
          status: 'ACTIVE',
          basedOnDesignId: null,
          note: null,
          sourceRoute: 'epics/e1',
          htmlBytes: 26,
          truncated: false,
          createdBy: 'kim',
          createdAt: AT,
          updatedAt: AT,
        },
        { status: 201, statusText: 'Created' },
      );
      await settle();

      expect(TestBed.inject(Location).path()).toContain('tab=design');
      // The panel mounts on the jump and reads its own listing, which is where the new row appears.
      http.expectOne('/projects/api/refinements/7/designs').flush({
        designs: [
          {
            id: 'd1',
            title: 'Epics',
            status: 'ACTIVE',
            basedOnDesignId: null,
            note: null,
            sourceRoute: 'epics/e1',
            htmlBytes: 26,
            truncated: false,
            createdBy: 'kim',
            createdAt: AT,
            updatedAt: AT,
          },
        ],
      });
      await settle();
      http.expectOne('/projects/api/refinements/7/designs/d1').flush({
        id: 'd1',
        title: 'Epics',
        status: 'ACTIVE',
        basedOnDesignId: null,
        note: null,
        sourceRoute: 'epics/e1',
        htmlBytes: 26,
        truncated: false,
        createdBy: 'kim',
        createdAt: AT,
        updatedAt: AT,
        html: '<!doctype html><html></html>',
      });
      await settle();

      expect(element().querySelector('.tile.on')?.textContent).toContain('Epics');
    });

    it('builds the web view panel on its tab, reading the environment navigation', async () => {
      await open();

      tabs()
        .find((tab) => tab.textContent?.trim() === 'Web view')!
        .click();
      await settle();
      http.expectOne('/main-navigation').flush({ links: [] });
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
