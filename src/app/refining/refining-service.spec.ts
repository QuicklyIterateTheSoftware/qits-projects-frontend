import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { EpicDto, TicketDto } from '../api/dto';
import type { RefinementDto } from '../api/refinements-api';
import { workAnswer } from '../../testing/work-fixtures';
import { RefiningService } from './refining-service';

const AT = '2026-08-08T09:00:00Z';

const EPIC: EpicDto = {
  id: 'e1',
  projectId: 'p1',
  title: 'Sharper onboarding',
  slug: 'sharper-onboarding',
  description: 'a draft',
  number: 3,
  qualifiedId: 'qits-3',
  status: 'REPORTED',
  supersededByEpicId: null,
  createdAt: AT,
  updatedAt: AT,
  workspaces: [],
};

const TICKET: TicketDto = {
  id: 't1',
  projectId: 'p1',
  title: 'The badge is wrong',
  slug: 'the-badge-is-wrong',
  number: 4,
  qualifiedId: 'qits-4',
  type: 'BUG',
  status: 'REPORTED',
  assignee: null,
  createdBy: 'kim',
  impetus: 'The badge reads as success when a run is cancelled.',
  description: null,
  createdAt: AT,
  updatedAt: AT,
  workspaces: [],
};

const REFINEMENT: RefinementDto = {
  id: 7,
  entityId: 't1',
  projectId: 'p1',
  repositoryId: 'qits-qits',
  branch: 'refining/the-badge-is-wrong',
  parent: 'main',
  label: 'refining-the-badge-is-wrong',
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

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) {
    await Promise.resolve();
  }
};

/**
 * Finding and opening an entity's refinement room (qits-395): both through the entity's own door,
 * for an epic and a ticket alike, and never through the retired `POST /refinements {"epicId"}`.
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

  it('opens a room through the entity door, with no body', async () => {
    const opened = refining.open('qits-4');
    const request = http.expectOne('/projects/api/work/qits-4/refinement');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    request.flush({ refinement: REFINEMENT });

    expect((await opened).entityId).toBe('t1');
    expect(http.match('/projects/api/refinements')).toEqual([]);
  });

  it('finds a room with a GET on the same door, which never creates', async () => {
    const found = refining.find('qits-3');
    const request = http.expectOne('/projects/api/work/qits-3/refinement');
    expect(request.request.method).toBe('GET');
    request.flush({ refinement: null });

    expect(await found).toBeNull();
  });

  it('resolves a number to its node across the project’s epics and tickets', async () => {
    const resolved = refining.resolve('p1', 4);
    for (let round = 0; round < 3; round += 1) {
      await settle();
      for (const request of http.match(() => true)) {
        request.flush(
          workAnswer('p1', { epics: [EPIC], tickets: [TICKET] }, request.request.url) as object,
        );
      }
    }

    const { node, nodes } = await resolved;
    expect(node?.id).toBe('t1');
    expect(node?.archetype).toBe('TICKET');
    expect(nodes.map((each) => each.number)).toEqual([3, 4]);
  });

  it('answers a null node for a number the project does not hold', async () => {
    const resolved = refining.resolve('p1', 99);
    http.expectOne('/projects/api/projects/p1/work').flush({ entities: [] });

    expect((await resolved).node).toBeNull();
  });
});
