import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideQitsNavigationTree, type QitsNavigation } from '@qits/ui-components';
import type { CommitBuildStatusDto, ReleaseRequestDto } from '../api/dto';
import { ReleaseGatesPanel } from './release-gates-panel';

const REQUEST = '/projects/api/repositories/repo-ci/release-requests/r1';
const APPROVE = `${REQUEST}/approve`;
const DECLINE = `${REQUEST}/decline`;
const FOLD = '20c377ee71fabe6f32429d1506989efecec7798b';

/**
 * The chrome, answered from a literal — with **qits-ci served on a host of its own**, which is the
 * shape `QitsAppLinks.href` composes an address from. It is the only application this panel links to.
 */
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

/**
 * The same platform with qits-ci served nowhere — the "cannot spell it" case, and the only honest
 * way to make one: `href` answers `undefined` for an application the navigation names in no entry.
 */
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

/** A request on the wrapper: its releases are approved, and nobody has judged this fold. */
function gated(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
  return request({ approvalRequired: true, approvalState: 'WAITING', ...overrides });
}

function build(overrides: Partial<CommitBuildStatusDto> = {}): CommitBuildStatusDto {
  return {
    runId: 'run-9',
    status: 'SUCCESS',
    branch: 'release/r1',
    gating: true,
    finishedAt: '2026-09-01T13:40:00Z',
    ...overrides,
  };
}

/**
 * What is holding a release request, and the one place a person answers it.
 *
 * <p>Five things are worth pinning and none of them is the markup. **The CI line is never blank**: a
 * fold with no terminal run says so in a sentence, because an empty area is read as "fine". **The
 * approve affordance does not exist where approval is not required** — the service answers 409 to
 * approving what has no gate, so a button there would exist only to be refused. **The confirm is two
 * presses**, the house's shape. **The body names the fold the panel was RENDERED with**, which is the
 * whole of what makes an approval a statement about content. **A 409 is not an error**: the fold
 * moved under the reader, the panel says so with the new sha and stays unapproved.
 */
describe('ReleaseGatesPanel', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ReleaseGatesPanel>;
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

  function configure(tree: QitsNavigation): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideQitsNavigationTree(tree)],
    });
    http = TestBed.inject(HttpTestingController);
  }

  async function mount(
    row: ReleaseRequestDto,
    builds: readonly CommitBuildStatusDto[] = [],
  ): Promise<void> {
    fixture = TestBed.createComponent(ReleaseGatesPanel);
    fixture.componentRef.setInput('request', row);
    fixture.componentRef.setInput('builds', builds);
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

  describe('the CI line', () => {
    it('draws a verdict, when it finished and a link to the run in qits-ci', async () => {
      await mount(request(), [build()]);

      const verdict = element().querySelector('.verdict');
      expect(verdict?.textContent).toContain('success');
      expect(verdict?.textContent).toContain('gating');
      expect(verdict?.textContent).toContain('release/r1');
      expect(verdict?.querySelector('a')?.getAttribute('href')).toBe(
        'https://ci.dev.example.test/runs/run-9',
      );
    });

    /**
     * An empty list has exactly one cause — no terminal run has announced this fold — and it is a
     * different fact from a red build. A blank area would be read as the opposite of what it means.
     */
    it('says there is no verdict yet rather than drawing nothing', async () => {
      await mount(request(), []);

      expect(text()).toContain('No verdict yet');
      expect(element().querySelector('.verdict')).toBeNull();
    });

    /**
     * A repository runs pipelines that have nothing to do with releasing. A red one of those is
     * worth showing and is *not* why the release is stuck, and saying so is the whole line.
     */
    it('shows a red non-gating verdict and says it does not block', async () => {
      await mount(request(), [build({ status: 'FAILED', gating: false, runId: 'run-3' })]);

      const verdict = element().querySelector('.verdict');
      expect(verdict?.classList).toContain('red');
      expect(verdict?.textContent).toContain('failed');
      expect(verdict?.textContent).toContain('does not block this release');
    });

    /** qits-ci owns the vocabulary: an unknown word is drawn as itself and read as a refusal. */
    it('draws a status this build has never heard of as itself, and not as a pass', async () => {
      await mount(request(), [build({ status: 'CONFIG_ERROR' })]);

      expect(text()).toContain('config error');
      expect(element().querySelector('.verdict')?.classList).toContain('red');
    });

    /** An application the platform serves nowhere has no address, and gets no anchor at all. */
    it('drops the run link where the platform serves no qits-ci', async () => {
      configure(WITHOUT_CI);
      await mount(request(), [build()]);

      expect(text()).toContain('success');
      expect(element().querySelector('.verdict a')).toBeNull();
    });
  });

  describe('the approval line', () => {
    /**
     * The whole of what an ordinary repository sees: the CI line, and no approve affordance anywhere.
     * The service answers 409 to approving what has no gate.
     */
    it('is absent on a request nobody has to approve', async () => {
      await mount(request({ approvalRequired: false, approvalState: 'NOT_REQUIRED' }), [build()]);

      expect(text()).not.toContain('Approval');
      expect(buttons()).toHaveLength(0);
    });

    /** Absent likewise on an answer from a service build older than the field. */
    it('is absent where the service says nothing about approval at all', async () => {
      await mount(request(), [build()]);

      expect(text()).not.toContain('Approval');
      expect(buttons()).toHaveLength(0);
    });

    it('says a waiting request is waiting for a person', async () => {
      await mount(gated(), [build()]);

      expect(text()).toContain('Approval');
      expect(text()).toContain('waiting for a person');
    });

    it('names who approved it, how long ago, and what they said', async () => {
      await mount(
        gated({
          approvalState: 'APPROVED',
          approvedBy: 'someone',
          approvedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
          approvalNote: 'Read the diff, it is the manifest bump',
        }),
        [build()],
      );

      expect(text()).toContain('✓ Approval');
      expect(text()).toContain('approved by someone');
      expect(text()).toContain('4m ago');
      expect(element().querySelector('.note')?.textContent).toContain('the manifest bump');
      // The gate is answered, so there is nothing left to ask.
      expect(buttons()).toHaveLength(0);
    });

    /** A decline is a judgement about content, drawn in the warning tone the conflict panel uses. */
    it('names who declined it, and draws the gate as refused', async () => {
      await mount(
        gated({
          state: 'REJECTED',
          approvalState: 'DECLINED',
          approvedBy: 'someone',
          approvedAt: '2026-09-01T13:50:00Z',
          approvalNote: 'Not this week',
        }),
        [build()],
      );

      expect(text()).toContain('✗ Approval');
      expect(text()).toContain('declined by someone');
      expect(element().querySelector('.approval')?.classList).toContain('declined');
      expect(text()).toContain('Not this week');
    });
  });

  describe('the ask', () => {
    it('needs a second press before anything is sent', async () => {
      await mount(gated(), [build()]);

      await press('Approve release');
      http.expectNone(APPROVE);
      expect(text()).toContain('Confirm approve?');

      await press('Confirm approve?');
      http.expectOne(APPROVE).flush({ request: gated({ approvalState: 'APPROVED' }) });
      await settle();
    });

    /**
     * **The body names the fold the panel was rendered with.** An approval is a statement about
     * content; the sha is what makes it one, and the service refuses a stale one on purpose.
     */
    it('posts the rendered fold and the note, and hands the answer back whole', async () => {
      await mount(gated(), [build()]);

      const field = element().querySelector('input') as HTMLInputElement;
      field.value = 'Looks right';
      field.dispatchEvent(new Event('input'));
      await settle();

      await press('Approve release');
      await press('Confirm approve?');

      const posted = http.expectOne(APPROVE);
      expect(posted.request.method).toBe('POST');
      expect(posted.request.body).toEqual({ mergedSha: FOLD, note: 'Looks right' });
      const approved = gated({ state: 'READY', approvalState: 'APPROVED', approvedBy: 'someone' });
      posted.flush({ request: approved });
      await settle();

      expect(answered).toEqual([approved]);
    });

    /** A blank note is not sent as an empty string: the field is optional, so it is simply absent. */
    it('declines with the same body, and sends no note where none was typed', async () => {
      await mount(gated(), [build()]);

      await press('Decline release');
      await press('Confirm decline?');

      const posted = http.expectOne(DECLINE);
      expect(posted.request.body).toEqual({ mergedSha: FOLD });
      posted.flush({ request: gated({ state: 'REJECTED', approvalState: 'DECLINED' }) });
      await settle();
      expect(answered).toHaveLength(1);
    });

    /** Pressing the other button while one is asking moves the question rather than answering it. */
    it('moves the confirmation to the other decision rather than sending', async () => {
      await mount(gated(), [build()]);

      await press('Approve release');
      await press('Decline release');

      http.expectNone(APPROVE);
      http.expectNone(DECLINE);
      expect(text()).toContain('Confirm decline?');
      expect(text()).toContain('Approve release');
    });

    /**
     * **A 409 is not an error.** The fold moved under the reader while the page was open: nothing
     * failed, nothing was decided, and the answer is to look at the new fold — which the page's own
     * poll brings in. The panel says so, names the new sha, and stays unapproved.
     */
    it('says the fold moved on a 409, names the new sha and approves nothing', async () => {
      await mount(gated(), [build()]);

      await press('Approve release');
      await press('Confirm approve?');
      http.expectOne(APPROVE).flush(
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
      // Still unapproved, and still asking: the gate is exactly where it was.
      expect(text()).toContain('waiting for a person');
      expect(text()).toContain('Approve release');
    });

    /** The other four 409s name no sha, and are shown as the service's own sentence. */
    it('draws a refusal that is not about the fold in the service’s own words', async () => {
      await mount(gated(), [build()]);

      await press('Approve release');
      await press('Confirm approve?');
      http
        .expectOne(APPROVE)
        .flush(
          { message: 'Release request r1 is already being released.' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(text()).toContain('already being released');
      expect(text()).not.toContain('The fold changed');
      expect(answered).toEqual([]);
    });

    /** Anything that is not a 409 really is a failure, and is reported as one. */
    it('reports a genuine failure as one', async () => {
      await mount(gated(), [build()]);

      await press('Approve release');
      await press('Confirm approve?');
      http
        .expectOne(APPROVE)
        .flush({ message: 'the database is away' }, { status: 503, statusText: 'Unavailable' });
      await settle();

      expect(element().querySelector('.failed')?.textContent).toContain('was not recorded');
      expect(answered).toEqual([]);
    });
  });
});
