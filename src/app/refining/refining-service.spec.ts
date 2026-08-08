import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { EpicDto, FeatureDto, RepositoryDto, TaskDto } from '../api/dto';
import type { EpicNode } from '../project/epics-model';
import { RefiningService, preamble, workspaceLabel } from './refining-service';

const AT = '2026-08-08T09:00:00Z';

const epic = (over: Partial<EpicDto> = {}): EpicDto => ({
  id: 'e1',
  projectId: 'p1',
  title: 'Epic refining workspace',
  slug: 'epic-refining-workspace',
  description: 'a third action on a draft',
  status: 'REFINING',
  supersededByEpicId: null,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const feature = (over: Partial<FeatureDto> = {}): FeatureDto => ({
  id: 'f1',
  epicId: 'e1',
  title: 'The branch rule',
  slug: 'the-branch-rule',
  description: null,
  dependsOnFeatureId: null,
  implementedOn: null,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const task = (over: Partial<TaskDto> = {}): TaskDto => ({
  id: 't1',
  featureId: 'f1',
  repositoryId: 'r1',
  title: 'Compose refining/<slug>',
  slug: 'compose-the-branch',
  description: null,
  dependsOnTaskId: null,
  implementedAt: null,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const repository = (id: string, over: Partial<RepositoryDto> = {}): RepositoryDto => ({
  id,
  name: id,
  backupUrl: null,
  mainBranch: 'main',
  archetype: 'PROJECT',
  projectId: 'p1',
  lastBackup: null,
  ...over,
});

const node = (over: Partial<EpicNode> = {}): EpicNode => ({
  epic: epic(),
  features: [],
  ...over,
});

const WORKSPACE = {
  id: 7,
  workspaceId: 'refining-epic-refining-workspace',
  branch: 'refining/epic-refining-workspace',
  status: 'ACTIVE',
};

const COMPONENTS_URL = '/projects/api/projects/p1/repositories';
const WORKSPACES_URL = '/workspaces/api/workspaces';
const CREATE_URL = '/workspaces/api/workspaces';

/**
 * The find-or-create flow, which is the one piece of this feature with no server-side owner.
 *
 * <p><b>The lookup is the whole association.</b> Nothing records which workspace refines which epic, so
 * the answer to "does this epic have one" is a branch match against the wrapper's ACTIVE workspaces —
 * and that has to be the same answer for both callers, the epic card's button and the page's own
 * resolve. A cached association between them is exactly the drift this design removes.
 *
 * <p><b>The two 409s look identical on the wire and are told apart by sequence, not by prose.</b> Every
 * qits service maps a domain exception through one `{"message": …}` envelope, so "branch already
 * exists" and "branch already has an active workspace" arrive as the same shape. Attempt two (adopt) is
 * the cure for the first and a re-read is the cure for the second, so the order of the attempts is what
 * classifies them — a wrong reading of the message cannot send the flow anywhere wrong. Those are the
 * three tests below, and they are the reason this is a service rather than a method on a page.
 */
describe('RefiningService', () => {
  let refining: RefiningService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    refining = TestBed.inject(RefiningService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /**
   * Let the whole promise chain land before looking for the next request.
   *
   * The flow is `await` after `await` — the wrapper read, then the listing, then the create — so a
   * single microtask turn is not enough: the request the next step issues does not exist yet.
   */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** The repositories listing, which carries the wrapper as a marked block beside the rows. */
  async function flushComponents(
    wrapperId: string | null = 'qits-qits',
    mainBranch = 'main',
  ): Promise<void> {
    http.expectOne(COMPONENTS_URL).flush({
      entries: [
        { repository: repository('qits-projects', { archetype: 'SERVICE', mainBranch: 'main' }) },
        ...(wrapperId ? [{ repository: repository(wrapperId, { mainBranch }) }] : []),
      ],
      wrapper: wrapperId ? { repositoryId: wrapperId, branch: mainBranch, entries: [] } : null,
    });
    await settle();
  }

  async function flushWorkspaces(entries: readonly unknown[] = []): Promise<void> {
    http
      .expectOne((candidate) => candidate.url === WORKSPACES_URL && candidate.method === 'GET')
      .flush({ entries: entries.map((workspace) => ({ workspace })) });
    await settle();
  }

  function create() {
    return http.expectOne(
      (candidate) => candidate.url === CREATE_URL && candidate.method === 'POST',
    );
  }

  const CONFLICT = { status: 409, statusText: 'Conflict' };

  describe('the wrapper', () => {
    it('takes the wrapper and its default branch from the one read that carries both', async () => {
      const answer = refining.wrapper('p1');
      await flushComponents('qits-qits', 'trunk');

      await expect(answer).resolves.toEqual({ repositoryId: 'qits-qits', mainBranch: 'trunk' });
    });

    /** No wrapper is nothing to branch on, so there is no plausible answer to invent. */
    it('refuses a project with no wrapper rather than guessing a repository', async () => {
      const answer = refining.wrapper('p1');
      await flushComponents(null);

      await expect(answer).rejects.toThrow('no wrapper repository');
    });
  });

  describe('finding the workspace', () => {
    it('matches on the composed branch and nothing else', async () => {
      const answer = refining.find('qits-qits', 'epic-refining-workspace');
      await flushWorkspaces([
        { ...WORKSPACE, id: 3, branch: 'epic/epic-refining-workspace' },
        { ...WORKSPACE, id: 4, branch: 'refining/something-else' },
        WORKSPACE,
      ]);

      await expect(answer).resolves.toMatchObject({ id: 7 });
    });

    it('answers null when nothing in the wrapper is on that branch', async () => {
      const answer = refining.find('qits-qits', 'epic-refining-workspace');
      await flushWorkspaces([{ ...WORKSPACE, branch: 'refining/other' }]);

      await expect(answer).resolves.toBeNull();
    });
  });

  describe('opening the refining workspace', () => {
    /** An existing workspace is the answer, and no create is attempted at all. */
    it('uses the workspace already on the branch without writing anything', async () => {
      const answer = refining.open('p1', node());
      await flushComponents();
      await flushWorkspaces([WORKSPACE]);

      await expect(answer).resolves.toMatchObject({ id: 7 });
      http.expectNone((candidate) => candidate.method === 'POST');
    });

    it('creates the branch itself, from the repository default, with the epic as its preamble', async () => {
      const answer = refining.open(
        'p1',
        node({ features: [{ feature: feature(), tasks: [task()] }] }),
      );
      await flushComponents();
      await flushWorkspaces();

      const request = create();
      expect(request.request.body).toEqual({
        repositoryId: 'qits-qits',
        id: 'refining-epic-refining-workspace',
        // Blank, not the word "main": the service knows the repository's default branch and no
        // repository on this platform promises to call it that.
        parent: '',
        branch: 'refining/epic-refining-workspace',
        preamble: expect.stringContaining('# Refine: Epic refining workspace') as string,
        // False is what makes this call create the ref — the only branch-creation mechanism there is.
        adoptExisting: false,
      });
      expect(request.request.body.preamble).toContain('The branch rule');
      expect(request.request.body.preamble).toContain('Compose refining/<slug>');

      request.flush({ workspace: WORKSPACE });
      await expect(answer).resolves.toMatchObject({ id: 7 });
    });

    /** What a discard leaves behind: the ref survives, the workspace does not. */
    it('adopts a branch that is already there, once, after the create is refused', async () => {
      const answer = refining.open('p1', node());
      await flushComponents();
      await flushWorkspaces();

      create().flush({ message: 'Branch already exists: refining/x' }, CONFLICT);
      await settle();

      const adopt = create();
      expect(adopt.request.body.adoptExisting).toBe(true);
      // Everything else is the same request, so the branch that is adopted is the one that was asked for.
      expect(adopt.request.body.branch).toBe('refining/epic-refining-workspace');
      adopt.flush({ workspace: WORKSPACE });

      await expect(answer).resolves.toMatchObject({ id: 7 });
    });

    /** Somebody else's create won the race between the two attempts; theirs is the answer. */
    it('re-reads and uses the workspace that won the race when the adopt is refused too', async () => {
      const answer = refining.open('p1', node());
      await flushComponents();
      await flushWorkspaces();

      create().flush({ message: 'Branch already exists' }, CONFLICT);
      await settle();
      create().flush({ message: 'Branch already has an active workspace' }, CONFLICT);
      await settle();

      await flushWorkspaces([{ ...WORKSPACE, id: 12 }]);

      await expect(answer).resolves.toMatchObject({ id: 12 });
    });

    /** If the re-read finds nothing either, the failure is reported rather than smoothed over. */
    it('rejects when both creates are refused and no workspace turns up', async () => {
      const answer = refining.open('p1', node());
      await flushComponents();
      await flushWorkspaces();

      create().flush({ message: 'Branch already exists' }, CONFLICT);
      await settle();
      create().flush({ message: 'nope' }, CONFLICT);
      await settle();
      await flushWorkspaces();

      await expect(answer).rejects.toMatchObject({ status: 409 });
    });

    /** Only a 409 is the branch-is-taken story. Anything else is the caller's to report. */
    it('does not retry a refusal that is not a conflict', async () => {
      const answer = refining.open('p1', node());
      await flushComponents();
      await flushWorkspaces();

      create().flush({ message: 'no such repository' }, { status: 404, statusText: 'Not Found' });

      await expect(answer).rejects.toMatchObject({ status: 404 });
      http.expectNone((candidate) => candidate.method === 'POST');
    });
  });

  describe('reading one epic by slug', () => {
    it('finds the epic the URL names and fans out to its features and tasks', async () => {
      const answer = refining.node('p1', 'epic-refining-workspace');
      http
        .expectOne('/projects/api/projects/p1/epics')
        .flush({ entries: [{ epic: epic({ id: 'e0', slug: 'other' }) }, { epic: epic() }] });
      await settle();
      http
        .expectOne('/projects/api/epics/e1/features')
        .flush({ entries: [{ feature: feature() }] });
      await settle();
      http.expectOne('/projects/api/features/f1/tasks').flush({ entries: [{ task: task() }] });

      const tree = await answer;
      expect(tree.epic.id).toBe('e1');
      expect(tree.features[0].tasks[0].id).toBe('t1');
    });

    it('says so when the project has no epic with that slug', async () => {
      const answer = refining.node('p1', 'not-a-thing');
      http.expectOne('/projects/api/projects/p1/epics').flush({ entries: [{ epic: epic() }] });

      await expect(answer).rejects.toThrow('no epic called');
    });
  });
});

/**
 * The label is decoration and the branch is the identity, which is what makes collapsing safe: a
 * character lost here costs nothing, where sending a slug qits-workspaces refuses costs a 400.
 */
describe('workspaceLabel', () => {
  it('prefixes the slug so the label says what the workspace is for', () => {
    expect(workspaceLabel('epic-refining-workspace')).toBe('refining-epic-refining-workspace');
  });

  it('collapses what the label charset does not allow, which a git-safe slug may still hold', () => {
    expect(workspaceLabel('v1.2/spike')).toBe('refining-v1-2-spike');
  });

  it('caps the label at the length the service accepts', () => {
    expect(workspaceLabel('x'.repeat(200))).toHaveLength(64);
  });
});

/**
 * The preamble is the workspace's stated goal and a **snapshot**: the refining session is about to
 * change the plan, so a preamble that tracked those changes would stop being the goal and become a
 * second, worse copy of the epics tree.
 */
describe('preamble', () => {
  it('leads with the epic, then the outline as it stands', () => {
    const text = preamble(
      node({
        features: [
          { feature: feature({ description: 'compose it, never store it' }), tasks: [task()] },
        ],
      }),
    );

    expect(text).toContain('# Refine: Epic refining workspace');
    expect(text).toContain('a third action on a draft');
    expect(text).toContain('- **The branch rule** — compose it, never store it');
    expect(text).toContain('  - Compose refining/<slug>');
  });

  it('says a draft is empty rather than leaving the space blank', () => {
    const text = preamble(node({ epic: epic({ description: null }) }));

    expect(text).toContain('_This draft has no description yet._');
    expect(text).toContain('_No features drafted yet._');
  });
});
