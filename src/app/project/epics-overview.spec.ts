import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { EpicDto, FeatureDto, TaskDto } from '../api/dto';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from '../api/event-source';
import { EpicsOverview } from './epics-overview';

/** The project's live channel, with every lifecycle moment turned into a method call. */
class FakeStream implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  close(): void {
    this.closed = true;
  }

  connect(): void {
    this.onopen?.(new Event('open'));
  }

  emit(topic: string): void {
    this.onmessage?.(new MessageEvent<string>('message', { data: topic }));
  }

  drop(): void {
    this.onerror?.(new Event('error'));
  }
}

const AT = '2026-08-08T09:00:00Z';

function epic(id: string, slug: string, over: Partial<EpicDto> = {}): EpicDto {
  return {
    id,
    projectId: 'p1',
    title: `Epic ${slug}`,
    slug,
    description: null,
    status: 'IMPLEMENTATION',
    supersededByEpicId: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function feature(id: string, slug: string, over: Partial<FeatureDto> = {}): FeatureDto {
  return {
    id,
    epicId: 'e1',
    title: `Feature ${slug}`,
    slug,
    description: null,
    dependsOnFeatureId: null,
    implementedOn: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function task(id: string, slug: string, over: Partial<TaskDto> = {}): TaskDto {
  return {
    id,
    featureId: 'f1',
    repositoryId: 'r1',
    title: `Task ${slug}`,
    slug,
    description: null,
    dependsOnTaskId: null,
    implementedAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

/**
 * The overview reads three levels to draw one tree, and the fan-out is what these tests are about:
 * a level that never arrives, or arrives for the project the reader has already left, is the way
 * this panel goes wrong while still looking fine.
 */
describe('EpicsOverview', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<EpicsOverview>;
  let streams: FakeStream[];

  beforeEach(() => {
    streams = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
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
  });

  async function mount(projectId = 'p1'): Promise<void> {
    fixture = TestBed.createComponent(EpicsOverview);
    fixture.componentRef.setInput('projectId', projectId);
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await fixture.whenStable();
    }
  }

  async function flushEpics(epics: readonly EpicDto[], projectId = 'p1'): Promise<void> {
    http
      .expectOne(`/projects/api/projects/${projectId}/epics`)
      .flush({ entries: epics.map((value) => ({ epic: value })) });
    await settle();
  }

  async function flushFeatures(epicId: string, features: readonly FeatureDto[]): Promise<void> {
    http
      .expectOne(`/projects/api/epics/${epicId}/features`)
      .flush({ entries: features.map((value) => ({ feature: value })) });
    await settle();
  }

  async function flushTasks(featureId: string, tasks: readonly TaskDto[]): Promise<void> {
    http
      .expectOne(`/projects/api/features/${featureId}/tasks`)
      .flush({ entries: tasks.map((value) => ({ task: value })) });
    await settle();
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent ?? '';
  }

  function branches(): string[] {
    return Array.from(element().querySelectorAll('.branch')).map(
      (node) => node.textContent?.trim() ?? '',
    );
  }

  function badges(): string[] {
    return Array.from(element().querySelectorAll('.qits-badge')).map(
      (node) => node.textContent?.trim() ?? '',
    );
  }

  /** The section headings, open ones and collapsed ones alike, in the order they are drawn. */
  function sections(): string[] {
    return Array.from(element().querySelectorAll('.group > h3, .group > summary')).map(
      (node) => node.textContent?.trim() ?? '',
    );
  }

  function buttonNamed(label: string): HTMLButtonElement {
    const found = Array.from(element().querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === label,
    );
    expect(found, `no button named “${label}”`).toBeTruthy();
    return found as HTMLButtonElement;
  }

  /** One epic, two features, tasks on one of them — the whole fan-out, in one tree. */
  async function loadTree(): Promise<void> {
    await mount();
    await flushEpics([epic('e1', 'epics-overview')]);
    await flushFeatures('e1', [
      feature('f1', 'read-the-epics', { implementedOn: AT }),
      feature('f2', 'draw-the-cards'),
    ]);
    await flushTasks('f1', [
      task('t1', 'add-the-endpoints', { implementedAt: AT }),
      task('t2', 'assemble-the-tree'),
    ]);
    await flushTasks('f2', []);
  }

  /** One epic in every phase, including the derived one — the whole grouped screen at once. */
  async function loadGroups(): Promise<void> {
    await mount();
    await flushEpics([
      epic('e1', 'draft', { status: 'REFINING', description: 'a plan still being written' }),
      epic('e2', 'running'),
      epic('e3', 'finished'),
      epic('e4', 'old', { status: 'SUPERSEDED', supersededByEpicId: 'e1' }),
      epic('e5', 'dropped', { status: 'ABANDONED' }),
    ]);
    await flushFeatures('e1', [feature('f1', 'draft-feature', { description: 'what it will do' })]);
    await flushFeatures('e2', [feature('f2', 'running-feature')]);
    await flushFeatures('e3', [feature('f3', 'done-feature', { implementedOn: AT })]);
    await flushFeatures('e4', []);
    await flushFeatures('e5', []);
    await flushTasks('f1', [task('t1', 'draft-task', { description: 'the detail' })]);
    await flushTasks('f2', []);
    await flushTasks('f3', []);
  }

  it('draws the tree in plan order, with the branch each line belongs on', async () => {
    await loadTree();

    expect(branches()).toEqual([
      'epic/epics-overview',
      'feature/epics-overview/read-the-epics',
      'task/epics-overview/read-the-epics/add-the-endpoints',
      'task/epics-overview/read-the-epics/assemble-the-tree',
      'feature/epics-overview/draw-the-cards',
    ]);
  });

  it('badges each level, and the epic from the features under it', async () => {
    await loadTree();

    // The epic's badge first, then the rows: one implemented feature, its two tasks, one open one.
    expect(badges()).toEqual(['in progress', 'implemented', 'implemented', 'open', 'open']);
    expect(element().querySelector('.qits-badge')?.className).toContain('qits-badge-info');
  });

  /** A feature nobody has broken down is a single row, not an empty list. */
  it('draws a feature with no tasks as one row', async () => {
    await loadTree();

    expect(text()).toContain('Feature draw-the-cards');
    expect(branches().filter((branch) => branch.startsWith('task/'))).toHaveLength(2);
  });

  /** There is no comparison view yet, so the card says so rather than offering a dead link. */
  it('names what a comparison would show without linking anywhere', async () => {
    await loadTree();

    const compare = element().querySelector('.compare');
    expect(compare?.textContent).toContain('comparison unavailable');
    expect(compare?.getAttribute('title')).toBe(
      'Commits on epic/epics-overview compared to main. The comparison view is not built yet.',
    );
    expect(element().querySelectorAll('a')).toHaveLength(0);
  });

  /**
   * An epic under implementation carries the same markdown description it had as a draft, so the
   * summary line renders it. The rows below are titles and stay text.
   */
  it('renders the epic’s description as markdown on the summary line', async () => {
    await mount();
    await flushEpics([epic('e1', 'shipping', { description: 'A public **status page**.' })]);
    await flushFeatures('e1', []);
    const card = element().querySelector('app-epic-card');

    expect(card?.querySelector('.summary strong')?.textContent).toBe('status page');
    expect(card?.textContent).not.toContain('**');
  });

  it('says so plainly when the project has no epics', async () => {
    await mount();
    await flushEpics([]);

    expect(text()).toContain('This project has no epics yet.');
    expect(element().querySelector('app-epic-card')).toBeNull();
  });

  /** One state for the whole fan-out, so one failure and one retry that starts it again. */
  it('reports a failure and re-reads the whole tree on retry', async () => {
    await mount();
    http
      .expectOne('/projects/api/projects/p1/epics')
      .flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('Could not load the epics — 503');

    element().querySelector('button')?.click();
    await settle();

    await flushEpics([epic('e1', 'epics-overview')]);
    await flushFeatures('e1', []);
    expect(text()).toContain('Epic epics-overview');
  });

  it('drops a level that fails part-way through rather than drawing half a tree', async () => {
    await mount();
    await flushEpics([epic('e1', 'epics-overview')]);
    http.expectOne('/projects/api/epics/e1/features').flush(null, { status: 500, statusText: 'x' });
    await settle();

    expect(text()).toContain('Could not load the epics — 500');
    expect(element().querySelector('app-epic-card')).toBeNull();
  });

  /** The instance is re-used across a project hop, so the read has to follow the input. */
  it('re-reads when the page moves to another project', async () => {
    await loadTree();

    fixture.componentRef.setInput('projectId', 'p2');
    await settle();

    await flushEpics([epic('e9', 'other-plan')], 'p2');
    await flushFeatures('e9', []);

    expect(text()).not.toContain('epics-overview');
    expect(branches()).toEqual(['epic/other-plan']);
  });

  /**
   * The grouping is the panel's shape, and "done" is the part of it nothing on the wire says: an
   * epic reaches it by having its last feature implemented, not by anyone pressing anything.
   */
  describe('grouped by lifecycle', () => {
    it('draws the five sections in the order a reader works down them', async () => {
      await loadGroups();

      expect(sections()).toEqual([
        'Refining',
        'Implementation',
        'Done (1)',
        'Superseded (1)',
        'Abandoned (1)',
      ]);
    });

    it('puts every epic in exactly one section', async () => {
      await loadGroups();

      expect(element().querySelectorAll('app-epic-draft-card')).toHaveLength(1);
      // The implementation card is drawn for the running epic and the finished one.
      expect(element().querySelectorAll('app-epic-card')).toHaveLength(2);
      expect(element().querySelectorAll('app-epic-summary-row')).toHaveLength(2);
    });

    /** The record is collapsed; the work is not, so neither is behind a click. */
    it('collapses the record sections and leaves the work sections open', async () => {
      await loadGroups();

      const disclosures = Array.from(element().querySelectorAll('details'));
      expect(disclosures).toHaveLength(3);
      expect(disclosures.every((node) => !node.open)).toBe(true);
    });

    it('leaves out a record section the project has nothing in', async () => {
      await loadTree();

      expect(element().querySelectorAll('details')).toHaveLength(0);
      expect(sections()).toEqual(['Refining', 'Implementation']);
    });

    /** An empty work section is a fact, not blank space. */
    it('says an always-visible section is empty rather than drawing nothing', async () => {
      await loadTree();

      expect(text()).toContain('No epic is being drafted.');
      expect(text()).not.toContain('No epic is being implemented.');
    });

    it('keeps the overall empty message for a project with no epics at all', async () => {
      await mount();
      await flushEpics([]);

      expect(text()).toContain('This project has no epics yet.');
      expect(sections()).toEqual([]);
    });
  });

  describe('the draft card', () => {
    it('leads with the description and outlines the features and tasks', async () => {
      await loadGroups();
      const draft = element().querySelector('app-epic-draft-card');

      expect(draft?.textContent).toContain('a plan still being written');
      expect(draft?.textContent).toContain('Feature draft-feature');
      expect(draft?.textContent).toContain('what it will do');
      expect(draft?.textContent).toContain('Task draft-task');
      expect(draft?.textContent).toContain('the detail');
    });

    /**
     * The bug this pins. Every description on the three levels is markdown, and the card used to
     * print it verbatim — `## Status page A public **status page**…`, the plan read out as
     * punctuation.
     */
    it('renders the markdown in the description and in the outline’s notes', async () => {
      await mount();
      await flushEpics([
        epic('e1', 'draft', {
          status: 'REFINING',
          description: '## Status page\n\nA public **status page** for `qits-ci`.',
        }),
      ]);
      await flushFeatures('e1', [
        feature('f1', 'draft-feature', { description: 'ships **daily**' }),
      ]);
      await flushTasks('f1', []);
      const draft = element().querySelector('app-epic-draft-card');

      expect(draft?.querySelector('h2')?.textContent).toBe('Status page');
      expect(draft?.querySelector('.description strong')?.textContent).toBe('status page');
      expect(draft?.querySelector('.description code')?.textContent).toBe('qits-ci');
      expect(draft?.querySelector('.note strong')?.textContent).toBe('daily');
      expect(draft?.textContent).not.toContain('##');
      expect(draft?.textContent).not.toContain('**');
    });

    /** Nothing is frozen and nothing is implemented, so there is no branch and no row status. */
    it('names no branches and badges no rows', async () => {
      await loadGroups();
      const draft = element().querySelector('app-epic-draft-card');

      expect(draft?.querySelectorAll('.branch')).toHaveLength(0);
      expect(draft?.querySelectorAll('.qits-badge')).toHaveLength(1);
      expect(draft?.querySelector('.qits-badge')?.textContent?.trim()).toBe('refining');
    });
  });

  describe('the terminal rows', () => {
    it('draws a dropped epic as one row with a tone of its own', async () => {
      await loadGroups();
      const rows = Array.from(element().querySelectorAll('app-epic-summary-row'));

      expect(rows[1].textContent).toContain('Epic dropped');
      expect(rows[1].querySelector('.qits-badge')?.textContent?.trim()).toBe('abandoned');
      expect(rows[1].querySelector('.qits-badge')?.className).toContain('qits-badge-danger');
    });

    it('links a superseded epic to the draft that replaced it', async () => {
      await loadGroups();
      const link = element().querySelector('a.successor');

      expect(link?.textContent).toContain('superseded by Epic draft');
      expect(link?.getAttribute('href')).toBe('#epic-e1');
      // The anchor is a card on this same screen, not a promise.
      expect(element().querySelector('#epic-e1')).not.toBeNull();
    });
  });

  describe('transitions', () => {
    it('freezes a draft on one press and re-reads the whole tree', async () => {
      await loadGroups();

      buttonNamed('Start implementation').click();
      await settle();

      const request = http.expectOne('/projects/api/epics/e1/transition');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ target: 'IMPLEMENTATION' });
      request.flush({ epic: epic('e1', 'draft'), successor: null });
      await settle();

      // The answer is not spliced in — the panel reads the tree again.
      await flushEpics([epic('e1', 'draft')]);
      await flushFeatures('e1', []);

      expect(branches()).toEqual(['epic/draft']);
      expect(element().querySelector('app-epic-draft-card')).toBeNull();
    });

    /** Superseding throws a plan away, so the button asks first — in itself, not in a dialog. */
    it('asks once before superseding, and sends nothing until it is answered', async () => {
      await loadGroups();

      buttonNamed('Supersede').click();
      await settle();
      http.expectNone('/projects/api/epics/e2/transition');

      buttonNamed('Confirm supersede?').click();
      await settle();

      const request = http.expectOne('/projects/api/epics/e2/transition');
      expect(request.request.body).toEqual({ target: 'SUPERSEDED' });
      request.flush({
        epic: epic('e2', 'running', { status: 'SUPERSEDED', supersededByEpicId: 'e9' }),
        successor: epic('e9', 'running', { status: 'REFINING' }),
      });
      await settle();

      http.expectOne('/projects/api/projects/p1/epics');
    });

    it('holds every button while a move is in flight', async () => {
      await loadGroups();

      buttonNamed('Start implementation').click();
      await settle();

      expect(Array.from(element().querySelectorAll('button')).every((node) => node.disabled)).toBe(
        true,
      );
    });

    it('offers refine ahead of the freeze on a draft, and not on an implementation epic', async () => {
      await loadGroups();
      const labels = (selector: string) =>
        Array.from(element().querySelectorAll(`${selector} button`)).map((node) =>
          node.textContent?.trim(),
        );

      expect(labels('#epic-e1')).toEqual(['Refine', 'Start implementation', 'Abandon']);
      expect(labels('#epic-e2')).toEqual(['Mark implemented', 'Supersede', 'Abandon']);
    });

    /** A refused move changed nothing, so the tree stays and the server's sentence sits beside it. */
    it('surfaces a refused move next to the epic and leaves the tree alone', async () => {
      await loadGroups();

      buttonNamed('Start implementation').click();
      await settle();
      http
        .expectOne('/projects/api/epics/e1/transition')
        .flush(
          { message: 'an epic with no features cannot be frozen' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(element().querySelector('#epic-e1')?.textContent).toContain(
        'Could not move this epic — 409 an epic with no features cannot be frozen.',
      );
      http.expectNone('/projects/api/projects/p1/epics');
      expect(element().querySelector('app-epic-draft-card')).not.toBeNull();
    });
  });

  /**
   * Refine is a press on the same row as the transitions and almost nothing else about it is the same:
   * it moves no epic, it writes to a different service, and it ends in a navigation. The two things it
   * *does* share are the two worth asserting — the busy state that holds every other button, and the
   * failure pinned beside the card it is about.
   */
  describe('refining a draft', () => {
    it('starts a workspace on refining/<slug> in the wrapper, then goes to the refining page', async () => {
      await loadGroups();
      const router = TestBed.inject(Router);
      const went: string[] = [];
      vi.spyOn(router, 'navigate').mockImplementation(async (commands: readonly unknown[]) => {
        went.push(commands.join('/'));
        return true;
      });

      buttonNamed('Refine').click();
      await settle();

      // One idempotent POST keyed by the epic — the branch cut, the wrapper resolution and the
      // adopt-existing dance are qits-projects' business now.
      const create = http.expectOne(
        (request) => request.method === 'POST' && request.url === '/projects/api/refinements',
      );
      expect(create.request.body).toEqual({ epicId: 'e1' });
      create.flush({
        refinement: { id: 7, epicId: 'e1', branch: 'refining/draft', label: 'refining-draft' },
      });
      await settle();

      expect(went).toEqual(['p1/epics/draft/refining']);
      // Nothing about the epic changed, so the tree is not re-read.
      http.expectNone('/projects/api/projects/p1/epics');
    });

    it('holds every button while the workspace is being started', async () => {
      await loadGroups();

      buttonNamed('Refine').click();
      await settle();

      expect(Array.from(element().querySelectorAll('button')).every((node) => node.disabled)).toBe(
        true,
      );
    });

    /** A project with no wrapper has nothing to branch on, and that lands beside the card. */
    it('pins the reason beside the card when there is nowhere to cut the branch', async () => {
      await loadGroups();

      buttonNamed('Refine').click();
      await settle();
      http
        .expectOne('/projects/api/refinements')
        .flush(
          { message: 'Project p1 has no wrapper repository (demo-demo), so there is nothing to refine against.' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(element().querySelector('#epic-e1')?.textContent).toContain(
        'no wrapper repository',
      );
      expect(element().querySelector('app-epic-draft-card')).not.toBeNull();
    });
  });

  /**
   * A refinement agent changes these epics while the reader watches, so the panel has to re-read
   * without being asked — and the whole difficulty is doing that *quietly*. A hint fires on every
   * agent step; a panel that blanked itself for each one would flash for as long as the agent
   * worked, and would say "unknown" about a tree it is still holding.
   */
  describe('live updates', () => {
    it('opens one channel for the project it is showing', async () => {
      await loadTree();

      expect(streams.map((stream) => stream.url)).toEqual(['/projects/api/projects/p1/events']);
    });

    it('re-reads on a hint and never shows the loading state while it does', async () => {
      await loadTree();

      streams[0].emit('epics');
      await settle();

      // The old tree is still on screen while the new one assembles: no blank, no flash.
      expect(element().querySelector('.async-loading')).toBeNull();
      expect(text()).toContain('Epic epics-overview');

      await flushEpics([epic('e1', 'epics-overview'), epic('e2', 'new-plan')]);
      await flushFeatures('e1', []);
      await flushFeatures('e2', []);

      expect(branches()).toEqual(['epic/epics-overview', 'epic/new-plan']);
    });

    /** No replay protocol exists, so a reconnect has to assume it missed everything. */
    it('re-reads on a connect, because the gap it closes is one it cannot see', async () => {
      await loadTree();

      streams[0].connect();
      await settle();

      await flushEpics([epic('e2', 'new-plan')]);
      await flushFeatures('e2', []);

      expect(branches()).toEqual(['epic/new-plan']);
    });

    it('asks for nothing on the heartbeat, on another panel’s topic, or on a topic it never heard of', async () => {
      await loadTree();

      streams[0].emit('ping');
      streams[0].emit('agent-activity');
      streams[0].emit('a-topic-from-a-newer-service');
      await settle();

      http.expectNone('/projects/api/projects/p1/epics');
    });

    it('moves the channel to the new project when the page hops', async () => {
      await loadTree();

      fixture.componentRef.setInput('projectId', 'p2');
      await settle();
      await flushEpics([epic('e9', 'other-plan')], 'p2');
      await flushFeatures('e9', []);

      expect(streams.map((stream) => stream.url)).toEqual([
        '/projects/api/projects/p1/events',
        '/projects/api/projects/p2/events',
      ]);
      expect(streams[0].closed).toBe(true);
    });

    /** A hint's read that failed leaves the panel a moment old, which is what it already was. */
    it('keeps the tree standing when a hint’s re-read fails', async () => {
      await loadTree();

      streams[0].emit('epics');
      await settle();
      http
        .expectOne('/projects/api/projects/p1/epics')
        .flush(null, { status: 503, statusText: 'Down' });
      await settle();

      expect(text()).toContain('Epic epics-overview');
      expect(text()).not.toContain('Could not load the epics');
    });

    /** Only the hint's read is forgiving. A read the page asked for still says what happened. */
    it('still blanks and reports a failure on a read the page asked for', async () => {
      await loadTree();

      fixture.componentRef.setInput('projectId', 'p2');
      await settle();
      http
        .expectOne('/projects/api/projects/p2/epics')
        .flush(null, { status: 503, statusText: 'Down' });
      await settle();

      expect(text()).toContain('Could not load the epics — 503');
      expect(element().querySelector('app-epic-card')).toBeNull();
    });

    it('says it is behind only once it has been current', async () => {
      await loadTree();
      expect(element().querySelector('.behind')).toBeNull();

      // A channel that never came up is not something the reader can be behind.
      streams[0].drop();
      await settle();
      expect(element().querySelector('.behind')).toBeNull();

      streams[0].connect();
      await settle();
      await flushEpics([epic('e1', 'epics-overview')]);
      await flushFeatures('e1', []);
      expect(element().querySelector('.behind')).toBeNull();

      streams[0].drop();
      await settle();

      expect(element().querySelector('.behind')?.textContent).toContain('briefly behind');
      // The plan itself stays exactly where it was — the marker shares the heading's line.
      expect(branches()).toEqual(['epic/epics-overview']);
    });
  });
});
