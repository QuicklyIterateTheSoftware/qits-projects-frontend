import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideQitsNavigationTree, type QitsNavigation } from '@qits/ui-components';
import type { ReleaseQualityGateDto, ReleaseRequestDto } from '../api/dto';
import { ReleaseDeployHold } from './release-deploy-hold';

const HOLD = '/projects/api/repositories/repo-ci/release-requests/r1/deploy-hold';

const PLATFORM: QitsNavigation = {
  environment: 'dev',
  origin: 'https://dev.example.test',
  slots: {
    'services.details': [
      {
        app: 'qits-deployments',
        label: 'Deployments',
        host: 'deployments.dev.example.test',
        origin: 'https://deployments.dev.example.test',
      },
    ],
  },
};

function request(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
  return {
    id: 'r1',
    repoId: 'repo-ci',
    repoName: 'qits-ci',
    backingBranch: 'release/r1',
    sources: [],
    mergedSha: '20c377ee71fabe6f32429d1506989efecec7798b',
    state: 'PENDING',
    summary: 'A change worth releasing',
    requester: 'someone',
    detail: null,
    conflict: null,
    version: null,
    releasedSha: null,
    mergedToMainAt: null,
    retryable: false,
    deployHold: false,
    deployHoldBy: null,
    deployHoldAt: null,
    createdAt: '2026-09-01T13:34:59.888Z',
    updatedAt: '2026-09-01T13:34:59.888Z',
    ...overrides,
  };
}

const HELD_DETAIL =
  'Deploy of 2026.904.161524 held for approval: qits deployments requests approve --request dr-42';

function deploymentGate(overrides: Partial<ReleaseQualityGateDto> = {}): ReleaseQualityGateDto {
  return {
    kind: 'deployment-not-rolled-back',
    state: 'PENDING',
    detail: HELD_DETAIL,
    ...overrides,
  };
}

function releasedAndHeld(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
  return request({
    state: 'RELEASED',
    version: '2026.904.161524',
    deployHold: true,
    deployHoldBy: 'dana.weber',
    deployHoldAt: '2026-09-01T13:40:00Z',
    qualityGates: [deploymentGate()],
    ...overrides,
  });
}

/**
 * The deploy-hold switch and the held-deploy note (qits-2268).
 *
 * <p>Three things are pinned. **Where the switch is live** — exactly the four states the door takes,
 * and inert rather than gone everywhere else. **The write** — a `PUT` of `{ hold }` whose answer is
 * emitted whole, and a 409 drawn in the service's own words with the box put back. **The note** —
 * drawn only while a released request's deployment gate says it is held, linking the deployment
 * request the sentence names.
 */
describe('ReleaseDeployHold', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ReleaseDeployHold>;
  let answered: ReleaseRequestDto[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationTree(PLATFORM),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    answered = [];
  });

  afterEach(() => http.verify());

  async function mount(row: ReleaseRequestDto): Promise<void> {
    fixture = TestBed.createComponent(ReleaseDeployHold);
    fixture.componentRef.setInput('request', row);
    fixture.componentRef.setInput('project', 'qits');
    fixture.componentInstance.changed.subscribe((request) => answered.push(request));
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await fixture.whenStable();
    }
    fixture.detectChanges();
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function box(): HTMLInputElement {
    const input = element().querySelector<HTMLInputElement>('input[type=checkbox]');
    if (!input) throw new Error('no deploy-hold switch drawn');
    return input;
  }

  async function click(): Promise<void> {
    box().click();
    await settle();
  }

  describe('where it is offered', () => {
    it('draws nothing against a service that does not report the field', async () => {
      await mount(request({ deployHold: undefined }));

      expect(element().querySelector('.deploy-hold')).toBeNull();
    });

    it('is live in every state the door takes a switch in', async () => {
      for (const state of ['PENDING', 'READY', 'REJECTED', 'CONFLICTED']) {
        await mount(request({ state }));

        expect(box().disabled).toBe(false);
        expect(element().textContent).toContain('Hold deploy for approval');
      }
    });

    /** FAILED takes the other verbs, but the hold is read at release and the door refuses it. */
    it('is inert, and still says what was chosen, everywhere else', async () => {
      for (const state of ['FAILED', 'RELEASED', 'FINALIZED', 'WITHDRAWN', 'OBSOLETE']) {
        await mount(request({ state, deployHold: true }));

        expect(box().disabled).toBe(true);
        expect(box().checked).toBe(true);
      }
    });

    it('names who switched it last, off as well as on', async () => {
      await mount(request({ deployHoldBy: 'dev', deployHoldAt: '2026-09-01T13:40:00Z' }));

      expect(element().querySelector('.who')?.textContent).toContain('switched off by dev');
    });

    it('names nobody on a request nobody has switched', async () => {
      await mount(request());

      expect(element().querySelector('.who')).toBeNull();
    });
  });

  describe('switching it', () => {
    it('puts the hold and hands back the whole answered request', async () => {
      await mount(request());

      await click();
      const put = http.expectOne(HOLD);
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({ hold: true });
      expect(box().disabled).toBe(true);

      const switched = request({ deployHold: true, deployHoldBy: 'dev' });
      put.flush({ request: switched });
      await settle();

      expect(answered).toEqual([switched]);
      expect(box().disabled).toBe(false);
    });

    it('puts hold false to release a hold', async () => {
      await mount(request({ deployHold: true }));

      await click();
      const put = http.expectOne(HOLD);
      expect(put.request.body).toEqual({ hold: false });
      put.flush({ request: request() });
      await settle();
    });

    /** A page that went stale under the reader: the service's sentence, and the box put back. */
    it('reports the refusal in the service’s words and puts the box back', async () => {
      await mount(request());

      await click();
      http.expectOne(HOLD).flush(
        {
          message:
            'Release request qits-ci-rr-1 is already RELEASED: a deploy hold must be set before ' +
            'the request releases.',
        },
        { status: 409, statusText: 'Conflict' },
      );
      await settle();

      expect(element().querySelector('.failed')?.textContent).toContain(
        'a deploy hold must be set before the request releases',
      );
      expect(box().checked).toBe(false);
      expect(answered).toEqual([]);
    });
  });

  describe('a held deploy', () => {
    it('says so and links the deployment request the gate names', async () => {
      await mount(releasedAndHeld());

      expect(element().querySelector('.held')?.textContent).toContain('Deploy held for approval');
      expect(element().querySelector('.held')?.textContent).toContain(HELD_DETAIL);
      expect(element().querySelector<HTMLAnchorElement>('.held a')?.getAttribute('href')).toBe(
        'https://deployments.dev.example.test/qits/deployment-requests/dr-42',
      );
    });

    it('links the deployment by release where the sentence names no request', async () => {
      await mount(
        releasedAndHeld({
          qualityGates: [deploymentGate({ detail: 'Deploy of 2026.904.161524 held for approval' })],
        }),
      );

      expect(element().querySelector<HTMLAnchorElement>('.held a')?.getAttribute('href')).toBe(
        'https://deployments.dev.example.test/qits/deployment-requests/by-release/' +
          'repo-ci/2026.904.161524',
      );
    });

    /** Approved, the gate moves on: the flag is still true, and the deploy is no longer waiting. */
    it('says nothing once the gate no longer reads held', async () => {
      await mount(
        releasedAndHeld({
          qualityGates: [deploymentGate({ detail: 'Waiting for 2026.904.161524 to go live' })],
        }),
      );

      expect(element().querySelector('.held')).toBeNull();
    });

    it('says nothing for a request that has not released', async () => {
      await mount(releasedAndHeld({ state: 'FINALIZED', qualityGates: [deploymentGate()] }));

      expect(element().querySelector('.held')).toBeNull();
    });
  });
});
