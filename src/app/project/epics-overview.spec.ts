import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { EpicDto, FeatureDto, TaskDto } from '../api/dto';
import { EpicsOverview } from './epics-overview';

const AT = '2026-08-08T09:00:00Z';

function epic(id: string, slug: string, over: Partial<EpicDto> = {}): EpicDto {
  return {
    id,
    projectId: 'p1',
    title: `Epic ${slug}`,
    slug,
    description: null,
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

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
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
});
