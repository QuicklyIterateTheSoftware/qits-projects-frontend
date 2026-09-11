import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { QitsChangeTree, QitsDiffViewer, type QitsChangeEntry } from '@qits/ui-components';
import type {
  CommitFileDiffDto,
  ReleaseRequestChangesResponse,
  ReleaseRequestDto,
} from '../api/dto';
import { ReleaseRequestsApi } from '../api/release-requests-api';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';

/**
 * What a release request's fold changes, as two panes: the change set on the left, the open file's
 * unified diff on the right.
 *
 * <p><b>It is the Changes tab's body and nothing else.</b> The page above it still owns the
 * request — one read, one poll, one gates panel — and hands this the row it is holding. That split
 * is deliberate: the approval is still the outstanding question while somebody reads the diff, so
 * the thing that can be approved may not be re-read, re-keyed or re-polled down here.
 *
 * <p><b>Both panes are `@qits/ui-components`' `QitsChangeTree` and `QitsDiffViewer`</b>, the same
 * two the git host's commit page draws. A commit and a fold are the same question asked of
 * different endpoints, so the drawing is one implementation and the reading is two — which is also
 * why the per-file patch is read *here* and handed to the viewer as text rather than fetched by it.
 *
 * <p><b>Every read is keyed on the fold.</b> The change set is asked once per distinct `mergedSha`
 * and never once per poll — it is a fact about the folded commit, and the page polls the request
 * every few seconds while it is unsettled. The per-file patch is keyed on `(mergedSha, path)` for
 * the same reason with one more coordinate.
 *
 * <p><b>A re-arm re-reads, and a stale patch is never left standing.</b> When a push lands the
 * request re-folds onto a new sha: the tree re-reads, the facts line names the fold on screen, and
 * an open `?path=` that the new change set does not contain says "not changed by this fold" rather
 * than keeping the patch of the fold that is gone. That is the same failure the approve button's
 * 409 exists for — a page that guards the button but not the thing the button is about has the rule
 * in only half the places it belongs.
 *
 * <p><b>The base is the service's and is named as a version.</b> The facts line says "since
 * 2026.910.180413" because `baseTag` is the release tag the base was resolved from; a repository
 * that has never released was diffed against the empty tree and the line says that instead. Nothing
 * here computes a base or sends one.
 *
 * <p><b>Every sentence the service can answer with is drawn where the tree would be.</b> Nothing
 * folded yet, a fold pruned out of history, a fold that changed nothing over the previous release
 * and a list capped at the service's limit are four different facts, and each arrives as prose the
 * service wrote. Nothing selected is likewise a sentence in the right pane, not a blank area.
 *
 * <p>A wrapper fold needs no special case: its change set is `.gitmodules` plus a set of `160000`
 * gitlink entries, and git's patch for one of those is a `-Subproject commit …` / `+Subproject
 * commit …` pair. It renders as the two lines it is; turning those shas into versions is a
 * different feature.
 */
@Component({
  selector: 'app-release-request-changes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsChangeTree, QitsDiffViewer],
  template: `
    <app-async
      [state]="changes()"
      loadingLabel="Loading what this fold changes"
      errorLabel="Could not load what this fold changes"
      (retry)="reloadChanges()"
    />

    @if (changeSet(); as set) {
      <p class="facts">{{ lede() }}</p>

      <div class="panes">
        <aside class="side">
          @if (set.files.length === 0) {
            <app-empty [message]="set.detail || 'This fold changes no files.'" />
          } @else {
            @if (set.detail) {
              <p class="note">{{ set.detail }}</p>
            }
            <qits-change-tree
              label="Files this release changes"
              [entries]="entries()"
              [selected]="selectedPath()"
              (selectedChange)="openFile($event ?? '')"
            />
          }
        </aside>

        <section class="main">
          @if (selectedPath(); as path) {
            @if (!inChangeSet()) {
              <!-- The open file belongs to a fold that is no longer on screen. Saying so is the
                   whole point; the patch that was up is not an answer about this fold. -->
              <app-empty [message]="path + ' is not changed by this fold.'" />
            } @else {
              <app-async
                [state]="diff()"
                [loadingLabel]="'Loading the diff of ' + path"
                [errorLabel]="'Could not load the diff of ' + path"
                (retry)="reloadDiff()"
              />
              <!-- Only a read that answered draws: "no textual change" is a fact about a patch that
                   arrived, never a stand-in for one still in flight or refused. -->
              @if (diff().kind === 'ready') {
                <qits-diff-viewer [patch]="patch()" [path]="path" />
              }
            }
          } @else {
            <qits-diff-viewer [patch]="''" [path]="''" />
          }
        </section>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .facts {
      margin: 0.5rem 0 0;
      font-size: 0.8rem;
      color: #6b7280;
    }
    .note {
      margin: 0.15rem 0.35rem 0.4rem;
      font-size: 0.8rem;
      color: #b45309;
      overflow-wrap: anywhere;
    }
    /*
      The two panes take the viewport, which is the one thing the two tabs do not share: the
      overview is a column of panels and is read by scrolling, while a diff is read by staying put
      and moving inside one pane.
    */
    .panes {
      display: grid;
      grid-template-columns: minmax(14rem, 22rem) minmax(0, 1fr);
      gap: 1rem;
      align-items: start;
      margin-top: 0.5rem;
    }
    .side {
      overflow: auto;
      max-height: calc(100vh - 16rem);
      min-height: 12rem;
      padding: 0.35rem 0.25rem;
      border: 1px solid #e5e7eb;
      border-radius: 0.4rem;
      background: #fff;
    }
    .main {
      min-width: 0;
      overflow: auto;
      max-height: calc(100vh - 16rem);
    }
    @media (max-width: 50rem) {
      .panes {
        grid-template-columns: minmax(0, 1fr);
      }
      .side,
      .main {
        max-height: 24rem;
      }
    }
  `,
})
export class ReleaseRequestChanges {
  private readonly api = inject(ReleaseRequestsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /**
   * The request this is the changes of — handed down whole, never re-read. Its identity changes on
   * every poll, which is exactly why every read below is keyed on the fold and not on the input.
   */
  readonly request = input.required<ReleaseRequestDto>();

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  /** The open file. A query param, not a segment: a path holds slashes. */
  protected readonly selectedPath = computed(() => this.query().get('path'));

  private readonly repoId = computed(() => this.request().repoId);

  /** The fold every read here is about. Empty for a request whose first fold has not landed. */
  private readonly fold = computed(() => this.request().mergedSha ?? '');

  protected readonly changes = signal<Loadable<ReleaseRequestChangesResponse>>(LOADING);

  protected readonly diff = signal<Loadable<CommitFileDiffDto>>(LOADING);

  /** The fold the change set on screen is about, so a poll that moved nothing costs no read. */
  private loadedFold: string | null = null;

  /** `(fold, path)` — the patch on screen, so neither a poll nor a re-render re-reads it. */
  private loadedDiff: string | null = null;

  protected readonly changeSet = computed(() => {
    const state = this.changes();
    return state.kind === 'ready' ? state.value : null;
  });

  /**
   * The change set as the tree takes it. The wire's `oldPath` is the tree's `previousPath`: the
   * same fact under the name the shared model chose, which is adaptation, not translation.
   */
  protected readonly entries = computed<readonly QitsChangeEntry[]>(
    () =>
      this.changeSet()?.files.map((file) => ({
        path: file.path,
        previousPath: file.oldPath,
        changeType: file.changeType,
      })) ?? [],
  );

  /**
   * Whether the open `?path=` is in the fold on screen. False is the re-arm case and is drawn as a
   * sentence; it is also what keeps the patch read from being made for a file this fold has not
   * got.
   */
  protected readonly inChangeSet = computed(() => {
    const path = this.selectedPath();
    const set = this.changeSet();
    return !!path && !!set && set.files.some((file) => file.path === path);
  });

  protected readonly patch = computed(() => {
    const state = this.diff();
    return state.kind === 'ready' ? state.value.diff : '';
  });

  /**
   * The facts line: how many files, and what they are counted against — the base named as the
   * release it is, because a version is what a reader knows a base by.
   */
  protected readonly lede = computed(() => {
    const set = this.changeSet();
    if (!set) {
      return '';
    }
    const count = set.files.length;
    const files = `${count} ${count === 1 ? 'file' : 'files'} changed`;
    if (!set.mergedSha) {
      return `${files} — nothing has been folded yet.`;
    }
    return set.baseTag
      ? `${files} since ${set.baseTag}.`
      : `${files} — this repository has not released yet, so the fold is diffed against the empty tree.`;
  });

  constructor() {
    effect(() => {
      const repoId = this.repoId();
      const requestId = this.request().id;
      const fold = this.fold();
      untracked(() => {
        const key = `${repoId}/${requestId}@${fold}`;
        if (this.loadedFold === key) {
          return;
        }
        this.loadedFold = key;
        void this.loadChanges(repoId, requestId, key);
      });
    });

    // The open file's patch — read here rather than by the pane that draws it, and only for a path
    // this fold actually has.
    effect(() => {
      const repoId = this.repoId();
      const requestId = this.request().id;
      const fold = this.fold();
      const path = this.selectedPath();
      const present = this.inChangeSet();
      untracked(() => {
        if (!present || !path) {
          return;
        }
        const key = `${repoId}/${requestId}@${fold}#${path}`;
        if (this.loadedDiff === key) {
          return;
        }
        this.loadedDiff = key;
        void this.loadDiff(repoId, requestId, path, key);
      });
    });
  }

  /** The reader asking again for a change set whose read failed. */
  protected reloadChanges(): void {
    const key = `${this.repoId()}/${this.request().id}@${this.fold()}`;
    this.loadedFold = key;
    void this.loadChanges(this.repoId(), this.request().id, key);
  }

  protected reloadDiff(): void {
    const path = this.selectedPath();
    if (!path) return;
    const key = `${this.repoId()}/${this.request().id}@${this.fold()}#${path}`;
    this.loadedDiff = key;
    void this.loadDiff(this.repoId(), this.request().id, path, key);
  }

  /** A selection is an address: the tree reports it, the URL holds it, and the read follows. */
  protected openFile(path: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { path },
      queryParamsHandling: 'merge',
    });
  }

  private async loadChanges(repoId: string, requestId: string, key: string): Promise<void> {
    if (!repoId || !requestId) {
      return;
    }
    this.changes.set(LOADING);
    try {
      const answer = await this.api.changes(repoId, requestId);
      // A late answer about a fold nobody is reading any more is dropped rather than drawn.
      if (this.loadedFold !== key) return;
      this.changes.set(ready(answer));
    } catch (error) {
      if (this.loadedFold !== key) return;
      this.changes.set(failed(error));
    }
  }

  private async loadDiff(
    repoId: string,
    requestId: string,
    path: string,
    key: string,
  ): Promise<void> {
    this.diff.set(LOADING);
    try {
      const answer = await this.api.fileDiff(repoId, requestId, path);
      if (this.loadedDiff !== key) return;
      this.diff.set(ready(answer));
    } catch (error) {
      if (this.loadedDiff !== key) return;
      this.diff.set(failed(error));
    }
  }
}
