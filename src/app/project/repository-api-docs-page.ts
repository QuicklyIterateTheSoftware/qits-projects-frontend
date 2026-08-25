import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { QITS_NAVIGATION, QITS_SCOPE, QitsAppLinks } from '@qits/ui-components';

/**
 * One repository's browsable API documentation — the swagger-ui its own service serves — framed
 * under the repository detail.
 *
 * <p><b>The repository name IS the application name</b> (the repository `qits-ci` deploys the
 * application `qits-ci`), so the lookup is one read of the navigation's per-application metadata:
 * `apiDocsUrl(scope().repository)`. The URL it answers is the service's own origin plus the path
 * the service declared (`api-docs:` in its deployments.yml) — one of its own routes, served by its
 * own host. The environment door serves no path.
 *
 * <p>The document is an `<iframe>` because swagger-ui is a whole page of its own — its styles, its
 * try-it-out forms, its deep links — and it knows nothing about platform scope; this page is the
 * scope-aware wrapper that picks the right one. Absence is a real answer the platform states by
 * saying nothing: a repository whose service publishes no `api-docs` path gets the empty state,
 * not a frame full of 404.
 */
@Component({
  selector: 'app-repository-api-docs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (docsHref(); as href) {
      <header class="bar">
        <span class="name">{{ repository() }} API documentation</span>
        <!-- The escape hatch: the same URL, outside the frame — for bookmarks, for wide screens,
             and for anything the framed page refuses to do. -->
        <a class="open" [href]="href" target="_blank" rel="noopener">Open in new tab</a>
      </header>
      <iframe class="docs" [src]="frameUrl()" [title]="repository() + ' API documentation'"></iframe>
    } @else if (pending()) {
      <p class="state">Loading the platform navigation…</p>
    } @else if (unavailable()) {
      <p class="state">
        The platform navigation is unavailable, so the API documentation cannot be located.
      </p>
    } @else {
      <p class="state">{{ repository() }} publishes no API documentation.</p>
    }
  `,
  styles: `
    /* Inside QitsMainLayout's content area, which already scrolls and pads — the negative margin
       undoes that padding, the Reader's rule: a framed document is one surface edge to edge. */
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      margin: -16px;
    }
    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      padding: 0.5rem 16px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 0.9rem;
    }
    .name {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .open {
      white-space: nowrap;
    }
    .docs {
      display: block;
      border: 0;
      width: 100%;
      flex: 1;
      min-height: 0;
    }
    .state {
      margin: 16px;
      padding: 16px;
      color: #6b7280;
    }
  `,
})
export class RepositoryApiDocsPage {
  private readonly appLinks = inject(QitsAppLinks);
  private readonly navigation = inject(QITS_NAVIGATION);
  private readonly sanitizer = inject(DomSanitizer);

  /** What the address says is on screen — never the route parameters, which is the platform rule. */
  private readonly scope = inject(QITS_SCOPE).scope;

  protected readonly repository = computed(() => this.scope().repository ?? '');

  /** Still waiting for the one navigation answer this page needs. */
  protected readonly pending = computed(() => this.navigation.tree() === undefined);

  /** The navigation will never answer — a broken platform, distinct from a repository without docs. */
  protected readonly unavailable = computed(() => this.navigation.failed());

  /**
   * The document's address as a STRING, or `undefined` while there is nothing to frame — no
   * repository in scope, no answer yet, or a service that publishes none. The template renders
   * each of those as words rather than pointing a frame somewhere it should not go.
   */
  protected readonly docsHref = computed(() => {
    const repository = this.scope().repository;
    return repository ? this.appLinks.apiDocsUrl(repository) : undefined;
  });

  /**
   * The same address, trusted — computed SEPARATELY from the string on purpose, the Reader's rule:
   * `bypassSecurityTrustResourceUrl` returns a new object every call, an unequal `[src]` reloads
   * the frame, so the wrapper must only run when the string actually changes.
   *
   * <p>The bypass is safe here: the URL is an origin the platform itself served in
   * `/main-navigation`, plus a path the deployment pipeline validated against the service's own
   * published routes.
   */
  protected readonly frameUrl = computed(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(this.docsHref() ?? 'about:blank'),
  );
}
