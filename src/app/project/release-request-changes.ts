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
import {
  QITS_SCOPE,
  QitsAppLinks,
  QitsChangeTree,
  QitsDiffViewer,
  type QitsChangeEntry,
  type QitsScope,
} from '@qits/ui-components';
import type {
  CommitFileDiffDto,
  ReleaseRequestChangesResponse,
  ReleaseRequestDto,
  SubmoduleChangesDto,
  SubmoduleRefDto,
} from '../api/dto';
import { ReleaseRequestsApi } from '../api/release-requests-api';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatInstant, formatRelativeTime, shortSha } from '../ui/format';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';

/** One gitlink path split from the file inside it — the two halves the submodule reads address by. */
interface Hoisted {
  readonly gitlink: string;
  readonly file: string;
}

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
 * the same reason with one more coordinate, and an expansion on `(mergedSha, gitlink path)`.
 *
 * <p><b>A re-arm re-reads, and a stale patch is never left standing.</b> When a push lands the
 * request re-folds onto a new sha: the tree re-reads, the facts line names the fold on screen, and
 * an open `?path=` that the new change set does not contain says "not changed by this fold" rather
 * than keeping the patch of the fold that is gone. That is the same failure the approve button's
 * 409 exists for — a page that guards the button but not the thing the button is about has the rule
 * in only half the places it belongs. Every expansion goes with it: an expansion is a statement
 * about two pins, and a fold that moved may pin something else entirely.
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
 * <p><b>A wrapper fold is the case this page exists for, and it needs the special case it used to
 * argue against.</b> Its change set is `.gitmodules` plus a set of `160000` gitlink entries, and
 * git's patch for one of those is a `-Subproject commit …` / `+Subproject commit …` pair: forty hex
 * characters becoming forty others, in a repository the diff never names. Drawing it as the two
 * lines it is was honest and useless — the whole content of the release lives in the sibling, and
 * reading it meant leaving this page, finding the right repository by hand, and comparing two shas
 * nobody had written down. So a gitlink row **expands**: the service resolves the sibling from the
 * path alone and answers that repository's own commits and changed files between the two pins, and
 * those files are spliced into this very tree under the gitlink's path.
 *
 * <p><b>One address space, and that is what keeps it simple.</b> A hoisted file rides in the same
 * `?path=` as everything else, spelled as `<gitlink>/<file inside the submodule>` — so the tree's
 * selection comparison is unchanged, a deep link is a plain URL, and the *only* place the join is
 * taken apart again is the read that needs the two halves. A second query parameter would have put
 * the same fact in two places and made every comparison on this page ask which one to trust.
 *
 * <p><b>The expansion is never a click's prisoner.</b> A URL whose `?path=` lies under a gitlink
 * this fold moves expands on arrival: the address is the state, so a link pasted into a chat must
 * land on the file, not on a tree somebody else has to re-open.
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
            @if (openSubmodule(); as ref) {
              <!-- A gitlink is not a file: the two pins and the sibling's own commits are what the
                   release is, and the "Subproject commit" patch says none of it. -->
              <section class="submodule">
                <h3>{{ path }}</h3>

                @if (pins(); as pin) {
                  <p class="pins">
                    @if (pin.oldHref) {
                      <a class="ref" [href]="pin.oldHref" [title]="pin.oldSha ?? ''">{{
                        short(pin.oldSha)
                      }}</a>
                    } @else {
                      <span class="ref" [title]="pin.oldSha ?? ''">{{ short(pin.oldSha) }}</span>
                    }
                    <span class="arrow" aria-hidden="true">→</span>
                    @if (pin.newHref) {
                      <a class="ref" [href]="pin.newHref" [title]="pin.newSha ?? ''">{{
                        short(pin.newSha)
                      }}</a>
                    } @else {
                      <span class="ref" [title]="pin.newSha ?? ''">{{ short(pin.newSha) }}</span>
                    }
                  </p>
                }

                @if (ref.detail) {
                  <!-- Not expandable, and the service said why. The pins above are still the whole
                       of what the old rendering gave a reader, so nobody is worse off. -->
                  <p class="note">{{ ref.detail }}</p>
                } @else {
                  <app-async
                    [state]="expansionState()"
                    [loadingLabel]="'Loading what ' + path + ' moves'"
                    [errorLabel]="'Could not load what ' + path + ' moves'"
                    (retry)="reloadExpansion()"
                  />
                  @if (expanded(); as expansion) {
                    @if (expansion.commits.length === 0) {
                      <app-empty
                        [message]="expansion.detail || 'This pin move brings in no commits.'"
                      />
                    } @else {
                      @if (expansion.detail) {
                        <p class="note">{{ expansion.detail }}</p>
                      }
                      <ul class="commits">
                        @for (commit of expansion.commits; track commit.hash) {
                          <li class="commit">
                            <span class="ref" [title]="commit.hash">{{ commit.shortHash }}</span>
                            <span class="message">{{ commit.message }}</span>
                            <span class="author">{{ commit.author }}</span>
                            <span class="when" [title]="instant(commit.date)">{{
                              ago(commit.date)
                            }}</span>
                          </li>
                        }
                      </ul>
                    }
                  }
                }
              </section>
            } @else if (!inChangeSet()) {
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
    /*
      The submodule panel is the same commit list the overview's "What this release folds in" draws,
      because it answers the same question about a different repository — a reader who has learnt to
      read one has learnt to read the other.
    */
    .submodule h3 {
      margin: 0.15rem 0 0.35rem;
      font-size: 0.95rem;
      overflow-wrap: anywhere;
    }
    .pins {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      flex-wrap: wrap;
      margin: 0 0 0.5rem;
      font-size: 0.85rem;
    }
    .pins .arrow {
      color: #6b7280;
    }
    .ref {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow-wrap: anywhere;
    }
    .pins a {
      color: #1d4ed8;
    }
    .pins a:hover {
      text-decoration: underline;
    }
    .commits {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .commit {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
      font-size: 0.85rem;
    }
    .commit .message {
      flex: 1;
      min-width: 12rem;
      color: #111827;
      overflow-wrap: anywhere;
    }
    .commit .author,
    .commit .when {
      color: #6b7280;
      font-size: 0.8rem;
      white-space: nowrap;
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
  private readonly appLinks = inject(QitsAppLinks);

  /** What the address says is on screen — never the route parameters, which is the platform rule. */
  private readonly scope = inject(QITS_SCOPE).scope;

  /**
   * The request this is the changes of — handed down whole, never re-read. Its identity changes on
   * every poll, which is exactly why every read below is keyed on the fold and not on the input.
   */
  readonly request = input.required<ReleaseRequestDto>();

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: convertToParamMap({}),
  });

  /**
   * The open file. A query param, not a segment: a path holds slashes. A file hoisted out of a
   * submodule rides here too, spelled `<gitlink>/<file inside it>` — one address space, see the
   * class javadoc.
   */
  protected readonly selectedPath = computed(() => this.query().get('path'));

  private readonly repoId = computed(() => this.request().repoId);

  /** The fold every read here is about. Empty for a request whose first fold has not landed. */
  private readonly fold = computed(() => this.request().mergedSha ?? '');

  protected readonly changes = signal<Loadable<ReleaseRequestChangesResponse>>(LOADING);

  protected readonly diff = signal<Loadable<CommitFileDiffDto>>(LOADING);

  /**
   * The gitlinks opened so far, by their path in the wrapper. A `ready` entry is what splices the
   * sibling's files into the tree; a `loading` or `error` entry is also the ledger saying this fold
   * has already asked, so neither a re-render nor a poll asks twice.
   */
  private readonly expansions = signal<ReadonlyMap<string, Loadable<SubmoduleChangesDto>>>(
    new Map(),
  );

  /** The fold the change set on screen is about, so a poll that moved nothing costs no read. */
  private loadedFold: string | null = null;

  /** `(fold, path)` — the patch on screen, so neither a poll nor a re-render re-reads it. */
  private loadedDiff: string | null = null;

  /**
   * The fold every entry in {@link expansions} belongs to. Same key as {@link loadedFold}, kept
   * separately because it is what the map is *emptied* on: an expansion is a statement about two
   * pins, and a fold that moved may not pin the same pair — or the same submodule at all.
   */
  private expandedFold: string | null = null;

  protected readonly ago = (iso: string) => formatRelativeTime(iso);
  protected readonly instant = formatInstant;
  protected readonly short = (sha: string | null) => (sha ? shortSha(sha) : NONE);

  protected readonly changeSet = computed(() => {
    const state = this.changes();
    return state.kind === 'ready' ? state.value : null;
  });

  /**
   * Every gitlink this fold moves, by path. The service labelled them — `submodule` is non-null
   * exactly where a `160000` mode is on either side — so nothing here parses a tree mode.
   */
  private readonly gitlinks = computed<ReadonlyMap<string, SubmoduleRefDto>>(() => {
    const found = new Map<string, SubmoduleRefDto>();
    for (const file of this.changeSet()?.files ?? []) {
      if (file.submodule) {
        found.set(file.path, file.submodule);
      }
    }
    return found;
  });

  /** The gitlink the open `?path=` *is*, expandable or not — the panel's subject. */
  protected readonly openSubmodule = computed<SubmoduleRefDto | null>(() => {
    const path = this.selectedPath();
    return (path && this.gitlinks().get(path)) || null;
  });

  /**
   * The gitlink the open `?path=` is at or inside, where the service said it can be expanded — the
   * one thing that asks for an expansion, whether the reader clicked the row or arrived on a link
   * pointing inside it.
   *
   * <p>The prefix test demands the separator. A bare `startsWith` would let
   * `components/qits-ci/qits-ci-service-daemon/…` resolve through `…/qits-ci-service` and read a
   * patch out of the wrong repository.
   */
  private readonly wantedExpansion = computed<string | null>(() => {
    const path = this.selectedPath();
    if (!path) {
      return null;
    }
    for (const [gitlink, ref] of this.gitlinks()) {
      if (ref.detail) {
        continue;
      }
      if (path === gitlink || path.startsWith(`${gitlink}/`)) {
        return gitlink;
      }
    }
    return null;
  });

  /** The open gitlink's expansion, for the panel's spinner and its retry. */
  protected readonly expansionState = computed<Loadable<SubmoduleChangesDto>>(() => {
    const path = this.selectedPath();
    return (path ? this.expansions().get(path) : undefined) ?? LOADING;
  });

  protected readonly expanded = computed(() => {
    const state = this.expansionState();
    return state.kind === 'ready' ? state.value : null;
  });

  /**
   * The change set as the tree takes it, with every loaded expansion spliced in underneath its
   * gitlink. The wire's `oldPath` is the tree's `previousPath`: the same fact under the name the
   * shared model chose, which is adaptation, not translation.
   *
   * <p><b>The gitlink's own entry stays in the list.</b> A change *at* a path and changes *below*
   * it is exactly how the shared model is told that a directory is a submodule — it reads the
   * shape rather than a flag — and it is what makes that row both expandable and selectable.
   *
   * <p>A hoisted path is joined, including a rename's `previousPath`: both sides of a rename are
   * addresses in the same submodule, and half a join would be a path in neither repository.
   */
  protected readonly entries = computed<readonly QitsChangeEntry[]>(() => {
    const set = this.changeSet();
    if (!set) {
      return [];
    }
    const rows: QitsChangeEntry[] = set.files.map((file) => ({
      path: file.path,
      previousPath: file.oldPath,
      changeType: file.changeType,
    }));
    for (const [gitlink, state] of this.expansions()) {
      if (state.kind !== 'ready') {
        continue;
      }
      for (const file of state.value.files) {
        rows.push({
          path: `${gitlink}/${file.path}`,
          previousPath: file.oldPath ? `${gitlink}/${file.oldPath}` : null,
          changeType: file.changeType,
        });
      }
    }
    return rows;
  });

  /**
   * Whether the open `?path=` is in the fold on screen — its own change set, or a file an expansion
   * hoisted into it. False is the re-arm case and is drawn as a sentence; it is also what keeps a
   * patch from ever being read for a path this fold has not got.
   */
  protected readonly inChangeSet = computed(() => {
    const path = this.selectedPath();
    const set = this.changeSet();
    if (!path || !set) {
      return false;
    }
    return set.files.some((file) => file.path === path) || !!this.hoisted(path);
  });

  protected readonly patch = computed(() => {
    const state = this.diff();
    return state.kind === 'ready' ? state.value.diff : '';
  });

  /**
   * The two pins of the open gitlink, as links into the git host where the path spells an address
   * this platform can honestly compose.
   *
   * <p>The expansion's own pins win over the change set's when it has answered: both come from the
   * same fold, and the read that resolved the sibling is the one that had to agree with it.
   */
  protected readonly pins = computed(() => {
    const path = this.selectedPath();
    const ref = this.openSubmodule();
    if (!path || !ref) {
      return null;
    }
    const expansion = this.expanded();
    const oldSha = expansion?.oldSha ?? ref.oldSha;
    const newSha = expansion?.newSha ?? ref.newSha;
    const scope = this.siblingScope(path, expansion?.name ?? ref.name);
    const link = (sha: string | null) =>
      sha && scope
        ? this.appLinks.href('qits-githost', `commit/${encodeURIComponent(sha)}`, scope)
        : undefined;
    return { oldSha, newSha, oldHref: link(oldSha), newHref: link(newSha) };
  });

  /**
   * The facts line: how many files, how many of them are submodule pins, and what they are counted
   * against — the base named as the release it is, because a version is what a reader knows a base
   * by.
   *
   * <p>The pin count is a share of the file count rather than a second total: a gitlink *is* one of
   * the entries git reported, and adding it on top would inflate the only number on the line. It is
   * worth saying at all because on a wrapper it is very nearly the whole release.
   */
  protected readonly lede = computed(() => {
    const set = this.changeSet();
    if (!set) {
      return '';
    }
    const count = set.files.length;
    const files = `${count} ${count === 1 ? 'file' : 'files'} changed`;
    const moved = set.files.filter((file) => file.submodule).length;
    const pins =
      moved === 0 ? '' : `, ${moved} of them ${moved === 1 ? 'a submodule pin' : 'submodule pins'}`;
    if (!set.mergedSha) {
      return `${files}${pins} — nothing has been folded yet.`;
    }
    return set.baseTag
      ? `${files} since ${set.baseTag}${pins}.`
      : `${files}${pins} — this repository has not released yet, so the fold is diffed against the empty tree.`;
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

    // The expansion of the gitlink the address points at or into. It is the address that asks, not
    // the click: a deep link must land on the file rather than on a tree somebody must re-open.
    effect(() => {
      const repoId = this.repoId();
      const requestId = this.request().id;
      const fold = this.fold();
      const gitlink = this.wantedExpansion();
      untracked(() => {
        const key = `${repoId}/${requestId}@${fold}`;
        if (this.expandedFold !== key) {
          // The fold moved: every expansion below it was about pins that may be gone.
          this.expandedFold = key;
          this.expansions.set(new Map());
        }
        if (!gitlink || this.expansions().has(gitlink)) {
          return;
        }
        void this.loadExpansion(repoId, requestId, gitlink, key);
      });
    });

    // The open file's patch — read here rather than by the pane that draws it, and only for a path
    // this fold actually has. A gitlink's own row is not a patch at all: it draws the panel.
    effect(() => {
      const repoId = this.repoId();
      const requestId = this.request().id;
      const fold = this.fold();
      const path = this.selectedPath();
      const present = this.inChangeSet();
      const submodule = !!this.openSubmodule();
      untracked(() => {
        if (!present || !path || submodule) {
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

  /** The reader asking again for an expansion whose read failed. */
  protected reloadExpansion(): void {
    const gitlink = this.wantedExpansion();
    if (!gitlink) return;
    const key = `${this.repoId()}/${this.request().id}@${this.fold()}`;
    this.expandedFold = key;
    void this.loadExpansion(this.repoId(), this.request().id, gitlink, key);
  }

  /** A selection is an address: the tree reports it, the URL holds it, and the read follows. */
  protected openFile(path: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { path },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * The gitlink and the file inside it, for a path a loaded expansion hoisted into this tree — and
   * null for every path of the fold's own change set.
   *
   * <p>Only a `ready` expansion answers, and only for a file it actually listed. That is what keeps
   * the patch read honest: a path this page merely *composed* is not a path the sibling has.
   */
  private hoisted(path: string): Hoisted | null {
    for (const [gitlink, state] of this.expansions()) {
      if (state.kind !== 'ready') {
        continue;
      }
      const prefix = `${gitlink}/`;
      if (!path.startsWith(prefix)) {
        continue;
      }
      const file = path.slice(prefix.length);
      if (state.value.files.some((entry) => entry.path === file)) {
        return { gitlink, file };
      }
    }
    return null;
  }

  /**
   * The sibling's own address, derived from the gitlink path and nothing else: the estate mounts
   * submodules at `components/<component>/<name>` and this application's routes are
   * `:project/:group/:repository`, so the component segment is the group and the submodule's name
   * is the repository.
   *
   * <p><b>Any other shape gets no link at all.</b> A wrong address into the git host is worse than
   * a plain sha: the sha is true and merely unclickable, while a link that 404s — or worse, opens
   * some other repository's commit — is this page telling a reader something false about what the
   * release moves.
   */
  private siblingScope(gitlink: string, name: string | null): QitsScope | null {
    const segments = gitlink.split('/').filter((segment) => segment.length > 0);
    if (segments.length !== 3 || segments[0] !== 'components') {
      return null;
    }
    const project = this.scope().project ?? this.params().get('project');
    if (!project) {
      return null;
    }
    return { project, group: segments[1], repository: name ?? segments[2] };
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

  private async loadExpansion(
    repoId: string,
    requestId: string,
    gitlink: string,
    key: string,
  ): Promise<void> {
    // Written before the await, so it is also the ledger: a second pass over this fold sees it.
    this.putExpansion(key, gitlink, LOADING);
    try {
      const answer = await this.api.submoduleChanges(repoId, requestId, gitlink);
      this.putExpansion(key, gitlink, ready(answer));
    } catch (error) {
      this.putExpansion(key, gitlink, failed(error));
    }
  }

  /** An expansion lands only while its fold is still the one on screen. */
  private putExpansion(key: string, gitlink: string, state: Loadable<SubmoduleChangesDto>): void {
    if (this.expandedFold !== key) return;
    const next = new Map(this.expansions());
    next.set(gitlink, state);
    this.expansions.set(next);
  }

  /**
   * The patch, from whichever repository holds it. A path a loaded expansion hoisted goes to the
   * sibling read with the join taken apart; everything else is a file of this fold.
   */
  private async loadDiff(
    repoId: string,
    requestId: string,
    path: string,
    key: string,
  ): Promise<void> {
    this.diff.set(LOADING);
    const own = this.changeSet()?.files.some((file) => file.path === path) ?? false;
    const hoisted = own ? null : this.hoisted(path);
    try {
      const answer = hoisted
        ? await this.api.submoduleFileDiff(repoId, requestId, hoisted.gitlink, hoisted.file)
        : await this.api.fileDiff(repoId, requestId, path);
      if (this.loadedDiff !== key) return;
      this.diff.set(ready(answer));
    } catch (error) {
      if (this.loadedDiff !== key) return;
      this.diff.set(failed(error));
    }
  }
}
