import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { RefinementDto } from '../api/refinements-api';
import type { EpicNode } from '../project/epics-model';
import { RefiningService } from './refining-service';

const AT = '2026-08-08T09:00:00Z';

const EPIC = {
  id: 'e1',
  projectId: 'p1',
  title: 'Sharper onboarding',
  slug: 'sharper-onboarding',
  description: 'a draft',
  status: 'REFINING' as const,
  supersededByEpicId: null,
  createdAt: AT,
  updatedAt: AT,
};

const REFINEMENT: RefinementDto = {
  id: 7,
  epicId: 'e1',
  projectId: 'p1',
  repositoryId: 'qits-qits',
  branch: 'refining/sharper-onboarding',
  parent: 'main',
  label: 'refining-sharper-onboarding',
  preamble: '# Refine: Sharper onboarding',
  runtimeStatus: null,
  runtimeError: null,
  clean: null,
  ahead: null,
  behind: null,
  conflictsWithParent: false,
  agentActivity: null,
  daemonConnectedAt: null,
  daemonVersion: null,
  daemonOutdated: null,
  createdAt: AT,
};

const node = (): EpicNode => ({ epic: EPIC, features: [] });

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) {
    await Promise.resolve();
  }
};

/**
 * Starting and finding the refinement an epic is refined in — and how little of it is left here.
 *
 * The 409/adopt-existing choreography, the label rule, the preamble builder and the wrapper
 * resolution all moved server-side when refinement moved into qits-projects: the open is one
 * idempotent POST keyed by the epic id, and the find is a list read that never creates. What is
 * worth pinning is exactly that — which requests go out, and that the find creates nothing.
 */
describe('RefiningService', () => {
  let http: HttpTestingController;
  let refining: RefiningService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    refining = TestBed.inject(RefiningService);
  });

  afterEach(() => http.verify());

  describe('finding the refinement', () => {
    it('matches the epic in the project listing and writes nothing', async () => {
      const answer = refining.find('p1', 'e1');
      const request = http.expectOne('/projects/api/projects/p1/refinements');
      expect(request.request.method).toBe('GET');
      request.flush({ refinements: [REFINEMENT] });
      expect(await answer).toEqual(REFINEMENT);
    });

    it('answers null when no refinement is on that epic', async () => {
      const answer = refining.find('p1', 'e-other');
      http.expectOne('/projects/api/projects/p1/refinements').flush({ refinements: [REFINEMENT] });
      expect(await answer).toBeNull();
    });
  });

  describe('opening the refinement', () => {
    it('is one idempotent POST keyed by the epic id', async () => {
      const answer = refining.open(node());
      const request = http.expectOne('/projects/api/refinements');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ epicId: 'e1' });
      request.flush({ refinement: REFINEMENT });
      expect(await answer).toEqual(REFINEMENT);
    });

    it('opens from a slug by resolving the epic first', async () => {
      const answer = refining.openBySlug('p1', 'sharper-onboarding');
      http.expectOne('/projects/api/projects/p1/epics').flush({ entries: [{ epic: EPIC }] });
      await settle();
      http.expectOne('/projects/api/epics/e1/features').flush({ entries: [] });
      await settle();
      http.expectOne('/projects/api/refinements').flush({ refinement: REFINEMENT });
      expect(await answer).toEqual(REFINEMENT);
    });
  });

  describe('reading one epic by slug', () => {
    it('finds the epic the URL names and fans out to its features and tasks', async () => {
      const answer = refining.node('p1', 'sharper-onboarding');
      http.expectOne('/projects/api/projects/p1/epics').flush({ entries: [{ epic: EPIC }] });
      await settle();
      http
        .expectOne('/projects/api/epics/e1/features')
        .flush({ entries: [{ feature: { id: 'f1', epicId: 'e1', title: 'F', slug: 'f', description: null, dependsOnFeatureId: null, implementedOn: null, createdAt: AT, updatedAt: AT } }] });
      await settle();
      http.expectOne('/projects/api/features/f1/tasks').flush({ entries: [] });
      const resolved = await answer;
      expect(resolved.epic.id).toBe('e1');
      expect(resolved.features).toHaveLength(1);
    });

    it('says so when the project has no epic with that slug', async () => {
      const answer = refining.node('p1', 'unknown');
      http.expectOne('/projects/api/projects/p1/epics').flush({ entries: [{ epic: EPIC }] });
      await expect(answer).rejects.toThrowError(/no epic called/);
    });
  });
});
