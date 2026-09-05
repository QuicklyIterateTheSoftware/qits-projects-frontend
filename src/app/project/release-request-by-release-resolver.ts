import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { QITS_REPOSITORIES, QitsButton } from '@qits/ui-components';
import type { ReleaseRequestDto } from '../api/dto';
import { ReleaseRequestsApi } from '../api/release-requests-api';
import { Async } from '../ui/async';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';

/**
 * The middle segment for a repository the chrome's list cannot place.
 *
 * <p>The group is decoration in this address — every page below it resolves the repository by NAME
 * and the guard accepts any word this application has not claimed — so a match must never be thrown
 * away for want of it. `services` is the first archetype the platform draws and the one a repository
 * with no component recorded already lives under, which makes it the least surprising stand-in; the
 * page it lands on is identical whichever word is here.
 */
const UNPLACED_GROUP = 'services';

/**
 * The address a link from a RELEASE lands on:
 * `/<project>/release-requests/by-release/<repoId>/<version>`.
 *
 * <p><b>It exists because the linker does not know the id.</b> qits-platform-maintenance holds a
 * train — a repository and a version — and wants to send a reader to the ask that produced it, but a
 * release request's id is minted here and appears in nothing the train carries. Publishing it
 * outwards would be a second coordinate system across a boundary that carries none; resolving it
 * here costs one read and no contract.
 *
 * <p><b>The redirect is `replaceUrl`</b>, so pressing back returns to whatever linked here rather
 * than to this page, which would resolve again and bounce the reader forward. That is the whole
 * reason this is a component and not a plain route redirect: the answer needs a request.
 *
 * <p><b>One read, and the state is filtered here.</b> The repository route answers the open requests
 * plus the last ten released when nobody names a state, and that window is exactly what a by-release
 * link means — the release somebody is looking at right now. Asking for `state=all` to be certain
 * would fetch a year of history to find a row that, if it is not in the last ten, is not what the
 * link is about.
 *
 * <p><b>A miss is a sentence, not a 404.</b> A release older than the release-request flow itself
 * has no request to show, and so does one whose request has fallen out of the recent window; neither
 * is an error, and neither is worth an error page. There is a retry, because the third cause is a
 * release this service has not finished recording yet.
 *
 * <p><b>The canonical address is spelled through the chrome</b>, the same arm the detail page states:
 * the five-segment form names a repository by NAME and a group, and the chrome's repository list is
 * the one place both are already in memory. So nothing is navigated until that list has settled — a
 * redirect built while it was still in flight would spell {@link UNPLACED_GROUP} for a repository the
 * platform can place perfectly well.
 *
 * <p>Both parameters are `encodeURIComponent`-safe in both directions: the router decodes what it
 * matched, and `ReleaseRequestsApi` encodes the repository id again into its path.
 */
@Component({
  selector: 'app-release-request-by-release-resolver',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, QitsButton],
  template: `
    <app-async
      [state]="state()"
      loadingLabel="Looking for the release request"
      errorLabel="Could not look up the release request"
      (retry)="resolve()"
    />

    @if (missing()) {
      <p class="miss">
        No released request matches {{ repoLabel() }}&#64;{{ version() }} here — it may predate
        release requests.
      </p>
      <qits-button variant="secondary" size="sm" (pressed)="resolve()">Look again</qits-button>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .miss {
      margin: 0.5rem 0;
      color: #6b7280;
    }
  `,
})
export class ReleaseRequestByReleaseResolver {
  private readonly api = inject(ReleaseRequestsApi);
  private readonly router = inject(Router);

  /** Optional exactly as the shared layout has it: an application always has one, a spec need not. */
  private readonly source = inject(QITS_REPOSITORIES, { optional: true });

  private readonly params = toSignal(inject(ActivatedRoute).paramMap, {
    initialValue: convertToParamMap({}),
  });

  protected readonly state = signal<Loadable<number>>(LOADING);

  protected readonly project = computed(() => this.params().get('project') ?? '');
  protected readonly repoId = computed(() => this.params().get('repoId') ?? '');
  protected readonly version = computed(() => this.params().get('version') ?? '');

  /** The chrome's row for the repository the address names, once its list has arrived. */
  private readonly row = computed(() => {
    const repoId = this.repoId();
    return this.source?.repositories()?.find((entry) => entry.id === repoId);
  });

  /** The repository as a person would name it, falling back to the id the address carries. */
  protected readonly repoLabel = computed(() => this.row()?.name ?? this.repoId());

  /** Ready, and nothing matched — the sentence rather than the redirect. */
  protected readonly missing = computed(() => {
    const state = this.state();
    return state.kind === 'ready' && state.value === 0;
  });

  /**
   * The chrome has answered, one way or the other. A list that gave up is settled too: the address
   * is still spellable from the request's own `repoName`, with the stand-in group.
   */
  private readonly chromeSettled = computed(
    () => !this.source || this.source.failed() || this.source.repositories() !== undefined,
  );

  private resolvedFor = '';

  constructor() {
    effect(() => {
      const key = `${this.repoId()}@${this.version()}`;
      if (!this.repoId() || !this.version() || !this.chromeSettled() || this.resolvedFor === key) {
        return;
      }
      this.resolvedFor = key;
      void this.resolve();
    });
  }

  /**
   * One read, and the newest match wins.
   *
   * <p>More than one is an ordinary answer — a version can only be released once, but a withdrawn
   * ask and the one that succeeded both name the repository — and the service sends them newest
   * first, so the first RELEASED row carrying this version is the one a reader following a link
   * means.
   */
  protected async resolve(): Promise<void> {
    this.state.set(LOADING);
    try {
      const requests = await this.api.list(this.repoId());
      const version = this.version();
      const match = requests.find(
        (request) => request.state === 'RELEASED' && request.version === version,
      );
      const address = match ? this.addressOf(match) : null;
      this.state.set(ready(address ? 1 : 0));
      if (address) {
        void this.router.navigate(address, { replaceUrl: true });
      }
    } catch (error) {
      // Named rather than swallowed: a 404 here means the address was built with a repository id
      // this project does not hold, which is a bug in whoever built it and is worth being able to
      // read.
      this.state.set(failed(error));
    }
  }

  /**
   * The canonical five-segment address of one request, or `null` for a match this platform cannot
   * name.
   *
   * <p>The name is what makes the address work: every page below `:project` resolves a repository by
   * NAME through the chrome, so an address built from the row id would land on the ordinary
   * not-found. With neither the request's own `repoName` nor a chrome row to supply one there is no
   * honest address, and the reader gets the same calm sentence a miss gets.
   */
  private addressOf(request: ReleaseRequestDto): string[] | null {
    const row = this.row();
    const name = request.repoName ?? row?.name;
    if (!name) {
      return null;
    }
    const group = row?.component ?? row?.category ?? UNPLACED_GROUP;
    return ['/', this.project(), group, name, 'release-requests', request.id];
  }
}
