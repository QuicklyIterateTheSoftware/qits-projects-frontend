import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideQitsNavigationTree, type QitsNavigation } from '@qits/ui-components';
import type { ReleaseAutomationDto, ReleaseRequestDto } from '../api/dto';
import { VIEWER_ADMIN } from '../ui/viewer';
import { ReleaseAutomations } from './release-automations';

const REQUEST = '/projects/api/repositories/repo-ci/release-requests/r1';
const AUTOMATION_RERUN = `${REQUEST}/automations/screenshot-baselines/runs`;
const AUTOMATION_WAIVE = `${REQUEST}/automations/waivers`;
const FOLD = '20c377ee71fabe6f32429d1506989efecec7798b';

/** The chrome, answered from a literal — with qits-ci served on a host of its own. */
const PLATFORM: QitsNavigation = {
  environment: 'dev',
  origin: 'https://dev.example.test',
  slots: {
    'services.details': [
      {
        app: 'qits-ci',
        label: 'CI',
        host: 'ci.dev.example.test',
        origin: 'https://ci.dev.example.test',
      },
    ],
  },
  applications: {},
};

/** The same platform with qits-ci served nowhere — the "cannot spell it" case. */
const WITHOUT_CI: QitsNavigation = { ...PLATFORM, slots: {} };

function request(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
  return {
    id: 'r1',
    repoId: 'repo-ci',
    repoName: 'qits-ci',
    backingBranch: 'release/r1',
    sources: [{ kind: 'BRANCH', name: 'main', ref: 'refs/heads/main', implicit: false }],
    mergedSha: FOLD,
    state: 'PENDING',
    summary: 'A change worth releasing',
    requester: 'someone',
    detail: null,
    conflict: null,
    version: null,
    releasedSha: null,
    mergedToMainAt: null,
    retryable: false,
    createdAt: '2026-09-01T13:34:59.888Z',
    updatedAt: '2026-09-01T13:34:59.888Z',
    ...overrides,
  };
}

function automation(overrides: Partial<ReleaseAutomationDto> = {}): ReleaseAutomationDto {
  return {
    kind: 'screenshot-baselines',
    label: 'Screenshot baselines',
    state: 'RUNNING',
    foldSha: FOLD,
    runId: 'run-42',
    branch: 'maintenance/automations/screenshot-baselines/r1',
    detail: null,
    updatedAt: '2026-09-01T13:40:00Z',
    ...overrides,
  };
}

/**
 * The release-request automations (qits-978) as one component, drawn by both the gates panel and the
 * pipeline panel: one row per automation, Re-run on the states a fresh run means something for, Waive
 * for whoever may press it — and, for a failed row, why it failed (qits-1116).
 */
describe('ReleaseAutomations', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ReleaseAutomations>;
  let answered: ReleaseRequestDto[];

  function configure(tree: QitsNavigation, admin?: boolean): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationTree(tree),
        ...(admin === undefined ? [] : [{ provide: VIEWER_ADMIN, useValue: admin }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => {
    configure(PLATFORM);
    answered = [];
  });

  afterEach(() => http.verify());

  async function mount(row: ReleaseRequestDto): Promise<void> {
    fixture = TestBed.createComponent(ReleaseAutomations);
    fixture.componentRef.setInput('request', row);
    fixture.componentInstance.decided.subscribe((request) => answered.push(request));
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

  function text(): string {
    return element().textContent ?? '';
  }

  function buttons(): readonly HTMLButtonElement[] {
    return [...element().querySelectorAll('button')];
  }

  function button(label: string): HTMLButtonElement {
    const found = buttons().find((entry) => (entry.textContent ?? '').includes(label));
    if (!found) throw new Error(`no button reading "${label}"`);
    return found;
  }

  async function press(label: string): Promise<void> {
    button(label).click();
    await settle();
  }

  describe('the rows', () => {
    /** An empty array is a repository nothing applies to, which releases at once. */
    it('says nothing applies for an empty list', async () => {
      await mount(request({ automations: [] }));

      expect(text()).toContain('nothing applies to this repository');
      expect(element().querySelector('.automation-row')).toBeNull();
    });

    it('draws a running row, labelled, with a link to its run in CI', async () => {
      await mount(request({ automations: [automation({ state: 'RUNNING' })] }));

      const row = element().querySelector('.automation-row');
      expect(row?.textContent).toContain('Screenshot baselines');
      expect(row?.textContent).toContain('running');
      expect(row?.querySelector('a.run')?.getAttribute('href')).toBe(
        'https://ci.dev.example.test/runs/run-42',
      );
    });

    /** No run means nothing this platform can address — the run link is dropped, never drawn dead. */
    it('drops the run link where the row carries no run id', async () => {
      await mount(request({ automations: [automation({ state: 'REQUESTED', runId: null })] }));

      expect(element().querySelector('.automation-row a.run')).toBeNull();
    });

    /** An application the platform serves nowhere has no address, and gets no anchor at all. */
    it('drops the run link where the platform serves no qits-ci', async () => {
      configure(WITHOUT_CI);
      await mount(request({ automations: [automation({ state: 'FAILED' })] }));

      expect(element().querySelector('.automation-row a.run')).toBeNull();
      expect(text()).toContain('Re-run');
    });
  });

  describe('the failure of a failed row', () => {
    it('names the step, the image by its short name and the exit code, and shows the excerpt', async () => {
      await mount(
        request({
          automations: [
            automation({
              state: 'FAILED',
              failure: {
                stepIndex: 2,
                image: 'registry.dev.internal:5000/qits/build-images/maven-base:latest',
                exitCode: 1,
                excerpt: '[ERROR] BUILD FAILURE\n[ERROR] entity diagram is stale',
              },
            }),
          ],
        }),
      );

      const row = element().querySelector('.automation-row');
      expect(row?.querySelector('.failure-step')?.textContent?.trim()).toBe(
        'step 2 · maven-base:latest · exit 1',
      );
      const excerpt = row?.querySelector('pre.excerpt');
      expect(excerpt?.textContent).toBe('[ERROR] BUILD FAILURE\n[ERROR] entity diagram is stale');
      expect(row?.querySelector('a.run')?.getAttribute('href')).toBe(
        'https://ci.dev.example.test/runs/run-42',
      );
      expect(text()).toContain('Re-run');
    });

    /** A step that never reported an exit code says nothing about one. */
    it('leaves the exit code off where there is none, and the excerpt off where none was kept', async () => {
      await mount(
        request({
          automations: [
            automation({
              state: 'FAILED',
              failure: { stepIndex: 0, image: 'node-base:22', exitCode: null, excerpt: null },
            }),
          ],
        }),
      );

      expect(element().querySelector('.failure-step')?.textContent?.trim()).toBe(
        'step 0 · node-base:22',
      );
      expect(element().querySelector('pre.excerpt')).toBeNull();
    });

    /** A service older than the field: the row keeps its link and its Re-run, and nothing else. */
    it('draws a failed row without a failure as before: link and Re-run, no excerpt', async () => {
      await mount(request({ automations: [automation({ state: 'FAILED', detail: 'exit 137' })] }));

      const row = element().querySelector('.automation-row');
      expect(row?.textContent).toContain('failed: exit 137');
      expect(row?.querySelector('a.run')).not.toBeNull();
      expect(row?.querySelector('.failure-step')).toBeNull();
      expect(row?.querySelector('pre.excerpt')).toBeNull();
      expect(text()).toContain('Re-run');
    });

    /** Only a failed row is drawn a failure, whatever else the service sent along. */
    it('draws no failure under a row that is not failed', async () => {
      await mount(
        request({
          automations: [
            automation({
              state: 'RUNNING',
              failure: { stepIndex: 1, image: 'x:1', exitCode: 2, excerpt: 'old' },
            }),
          ],
        }),
      );

      expect(element().querySelector('.failure-step')).toBeNull();
      expect(element().querySelector('pre.excerpt')).toBeNull();
    });
  });

  describe('Re-run', () => {
    /** A FAILED row offers Re-run, and pressing it calls the kind's own forwarded door. */
    it('shows Re-run on a failed row, and posts to the automation’s own door', async () => {
      await mount(
        request({
          automations: [automation({ state: 'FAILED', detail: 'exit 137', runId: 'run-9' })],
        }),
      );

      await press('Re-run');
      const posted = http.expectOne(AUTOMATION_RERUN);
      expect(posted.request.method).toBe('POST');
      expect(posted.request.body).toEqual({});
      posted.flush({ id: 'bump-1' });
      await settle();
    });

    /** A 409 means one is already running for this (request, kind); drawn calmly, never retried. */
    it('draws a 409 on re-run as "one is already running"', async () => {
      await mount(request({ automations: [automation({ state: 'FAILED' })] }));

      await press('Re-run');
      http
        .expectOne(AUTOMATION_RERUN)
        .flush({ message: 'already running' }, { status: 409, statusText: 'Conflict' });
      await settle();

      expect(text()).toContain('one is already running');
    });

    /** Re-run is not offered while the automation is already live. */
    it('offers no Re-run on a running row', async () => {
      await mount(request({ automations: [automation({ state: 'RUNNING' })] }));

      expect(buttons().some((entry) => (entry.textContent ?? '').includes('Re-run'))).toBe(false);
    });
  });

  describe('Waive', () => {
    /** The one verb a non-admin browser session must never be offered. */
    it('hides Waive for a non-admin', async () => {
      configure(PLATFORM, false);
      await mount(request({ automations: [automation({ state: 'RUNNING' })] }));

      expect(text()).not.toContain('Waive for this fold');
    });

    /** The confirm takes a reason, and the call sends the fold this was RENDERED with. */
    it('sends the rendered fold and the typed reason when an admin waives', async () => {
      await mount(request({ automations: [automation({ state: 'RUNNING' })] }));

      await press('Waive for this fold');
      const field = element().querySelector('.waive-reason') as HTMLInputElement;
      field.value = 'qits-maintenance is down; this fix cannot wait behind it';
      field.dispatchEvent(new Event('input'));
      await settle();

      await press('Confirm waive');
      const posted = http.expectOne(AUTOMATION_WAIVE);
      expect(posted.request.method).toBe('POST');
      expect(posted.request.body).toEqual({
        foldSha: FOLD,
        reason: 'qits-maintenance is down; this fix cannot wait behind it',
      });
      const waived = request({ automations: [automation({ state: 'WAIVED' })] });
      posted.flush({ request: waived });
      await settle();

      expect(answered).toEqual([waived]);
    });

    /** A 409 for a moved fold is drawn calmly, exactly as the approval's own 409 is. */
    it('draws the moved-fold sentence on a 409', async () => {
      await mount(request({ automations: [automation({ state: 'RUNNING' })] }));

      await press('Waive for this fold');
      const field = element().querySelector('.waive-reason') as HTMLInputElement;
      field.value = 'a reason';
      field.dispatchEvent(new Event('input'));
      await settle();
      await press('Confirm waive');

      http.expectOne(AUTOMATION_WAIVE).flush(
        {
          message:
            'Release request r1 is on aaaa1111bbbb2222cccc3333dddd4444eeee5555 now, ' +
            `not ${FOLD}.`,
        },
        { status: 409, statusText: 'Conflict' },
      );
      await settle();

      expect(text()).toContain('The fold changed while this was being read');
      expect(text()).toContain('aaaa111');
      expect(answered).toEqual([]);
    });
  });
});
