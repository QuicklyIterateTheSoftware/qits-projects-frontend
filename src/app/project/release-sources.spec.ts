import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ReleaseRequestDto, ReleaseRequestSourceDto } from '../api/dto';
import { ReleaseSources } from './release-sources';

const PRIORITY = '/projects/api/repositories/repo-ci/release-requests/r1/sources/priority';

function source(overrides: Partial<ReleaseRequestSourceDto> = {}): ReleaseRequestSourceDto {
  return {
    kind: 'BRANCH',
    name: 'main',
    ref: 'refs/heads/main',
    implicit: false,
    priority: 'MEDIUM',
    ...overrides,
  };
}

const TAG = source({
  kind: 'RELEASED_TAG',
  name: '2026.903.1',
  ref: 'refs/tags/2026.903.1',
  implicit: true,
  priority: undefined,
});

function request(overrides: Partial<ReleaseRequestDto> = {}): ReleaseRequestDto {
  return {
    id: 'r1',
    repoId: 'repo-ci',
    repoName: 'qits-ci',
    backingBranch: 'release/r1',
    sources: [source(), source({ name: 'adhoc-changes', ref: 'refs/heads/adhoc-changes' }), TAG],
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
    priority: 'MEDIUM',
    createdAt: '2026-09-01T13:34:59.888Z',
    updatedAt: '2026-09-01T13:34:59.888Z',
    ...overrides,
  };
}

/**
 * What a request is folding together, and the one place a priority can be changed.
 *
 * <p>Three things are worth pinning. **The two kinds are drawn apart**: a named branch is somebody's
 * choice and carries what it is worth; an implicit released tag is derived, has no priority to have,
 * and is never offered one. **The control is the host's decision and the state's**: a page asks for
 * it, and this component still refuses to make it live on a request the service would answer 409 to.
 * **The answer is the whole request**, emitted rather than re-read — and a refusal leaves the select
 * saying what the service still holds, because nothing else would put it back.
 */
describe('ReleaseSources', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ReleaseSources>;
  let answered: ReleaseRequestDto[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    answered = [];
  });

  afterEach(() => http.verify());

  async function mount(row: ReleaseRequestDto, editable = false): Promise<void> {
    fixture = TestBed.createComponent(ReleaseSources);
    fixture.componentRef.setInput('request', row);
    fixture.componentRef.setInput('editable', editable);
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

  function chips(): readonly HTMLElement[] {
    return [...element().querySelectorAll<HTMLElement>('li.source')];
  }

  function selects(): readonly HTMLSelectElement[] {
    return [...element().querySelectorAll('select')];
  }

  /** Choose a value the way a person does: the control's own value, then its change event. */
  async function choose(select: HTMLSelectElement, value: string): Promise<void> {
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  }

  describe('what it draws', () => {
    it('names every participant and marks the derived ones as derived', async () => {
      await mount(request());

      expect(chips().map((chip) => chip.querySelector('.name')?.textContent?.trim())).toEqual([
        'main',
        'adhoc-changes',
        '2026.903.1',
      ]);
      expect(chips()[2].classList).toContain('implicit');
      expect(chips()[2].getAttribute('title')).toContain('has not reached main yet');
    });

    /** The request's own badge is a maximum; the chips are what says which branch is the urgent one. */
    it('carries what each named branch is worth, and nothing on the tags', async () => {
      await mount(
        request({
          sources: [
            source(),
            source({ name: 'hotfix', ref: 'refs/heads/hotfix', priority: 'HIGH' }),
            TAG,
          ],
        }),
      );

      const priorities = chips().map((chip) =>
        chip.querySelector('.priority')?.textContent?.trim(),
      );
      expect(priorities).toEqual(['medium', 'high', undefined]);
      // The colour is the badge helper's, so only what is above the default draws attention.
      expect(chips()[1].querySelector('.priority')?.className).toContain('warning');
    });

    /**
     * A service build older than the field says nothing about priorities, and this SPA is released
     * before that service — so this is the ordinary case on the day it ships, and it draws nothing
     * rather than the default.
     */
    it('says nothing where the service answered no priority at all', async () => {
      await mount(request({ sources: [source({ priority: undefined })] }));

      expect(element().querySelector('.priority')).toBeNull();
      expect(element().textContent).toContain('main');
    });

    it('draws nothing at all for a request with no sources', async () => {
      await mount(request({ sources: [] }));

      expect(element().querySelector('ul')).toBeNull();
    });
  });

  describe('the control', () => {
    /**
     * The lists are scanned and they poll. A form control on every row of a page that redraws itself
     * every six seconds is a control that moves under the hand using it, so they get the word.
     */
    it('is not offered where the host did not ask for it', async () => {
      await mount(request());

      expect(selects()).toHaveLength(0);
      expect(element().querySelectorAll('.priority')).toHaveLength(2);
    });

    it('is offered on the named branches and never on the tags', async () => {
      await mount(request(), true);

      expect(selects()).toHaveLength(2);
      expect(selects().map((select) => select.getAttribute('aria-label'))).toEqual([
        'Priority of main',
        'Priority of adhoc-changes',
      ]);
      expect(chips()[2].querySelector('select')).toBeNull();
    });

    it('offers the six the service stores, weakest first, and holds the stored one', async () => {
      await mount(request(), true);

      expect([...selects()[0].options].map((option) => option.value)).toEqual([
        'LOWEST',
        'LOW',
        'MEDIUM',
        'HIGH',
        'HIGHER',
        'BLOCKING',
      ]);
      expect(selects()[0].value).toBe('MEDIUM');
    });

    /**
     * A branch a newer service has given a word this build does not know must come back out of the
     * select as it went in — a list that dropped it would post a downgrade nobody asked for.
     */
    it('offers a stored word this build has never heard of rather than replacing it', async () => {
      await mount(request({ sources: [source({ priority: 'URGENT' })] }), true);

      expect([...selects()[0].options].map((option) => option.value)).toContain('URGENT');
      expect(selects()[0].value).toBe('URGENT');
    });

    /** A branch with nothing on it holds an empty slot, so the select states no priority as none. */
    it('holds an empty slot for a branch the service gave no priority', async () => {
      await mount(request({ sources: [source({ priority: undefined })] }), true);

      expect(selects()[0].value).toBe('');
      expect([...selects()[0].options][0].textContent?.trim()).toBe('unset');
    });

    /**
     * The two states the service refuses every change in. The control is drawn and inert rather than
     * removed: what each branch was worth is part of what shipped, and taking it off the page would
     * lose that.
     */
    it('is inert on a request the service would refuse, and still says what was chosen', async () => {
      for (const state of ['RELEASED', 'WITHDRAWN']) {
        await mount(request({ state, sources: [source({ priority: 'HIGH' })] }), true);

        expect(selects()[0].disabled).toBe(true);
        expect(selects()[0].value).toBe('HIGH');
      }
    });

    it('stays live on every state the service still takes a change in', async () => {
      for (const state of ['PENDING', 'READY', 'REJECTED', 'CONFLICTED', 'FAILED']) {
        await mount(request({ state }), true);

        expect(selects()[0].disabled).toBe(false);
      }
    });
  });

  describe('changing one', () => {
    it('posts the branch and the priority, and hands back the whole answered request', async () => {
      await mount(request(), true);

      await choose(selects()[1], 'BLOCKING');
      const posted = http.expectOne(PRIORITY);
      expect(posted.request.method).toBe('POST');
      expect(posted.request.body).toEqual({ branch: 'adhoc-changes', priority: 'BLOCKING' });

      const raised = request({ priority: 'BLOCKING' });
      posted.flush({ request: raised });
      await settle();

      expect(answered).toEqual([raised]);
    });

    /** Every select locks while one is in flight: two changes at once would race on one request. */
    it('locks the whole set while a change is in flight', async () => {
      await mount(request(), true);

      await choose(selects()[0], 'HIGH');
      expect(selects().every((select) => select.disabled)).toBe(true);

      http.expectOne(PRIORITY).flush({ request: request() });
      await settle();
      expect(selects().every((select) => select.disabled)).toBe(false);
    });

    /** Nothing changed, so there is nothing to say to the service. */
    it('asks for nothing when the value chosen is the value already stored', async () => {
      await mount(request(), true);
      await choose(selects()[0], 'MEDIUM');

      http.expectNone(PRIORITY);
      expect(answered).toEqual([]);
    });

    /**
     * The refusal is rendered where it happened, and the control goes back to what the service still
     * holds: the request never changed, so no binding would redraw the select on its own.
     */
    it('reports a refusal and puts the control back', async () => {
      await mount(request(), true);

      await choose(selects()[0], 'BLOCKING');
      http
        .expectOne(PRIORITY)
        .flush(
          { detail: 'the request has already been released' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(element().querySelector('.failed')?.textContent).toContain(
        'Could not set the priority of main',
      );
      expect(selects()[0].value).toBe('MEDIUM');
      expect(answered).toEqual([]);
    });
  });
});
