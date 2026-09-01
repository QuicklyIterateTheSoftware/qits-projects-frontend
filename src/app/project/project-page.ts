import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsAppLinks, QitsCard } from '@qits/ui-components';
import { ProjectParam } from '../nav/project-param';

/** The application this SPA is, so its own placements are not drawn twice — see {@link ProjectPage}. */
const PROJECTS_APP = 'qits-projects';

/** One way into the project: what it is called, and who answers it. */
interface HubLink {
  readonly key: string;
  readonly label: string;
  /** Which application serves it — the same note the repository page's cards carry. */
  readonly note: string;
}

/** A sub-element of this application: reached with the router, so its address is a command array. */
interface OwnLink extends HubLink {
  readonly route: readonly string[];
}

/** A sub-element of another application: its own host, so its address is a whole URL. */
interface ElsewhereLink extends HubLink {
  readonly href: string;
}

/**
 * A project: what it is, and the ways into it.
 *
 * <p><b>This address is a hub node now, and holds no work of its own.</b> It used to be the epics
 * board, which made the plan a thing a reader could only find by knowing that the bare project
 * address renders it — there was no row in the chrome saying so. The board moved to `epics`, one
 * segment down, where it is a sub-element beside `project-setup` and the workspaces application's
 * own two, and this page became what the repository page already is one level down: a name, and a
 * card per place the project is worked on.
 *
 * <p><b>It costs nothing.</b> The name and the description come from the shared project list {@link
 * ProjectParam} has already read to resolve the address's slug, and the cards are composed from the
 * navigation the chrome asked the edge for. A hub that fetched would be a page that makes a reader
 * wait to be told where to go.
 *
 * <p><b>The description is the only "general information" here, and only when there is one.</b> A
 * project without one draws the links and nothing else, rather than an empty paragraph or a
 * placeholder sentence saying that nothing was written.
 *
 * <p><b>Two of the cards are this application's own routes and the rest are the platform's.</b> The
 * first two are `routerLink`s — they stay inside this SPA, so a full page load would be a
 * self-inflicted round trip — and the others are plain `href`s to other Angular applications on
 * hosts of their own, composed from the `project.detail` slot exactly as the sidebar composes the
 * same rows. That is what keeps a card and its sidebar row one URL by construction, and what keeps
 * an application the platform does not run from appearing here as a dead link.
 *
 * <p>This application's <b>own</b> entries in that slot are dropped: `project.detail.Epics` is how
 * the Epics row reaches the sidebar, and drawing it from the registry as well would put the same
 * destination on the page twice — once as a router hop and once as a page load. The internal
 * declaration wins because it is the cheaper of the two and because it is there before any edge has
 * answered.
 */
@Component({
  selector: 'app-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsCard, RouterLink],
  template: `
    <h1>{{ heading() }}</h1>
    @if (description(); as description) {
      <p class="description">{{ description }}</p>
    }

    <div class="cards">
      @for (link of own(); track link.key) {
        <a class="app" [routerLink]="link.route">
          <qits-card>
            <span class="app-label">{{ link.label }}</span>
            <span class="app-note">{{ link.note }}</span>
          </qits-card>
        </a>
      }
      @for (link of elsewhere(); track link.key) {
        <a class="app" [href]="link.href">
          <qits-card>
            <span class="app-label">{{ link.label }}</span>
            <span class="app-note">{{ link.note }}</span>
          </qits-card>
        </a>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .description {
      margin: 0 0 1rem;
      color: #374151;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 0.6rem;
      margin-top: 1rem;
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
export class ProjectPage {
  private readonly param = inject(ProjectParam);
  private readonly appLinks = inject(QitsAppLinks);

  /** The slug every link is spelled with. */
  protected readonly projectSlug = this.param.projectSlug;

  private readonly project = computed(() => {
    const state = this.param.currentProject()();
    return state.kind === 'ready' ? state.value : undefined;
  });

  /** The project's display name, once the shared list has answered. The address until then. */
  protected readonly heading = computed(() => this.project()?.name ?? this.param.segment());

  protected readonly description = computed(() => this.project()?.description ?? '');

  /**
   * The sub-elements this application serves itself, in the order a reader needs them: the plan
   * first, because it is what a project is mostly for, and its configuration second, because setting
   * a project up is rare.
   *
   * <p>The addresses are relative to the root and spelled with the slug, which is the same address
   * the sidebar's own rows carry — this page just reaches them with the router.
   */
  protected readonly own = computed<readonly OwnLink[]>(() => {
    const project = this.projectSlug();
    return [
      { key: 'epics', label: 'Epics', note: PROJECTS_APP, route: ['/', project, 'epics'] },
      {
        key: 'project-setup',
        label: 'Project setup',
        note: PROJECTS_APP,
        route: ['/', project, 'project-setup'],
      },
    ];
  });

  /**
   * One card per application the platform files under the project — the `project.detail` slot, which
   * is the same list the chrome draws under the Project row.
   *
   * <p>An entry whose address this library cannot spell is dropped rather than drawn as a link to
   * nowhere, and this application's own entries are left to {@link own} above.
   */
  protected readonly elsewhere = computed<readonly ElsewhereLink[]>(() => {
    const scope = { project: this.projectSlug() };
    return this.appLinks
      .entries('project.detail')
      .filter((entry) => entry.app !== PROJECTS_APP)
      .map((entry) => ({
        key: `${entry.app}:${entry.label}`,
        label: entry.label,
        note: entry.app,
        // The entry's subpath is the view it opens — '' is the application's root under this scope.
        href: this.appLinks.href(entry.app, entry.subpath, scope) ?? '',
      }))
      .filter((link) => link.href.length > 0);
  });
}
