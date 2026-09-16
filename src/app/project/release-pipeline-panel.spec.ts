import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideQitsNavigationTree, type QitsNavigation } from '@qits/ui-components';
import type {
  CommitBuildStatusDto,
  ReleasePhaseDto,
  ReleasePipelineDto,
  ReleasePipelineGateDto,
  ReleaseRequestDto,
} from '../api/dto';
import { ReleasePipelinePanel } from './release-pipeline-panel';

const REQUEST = '/projects/api/repositories/repo-ci/release-requests/r1';
const APPROVE = `${REQUEST}/approve`;
const RERUN = (phase: string) => `${REQUEST}/pipeline/${phase}/rerun`;
const FOLD = '20c377ee71fabe6f32429d1506989efecec7798b';

/**
 * The chrome, answered from a literal — with **qits-ci served on a host of its own**, which is the
 * shape `QitsAppLinks.href` composes an address from.
 *
 * <p>This panel links to nothing itself and would need no navigation at all. It is provided because
 * the legacy path **delegates to the gates panel**, which does link — and a delegation that could not
 * be mounted would be a delegation this spec could not pin.
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

/** One phase, with the two instants defaulted to the "has not begun" pair the service sends. */
function phase(
  name: ReleasePhaseDto['phase'],
  state: ReleasePhaseDto['state'],
  overrides: Partial<ReleasePhaseDto> = {},
): ReleasePhaseDto {
  return { phase: name, state, runId: null, startedAt: null, finishedAt: null, ...overrides };
}

function gate(
  between: ReleasePipelineGateDto['between'],
  kind: string,
  state: string,
  detail: string | null = null,
): ReleasePipelineGateDto {
  return { between, kind, state, detail };
}

/** A request carrying a pipeline — the shape everything but the legacy test is about. */
function piped(pipeline: ReleasePipelineDto, overrides: Partial<ReleaseRequestDto> = {}) {
  return request({ pipeline, ...overrides });
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
 * The one release pipeline of a request, drawn as the sequence it is.
 *
 * <p>Seven things are worth pinning and none of them is the markup. **Every expected phase is drawn
 * before it exists**: a release that has not been tagged shows its publish and deployment rows as
 * pending, because a panel that grew rows as the release proceeded would make each new one read as
 * something that had just been added. **The deployment row is drawn on evidence** — a repository that
 * deploys nothing shows two rows, not three, which is the gate set's whole argument applied to
 * phases. **A `PENDING` gate is a WAIT**: it is worded as one and it is never in the refusal tone,
 * which is the distinction the pipeline model exists to make. **A succeeded phase is offered no
 * rerun**, so the button's absence means something — and the failed and stuck ones are offered one,
 * because the door is addressed by phase rather than by a run id. **The rerun posts the phase as a
 * path segment and hands the answered request back whole**, which is the same row replacement the
 * approval has always done. **The approval still works**, on the `QA_PUBLISH` gate line where it
 * belongs. **A request with no pipeline delegates to the gates panel** rather than re-deriving it, so
 * the legacy rendering is unchanged by construction.
 */
describe('ReleasePipelinePanel', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ReleasePipelinePanel>;
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

  async function mount(
    row: ReleaseRequestDto,
    builds: readonly CommitBuildStatusDto[] = [],
  ): Promise<void> {
    fixture = TestBed.createComponent(ReleasePipelinePanel);
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

  /** The phase rows as a reader sees them, in order — the tree's own shape. */
  function rows(): readonly string[] {
    return [...element().querySelectorAll('.phase')].map((row) => row.textContent ?? '');
  }

  describe('the phases', () => {
    /**
     * **Drawn before they exist.** The tag has not been cut, so neither the publish run nor the
     * deployment has anything to report — and both rows are there, pending, because the alternative
     * is a panel that grows and a reader who reads each new row as news rather than as the thing
     * that was always coming.
     */
    it('draws every expected phase before the tag, the unreached ones as pending', async () => {
      await mount(
        piped({
          phases: [phase('QA', 'RUNNING', { runId: 'run-9' })],
          gates: [
            gate('QA_PUBLISH', 'CI', 'PENDING'),
            gate('PUBLISH_DEPLOY', 'PUBLISH', 'PENDING'),
            gate('DEPLOY_FINALIZED', 'DEPLOYMENT', 'PENDING'),
          ],
        }),
      );

      expect(rows()).toHaveLength(3);
      expect(rows()[0]).toContain('QA');
      expect(rows()[0]).toContain('● RUNNING');
      expect(rows()[1]).toContain('Publish');
      expect(rows()[1]).toContain('○ pending');
      expect(rows()[2]).toContain('Deployment');
      expect(rows()[2]).toContain('○ pending');
    });

    /**
     * **A repository that deploys nothing shows two rows.** The deployment is a thing a repository
     * configures, exactly as the old gate set said, and drawing a third row that will never happen
     * would be inventing a wait for a library.
     */
    it('draws two phase rows for a repository with no deployment at all', async () => {
      await mount(
        piped({
          phases: [phase('QA', 'SUCCESS'), phase('PUBLISH', 'SUCCESS')],
          gates: [gate('QA_PUBLISH', 'CI', 'PASSED'), gate('PUBLISH_DEPLOY', 'PUBLISH', 'PASSED')],
        }),
      );

      expect(rows()).toHaveLength(2);
      expect(text()).not.toContain('Deployment');
    });

    /** A green publish says what it produced, in the gates panel's own words. */
    it('marks a succeeded publish phase and its gate as green', async () => {
      await mount(
        piped(
          {
            phases: [phase('QA', 'SUCCESS'), phase('PUBLISH', 'SUCCESS', { runId: 'run-11' })],
            gates: [gate('PUBLISH_DEPLOY', 'PUBLISH', 'PASSED')],
          },
          { state: 'RELEASED', version: '2026.903.1' },
        ),
      );

      expect(rows()[1]).toContain('✓ SUCCESS');
      expect(text()).toContain('✓ Publish');
      expect(text()).toContain('the release pipeline of this tag is green');
    });

    /**
     * **A cancelled or unreadable phase gets a sentence, never a bare word.** Neither is a refusal,
     * and a reader shown one word would have to guess whether the release had been turned down.
     */
    it('says out loud that a stuck deployment refused nothing', async () => {
      await mount(
        piped(
          {
            phases: [
              phase('QA', 'SUCCESS'),
              phase('PUBLISH', 'SUCCESS'),
              phase('DEPLOY', 'UNKNOWN', { runId: 'dr-3' }),
            ],
            gates: [gate('DEPLOY_FINALIZED', 'DEPLOYMENT', 'UNKNOWN')],
          },
          { state: 'RELEASED', version: '2026.903.1' },
        ),
      );

      expect(rows()[2]).toContain('○ UNKNOWN');
      expect(text()).toContain('could not be read');
      expect(text()).toContain('nothing has refused it');
      // Unreadable is not refused: the phase row is not drawn in the failure tone.
      expect(element().querySelectorAll('.phase')[2].classList).not.toContain('is-failed');
    });

    /** The terminal line is the end of the lifecycle, and it says which end this request is at. */
    it('draws the finalized terminus, ticked once the tag has reached main', async () => {
      await mount(
        piped(
          {
            phases: [phase('QA', 'SUCCESS'), phase('PUBLISH', 'SUCCESS')],
            gates: [gate('DEPLOY_FINALIZED', 'DEPLOYMENT', 'PASSED')],
          },
          { state: 'FINALIZED', version: '2026.903.1', mergedToMainAt: '2026-09-01T14:00:00Z' },
        ),
      );

      expect(element().querySelector('.terminal')?.textContent).toContain('✓ FINALIZED');
      expect(text()).toContain('the tag is on main');
    });
  });

  describe('the gates between them', () => {
    /**
     * **The whole point of the model.** A gate that has not answered is a wait: the pipeline is
     * holding in front of it and nothing has refused anything. It must not be worded as a failure and
     * it must not be drawn in the refusal tone, because a platform that coloured the two alike would
     * report every healthy pipeline on it as broken for as long as it was running.
     */
    it('words a pending gate as a wait, and never as a refusal', async () => {
      await mount(
        piped(
          {
            phases: [phase('QA', 'SUCCESS'), phase('PUBLISH', 'RUNNING', { runId: 'run-11' })],
            gates: [gate('PUBLISH_DEPLOY', 'PUBLISH', 'PENDING')],
          },
          { state: 'RELEASED', version: '2026.903.1' },
        ),
      );

      const line = element().querySelector('.gate') as HTMLElement;
      expect(line.textContent).toContain('waiting on the release pipeline of this tag');
      expect(line.classList).toContain('is-waiting');
      expect(line.classList).not.toContain('is-failed');
      // No mark on the name: a waiting gate has no verdict to carry one.
      expect(line.textContent).not.toContain('✗');
      expect(line.textContent).not.toContain('✓');
    });

    /** A kind this build has never heard of is drawn as itself rather than guessed into a colour. */
    it('draws a gate kind it has never heard of as itself, and says nothing refused', async () => {
      await mount(
        piped({
          phases: [phase('QA', 'RUNNING', { runId: 'run-9' })],
          gates: [gate('QA_PUBLISH', 'LICENCE_SCAN', 'PENDING')],
        }),
      );

      expect(text()).toContain('LICENCE SCAN');
      expect(text()).toContain('nothing has refused the release');
    });

    /** The service's own sentence about a gate rides beside it rather than being reworded. */
    it('shows the detail the service put on a gate', async () => {
      await mount(
        piped({
          phases: [phase('QA', 'FAILED', { runId: 'run-9' })],
          gates: [gate('QA_PUBLISH', 'CI', 'FAILED', 'run-9 went red on the integration suite')],
        }),
      );

      expect(element().querySelector('.gate .detail')?.textContent).toContain(
        'the integration suite',
      );
    });
  });

  describe('the rerun', () => {
    const FAILED_PUBLISH: ReleasePipelineDto = {
      phases: [
        phase('QA', 'SUCCESS'),
        phase('PUBLISH', 'FAILED', { runId: 'run-11', startedAt: '2026-09-01T14:00:00Z' }),
      ],
      gates: [gate('PUBLISH_DEPLOY', 'PUBLISH', 'FAILED')],
    };

    /**
     * **The absence is the sentence.** The door is addressed by `(repoId, requestId, phase)` rather
     * than by a run id, so the button could be drawn on every row — which is exactly what makes its
     * absence on a green one mean something. A succeeded phase says what it produced instead.
     */
    it('offers no rerun on a phase that has succeeded', async () => {
      await mount(
        piped({
          phases: [phase('QA', 'SUCCESS', { runId: 'run-9' })],
          gates: [gate('QA_PUBLISH', 'CI', 'PASSED')],
        }),
      );

      expect(text()).not.toContain('Run the QA phase again');
    });

    /**
     * **Nor on a phase nothing has started.** A pending phase with no run behind it has not begun —
     * it starts when the gate in front of it passes — so a button on it would promise a door that
     * has nothing to re-ask.
     */
    it('offers no rerun on a pending phase nothing was ever started for', async () => {
      await mount(
        piped({
          phases: [phase('QA', 'RUNNING', { runId: 'run-9' }), phase('PUBLISH', 'PENDING')],
          gates: [gate('QA_PUBLISH', 'CI', 'PENDING')],
        }),
      );

      expect(text()).not.toContain('Run the publish phase again');
    });

    /**
     * **One press, and the phase is a path segment.** The rerun decides nothing, so it is not one of
     * the verbs the house's two-press confirm is for — and the answered request goes back whole, the
     * same row replacement an approval has always made.
     */
    it('posts the phase in the path on one press, and hands the answer back whole', async () => {
      await mount(piped(FAILED_PUBLISH, { state: 'RELEASED', version: '2026.903.1' }));

      await press('Run the publish phase again');

      const posted = http.expectOne(RERUN('PUBLISH'));
      expect(posted.request.method).toBe('POST');
      expect(posted.request.body).toEqual({});
      const running = piped(
        {
          phases: [phase('QA', 'SUCCESS'), phase('PUBLISH', 'RUNNING', { runId: 'run-12' })],
          gates: [gate('PUBLISH_DEPLOY', 'PUBLISH', 'PENDING')],
        },
        { state: 'RELEASED', version: '2026.903.1' },
      );
      posted.flush({ request: running });
      await settle();

      expect(answered).toEqual([running]);
    });

    /** A running phase is rerunnable: a wedged run is the commonest reason anybody opens this page. */
    it('offers the rerun on a phase that is still running', async () => {
      await mount(
        piped(
          {
            phases: [phase('QA', 'SUCCESS'), phase('PUBLISH', 'RUNNING', { runId: 'run-11' })],
            gates: [gate('PUBLISH_DEPLOY', 'PUBLISH', 'PENDING')],
          },
          { state: 'RELEASED', version: '2026.903.1' },
        ),
      );

      expect(text()).toContain('Run the publish phase again');
    });

    /**
     * **A 409 is not an error.** The phase has already succeeded, or is running this moment, or the
     * pipeline never reached it — each is a page that went stale under its reader, so it is drawn
     * calmly, in the row it was pressed in, and never as a toast.
     */
    it('draws a refusal in the row it was pressed in, in the service’s own words', async () => {
      await mount(piped(FAILED_PUBLISH, { state: 'RELEASED', version: '2026.903.1' }));

      await press('Run the publish phase again');
      http
        .expectOne(RERUN('PUBLISH'))
        .flush(
          { message: 'The publish phase of r1 is already running.' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(element().querySelector('.refused')?.textContent).toContain('already running');
      expect(answered).toEqual([]);
      // Still offered: nothing was decided, and the reader may want to press again.
      expect(text()).toContain('Run the publish phase again');
    });

    /** Anything that is not a 409 really is a failure, and is reported as one. */
    it('reports a genuine failure as one', async () => {
      await mount(piped(FAILED_PUBLISH, { state: 'RELEASED', version: '2026.903.1' }));

      await press('Run the publish phase again');
      http
        .expectOne(RERUN('PUBLISH'))
        .flush({ message: 'the runner is away' }, { status: 503, statusText: 'Unavailable' });
      await settle();

      expect(element().querySelector('.failed')?.textContent).toContain('was not run again');
      expect(answered).toEqual([]);
    });
  });

  describe('the approval, on the gate it is', () => {
    const GATED: ReleasePipelineDto = {
      phases: [phase('QA', 'SUCCESS', { runId: 'run-9' })],
      gates: [gate('QA_PUBLISH', 'CI', 'PASSED'), gate('QA_PUBLISH', 'APPROVAL', 'PENDING')],
    };

    function gated(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
      return piped(GATED, { approvalRequired: true, approvalState: 'WAITING', ...overrides });
    }

    it('says the pipeline is waiting for a person, and asks', async () => {
      await mount(gated(), [build()]);

      expect(text()).toContain('Approval');
      expect(text()).toContain('waiting for a person');
      expect(text()).toContain('Approve release');
    });

    /**
     * **The body names the fold the panel was rendered with**, and the confirm is two presses — both
     * carried over from the gates panel word for word, because an approval is still a statement about
     * content wherever the line is drawn.
     */
    it('needs a second press, posts the rendered fold and hands the answer back', async () => {
      await mount(gated(), [build()]);

      await press('Approve release');
      http.expectNone(APPROVE);
      expect(text()).toContain('Confirm approve?');

      await press('Confirm approve?');
      const posted = http.expectOne(APPROVE);
      expect(posted.request.body).toEqual({ mergedSha: FOLD });
      const approved = piped(GATED, { state: 'READY', approvalState: 'APPROVED' });
      posted.flush({ request: approved });
      await settle();

      expect(answered).toEqual([approved]);
    });

    /** A decided gate keeps the record and is offered no verb — the rule the rerun keeps too. */
    it('names who approved it and stops asking', async () => {
      await mount(
        piped(
          {
            phases: [phase('QA', 'SUCCESS')],
            gates: [gate('QA_PUBLISH', 'APPROVAL', 'PASSED')],
          },
          {
            state: 'READY',
            approvalRequired: true,
            approvalState: 'APPROVED',
            approvedBy: 'someone',
            approvedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
          },
        ),
        [build()],
      );

      expect(text()).toContain('✓ Approval');
      expect(text()).toContain('approved by someone');
      expect(text()).toContain('4m ago');
      expect(text()).not.toContain('Approve release');
    });

    /**
     * **A 409 on the decision is not an error either.** The fold moved under the reader; nothing was
     * decided, the gate stays waiting, and the new sha is named.
     */
    it('says the fold moved on a 409 and approves nothing', async () => {
      await mount(gated(), [build()]);

      await press('Approve release');
      await press('Confirm approve?');
      http.expectOne(APPROVE).flush(
        {
          message:
            'Release request r1 is on aaaa1111bbbb2222cccc3333dddd4444eeee5555 now, ' + `not ${FOLD}.`,
        },
        { status: 409, statusText: 'Conflict' },
      );
      await settle();

      expect(text()).toContain('The fold changed while this was being read');
      expect(text()).toContain('aaaa111');
      expect(answered).toEqual([]);
      expect(text()).toContain('waiting for a person');
    });

    /** No gate, no affordance: the service answers 409 to approving what nobody has to approve. */
    it('asks nothing where the repository requires no approval', async () => {
      await mount(piped(GATED, { approvalRequired: false }), [build()]);

      expect(buttons()).toHaveLength(0);
    });
  });

  describe('a service that reports no pipeline', () => {
    /**
     * **The legacy path is the legacy component, not a copy of it.** A service build older than the
     * field must render exactly what it rendered yesterday, and the only way to guarantee "exactly"
     * is to draw the same component — a re-implementation would be free to drift, and the day it
     * drifted is a day nobody is looking. The CI line and its "No verdict yet" sentence are the gates
     * panel's own and appear nowhere in this panel's template, which is what makes them the proof.
     */
    it('delegates to the gates panel, and draws no pipeline of its own', async () => {
      await mount(request(), []);

      expect(element().querySelector('app-release-gates-panel')).not.toBeNull();
      expect(element().querySelector('.pipeline')).toBeNull();
      expect(text()).toContain('Gates');
      expect(text()).toContain('No verdict yet');
    });

    /** `null` and absent are one fact — there is no pipeline to draw — and get one answer. */
    it('delegates for an explicit null as well as for an absent field', async () => {
      await mount(request({ pipeline: null }), [build()]);

      expect(element().querySelector('app-release-gates-panel')).not.toBeNull();
      expect(element().querySelector('.verdict')?.textContent).toContain('success');
    });

    /** The delegation is wired through, so a decision made down there still reaches the host. */
    it('passes a decision made in the delegated panel straight out', async () => {
      const legacy = request({ approvalRequired: true, approvalState: 'WAITING' });
      await mount(legacy, [build()]);

      await press('Approve release');
      await press('Confirm approve?');
      const approved = request({ state: 'READY', approvalState: 'APPROVED' });
      http.expectOne(APPROVE).flush({ request: approved });
      await settle();

      expect(answered).toEqual([approved]);
    });
  });
});
