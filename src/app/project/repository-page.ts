import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { QITS_SCOPE, QitsAppLinks, QitsBadge, QitsCard } from '@qits/ui-components';
import type { QitsNavEntry, QitsNavSlot } from '@qits/ui-components';
import { DOCUMENT } from '@angular/common';
import { COMPONENT_TYPES, type RepositoryDto } from '../api/dto';
import { ProjectsApi } from '../api/projects-api';
import { ProjectParam } from '../nav/project-param';
import { Async } from '../ui/async';
import { NONE, cloneUrl, repositoryLabel } from '../ui/format';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { NotFound } from '../not-found/not-found';
import { backupBadge } from './component-card';

/**
 * One repository: what it is, where it is cloned from, and the way in to every application that
 * has something to say about it.
 *
 * <p><b>This is the address the whole platform shares.</b> `/<slug>/<category>/<repoName>` is what
 * qits-ci, qits-docs, qits-artifacts, qits-configuration and qits-workspaces each serve on their
 * own host, so the cards below are this same path with a different origin in front — built from
 * the navigation the edge answers rather than compiled in, which is what keeps an application the
 * platform does not run from appearing here as a dead link.
 *
 * <p>The repository is read out of the project's component list rather than from a route of its
 * own: that read already exists (it is what the setup page draws), it is a single request, and it
 * carries the wrapper beside it. A name the list does not hold is the {@linkplain NotFound
 * ordinary 404} — the address is well formed and names nothing, which is exactly what that page
 * says.
 *
 * <p>The scope, not the route parameters, is what this page reads. That is the platform's rule for
 * every SPA and it costs nothing here, where the two agree — but it is the reason this component
 * would keep working unchanged if the address ever gained a prefix.
 */
@Component({
  selector: 'app-repository-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, NotFound, QitsBadge, QitsCard],
  template: `
    <app-async
      [state]="components()"
      loadingLabel="Loading the repositories"
      errorLabel="Could not load this project"
      (retry)="reload()"
    />

    @if (loaded()) {
      @if (repository(); as repository) {
        <header class="head">
          <h1>{{ label() }}</h1>
          <span class="badges">
            @if (backup(); as badge) {
              <span [title]="badge.title"
                ><qits-badge [label]="badge.label" [tone]="badge.tone"
              /></span>
            }
            <qits-badge [label]="categoryLabel()" tone="neutral" />
          </span>
        </header>

        <dl class="facts">
          <dt>Clone</dt>
          <dd class="url">{{ clone() }}</dd>
          <dt>Main branch</dt>
          <dd>{{ repository.mainBranch || none }}</dd>
          <dt>Backup</dt>
          <dd class="url">{{ repository.backupUrl ?? none }}</dd>
        </dl>

        @if (applications().length > 0) {
          <section class="apps">
            <h2>Elsewhere on the platform</h2>
            <div class="cards">
              @for (application of applications(); track application.entry.app) {
                <a class="app" [href]="application.href">
                  <qits-card>
                    <span class="app-label">{{ application.entry.label }}</span>
                    <span class="app-note">{{ application.entry.app }}</span>
                  </qits-card>
                </a>
              }
            </div>
          </section>
        }
      } @else {
        <app-not-found />
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .badges {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-wrap: wrap;
    }
    .facts {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.15rem 0.6rem;
      margin: 0.75rem 0 0;
      font-size: 0.9rem;
    }
    .facts dt {
      color: #6b7280;
    }
    .facts dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .url {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    h2 {
      margin: 1.5rem 0 0.5rem;
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #6b7280;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 0.6rem;
    }
    .app {
      text-decoration: none;
      color: inherit;
    }
    .app-label {
      display: block;
      font-weight: 600;
    }
    .app-note {
      display: block;
      margin-top: 0.15rem;
      font-size: 0.8rem;
      color: #6b7280;
    }
  `,
})
export class RepositoryPage {
  private readonly api = inject(ProjectsApi);
  private readonly param = inject(ProjectParam);
  private readonly appLinks = inject(QitsAppLinks);
  private readonly document = inject(DOCUMENT);

  /** What the address says is on screen — never the route parameters, which is the platform rule. */
  private readonly scope = inject(QITS_SCOPE).scope;

  protected readonly none = NONE;

  protected readonly components = signal<Loadable<readonly RepositoryDto[]>>(LOADING);

  /** True once there is an answer, so the not-found arm cannot fire over a pending read. */
  protected readonly loaded = computed(() => this.components().kind === 'ready');

  /** The repository the address names, or nothing — a name this project does not hold. */
  protected readonly repository = computed(() => {
    const state = this.components();
    const name = this.scope().repository;
    if (state.kind !== 'ready' || !name) return undefined;
    return state.value.find((repository) => repository.name === name);
  });

  protected readonly label = computed(() => {
    const repository = this.repository();
    return repository ? repositoryLabel(repository) : '';
  });

  /**
   * The group heading this repository's archetype draws under — "Services", not `SERVICE`.
   *
   * The archetype is the fallback rather than the answer, so a value this build has never heard of
   * is still shown as itself instead of as an empty badge.
   */
  protected readonly categoryLabel = computed(() => {
    const archetype = this.repository()?.archetype;
    return COMPONENT_TYPES.find((type) => type.archetype === archetype)?.label ?? archetype ?? '';
  });

  protected readonly backup = computed(() => {
    const repository = this.repository();
    return repository ? backupBadge(repository) : null;
  });

  /**
   * The git host's name-addressed route, spelled with the GIT HOST's own origin.
   *
   * Not this host's, even though `/git` is path-routed on every vhost: the address a person is
   * given to paste should name the authority that serves it, which is `githost.<env>.<domain>`.
   * The environment origin is the fallback for a platform whose navigation names no git host yet,
   * and the browser's own for an app served without the platform in front of it.
   */
  protected readonly clone = computed(() => {
    const repository = this.repository();
    if (!repository) return '';
    const origin =
      this.appLinks.origin('qits-githost') ??
      this.appLinks.environmentOrigin() ??
      this.document.location?.origin ??
      '';
    return cloneUrl(origin, this.param.projectSlug(), repository.name || repository.id);
  });

  /**
   * One card per application the platform files under this repository's category.
   *
   * The slot is `<category>.details`, which is exactly what the sidebar draws under the repository
   * in scope — so the cards and the sub-menu can never offer two different sets. An entry whose
   * address this library cannot spell is dropped rather than drawn as a link to nowhere.
   */
  protected readonly applications = computed<readonly { entry: QitsNavEntry; href: string }[]>(
    () => {
      const scope = this.scope();
      if (!scope.category) return [];
      const slot: QitsNavSlot = `${scope.category}.details`;
      return this.appLinks
        .entries(slot)
        // The entry's subpath is the view it opens — '' is the application's root, so the cards
        // and the sidebar's rows stay the same URL.
        .map((entry) => ({ entry, href: this.appLinks.href(entry.app, entry.subpath, scope) }))
        .filter((card): card is { entry: QitsNavEntry; href: string } => card.href !== undefined);
    },
  );

  constructor() {
    // Keyed on the project, because the router re-uses this instance across a repository hop and
    // the component list is per project rather than per repository.
    effect(() => {
      const projectId = this.param.projectId();
      if (projectId) {
        void this.load(projectId);
      }
    });
  }

  protected reload(): void {
    void this.load(this.param.projectId());
  }

  private async load(projectId: string): Promise<void> {
    this.components.set(LOADING);
    try {
      const answer = await this.api.components(projectId);
      // Only settle if the answer is still about the project on screen.
      if (this.param.projectId() === projectId) {
        this.components.set(ready(answer.repositories));
      }
    } catch (error) {
      this.components.set(failed(error));
    }
  }
}
