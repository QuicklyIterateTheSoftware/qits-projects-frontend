import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import {
  QitsAppLinks,
  QitsButton,
  toNavTree,
  type QitsNavTree,
  type QitsNavigation,
} from '@qits/ui-components';
import { ComponentMapApi, type ComponentMapDto } from '../../api/component-map-api';
import { LOADING, failed, ready, type Loadable } from '../../ui/loadable';
import { Async } from '../../ui/async';
import { Empty } from '../../ui/empty';
import { PickedContext } from '../chat/picked-context';
import { freezeWebView, type WebViewFreeze } from '../design/freeze';
import { ElementPicker, type FramePick } from './element-picker';

/**
 * The Web view tab: the deployed environment, framed.
 *
 * A refinement looks at what is actually running and imagines how it should be — so this tab frames
 * the *environment this page is served from*, not a locally running process. That is the domain
 * line between this route and the workspaces detail screen: a workspace runs code and frames its
 * own dev server through the workspace proxy; a refinement runs nothing, and the only application
 * worth looking at is the deployed one.
 *
 * ## Same site, on purpose
 *
 * The list comes from `GET /main-navigation`, fetched **relative**: the edge answers it from its
 * deployment projection and derives the environment from the request's Host header, so the answer
 * is exactly the environment this page came from.
 *
 * <p>**Every application is a host of its own now** — `ci.<env>.<domain>`, `docs.<env>.<domain>` —
 * so the answer carries absolute origins and the frame's `src` is one of them. What is enforced is
 * *same site* rather than same origin: an href passes when its host is the environment's authority
 * or one label under it, and a relative href passes as it always did. Anything else is refused
 * however it got into the answer.
 *
 * <p>That is a real loss and it is worth naming: the toolbar's live-path readout, the URL bar and
 * the element picker all read *inside* the frame, and a cross-origin frame refuses every one of
 * those reads. So they work on this application's own pages and go quiet on a sibling host's,
 * which the toolbar already says out loud — the frame itself keeps working, because the session
 * cookie is set on the parent domain and travels to every host under it.
 *
 * There is deliberately no environment picker. Nothing on the platform can answer "what is the base
 * URL of environment X", and a foreign environment would carry no session anyway. You refine
 * against the environment you are standing in.
 *
 * ## What it loads
 *
 * **One `GET /main-navigation` when the panel first renders.** The edge answers `503` with
 * `Retry-After: 1` while its projection is warming up after a restart; that lands in the shared
 * async strip, whose Retry re-issues the read. The frame itself is a document load rather than an
 * API read, and it happens once — the panel latches on first selection and then only hides, so
 * switching tabs never reloads the app you were using.
 *
 * ## Freezing
 *
 * **Freeze** captures the framed page as it stands and hands it up as {@link frozen}; the page turns
 * that into a design row. It costs no request of its own — the capture is read out of the framed
 * document — and it is offered only on a same-origin frame, for the same reason the picker is: on a
 * foreign page every read of the document throws.
 *
 * **The picker adds one `GET /component-map` per activation**, and that is the whole of its cost.
 * It is fetched on arming rather than on load, because a tab nobody picks in should not pay for a
 * scan of the tree, and it is not fetched per *pick*. Attribution is an enrichment: an environment
 * whose UI the map does not describe simply answers picks without source files.
 */
@Component({
  selector: 'app-web-view-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsButton],
  templateUrl: './web-view-panel.html',
  styleUrl: './web-view-panel.css',
})
export class WebViewPanel {
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly maps = inject(ComponentMapApi);
  private readonly picked = inject(PickedContext);
  private readonly appLinks = inject(QitsAppLinks);

  readonly workspaceRowId = input.required<number>();

  /** A page captured off the frame. The refining page stores it as a design. */
  readonly frozen = output<WebViewFreeze>();

  protected readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  /** Which destination is framed, by href. A free level: it dies with the panel. */
  protected readonly chosen = signal<string | null>(null);

  /** Whether the URL bar is open. Opening it swaps the rest of the toolbar for the input. */
  protected readonly barOpen = signal(false);

  /** What the input holds, and what it held when the bar was opened — the reset target. */
  protected readonly barValue = signal('');
  private openedWith = '';

  /** What went wrong with a typed path. */
  protected readonly barProblem = signal<string | null>(null);

  /** Bumped on every frame load, so anything reading the framed location re-reads it. */
  protected readonly loads = signal(0);

  /** Whether the picker is armed. One-shot unless the pick was made with shift held. */
  protected readonly picking = signal(false);

  /** The attribution map for this activation, or null when it never arrived. */
  private readonly map = signal<ComponentMapDto | null>(null);

  /** How many elements are picked, from the store rather than from a count kept here. */
  protected readonly pickedCount = computed(() => this.picked.elements().length);

  /** The environment's navigation, as the edge answered it — normalised by the library. */
  protected readonly navigation = signal<Loadable<QitsNavTree>>(LOADING);

  private readonly picker = new ElementPicker({
    route: () => `/${this.livePath() ?? ''}`,
    map: () => this.map(),
    picked: (pick) => this.onPicked(pick),
  });

  constructor() {
    void this.load();

    // The marks in the frame follow the store, in both directions: a chip removed on the prompt
    // panel has to take its outline with it, or the frame becomes a second, wrong answer.
    effect(() => {
      const selectors = this.picked.elements().map((element) => element.selector);
      this.picker.mark(selectors);
    });

    inject(DestroyRef).onDestroy(() => this.picker.detach());

    // A link that goes away takes the selection with it; the first one takes it up.
    effect(() => {
      const framable = this.framable();
      const chosen = this.chosen();
      if (framable.length === 0) {
        return;
      }
      if (!chosen || !framable.some((link) => link.href === chosen)) {
        this.chosen.set(framable[0].href);
      }
    });
  }

  // ---- what is on screen -------------------------------------------------------------------

  /**
   * Where the environment itself is served — the authority every framable href is measured
   * against.
   *
   * The application's own navigation is asked first, because that is the platform's live statement
   * and it is what every other cross-application link in this SPA is built from. The panel's own
   * answer is the fallback, for a panel rendered without the chrome around it. Neither: no absolute
   * href is framable, which is the safe answer rather than a guess.
   */
  private readonly environmentOrigin = computed(() => {
    const state = this.navigation();
    const own = state.kind === 'ready' ? state.value.environmentOrigin : undefined;
    return this.appLinks.environmentOrigin() ?? own;
  });

  /**
   * The destinations worth framing: every one the environment publishes, kept to **this site**.
   *
   * <p>Two shapes arrive here. A pre-hosts edge answers a flat list of path-shaped hrefs, which is
   * what {@code legacy} carries and what this admitted before hosts existed. A current one answers
   * slots whose entries name a host — so an href is `https://ci.<env>.<domain>/` — plus the
   * environment origin for an application still served at a segment under it.
   *
   * <p>The filter is what lets {@link frameSrc} trust the URL it builds: a relative path, or an
   * absolute one whose host is the environment authority or exactly one label under it. An href
   * naming any other site is refused however it got into the answer.
   *
   * <p>One application can sit in several slots — qits-ci is under all six categories — so the list
   * is deduplicated by href; the sidebar wants the repetition and a picker does not.
   */
  protected readonly framable = computed<readonly FramableLink[]>(() => {
    const state = this.navigation();
    if (state.kind !== 'ready') {
      return [];
    }
    const authority = hostOf(this.environmentOrigin());
    const candidates = state.value.legacy
      ? state.value.legacy.map((link) => ({ label: link.label, href: link.href }))
      : state.value.entries.map((entry) => ({
          label: entry.label,
          href: entry.host
            ? `${trimEnd(entry.origin)}/`
            : `${trimEnd(state.value.environmentOrigin ?? '')}${entry.path}/`,
        }));
    const seen = new Set<string>();
    return candidates.filter((link) => {
      if (!isSameSite(link.href, authority) || seen.has(link.href)) {
        return false;
      }
      seen.add(link.href);
      return true;
    });
  });

  protected readonly link = computed<FramableLink | null>(() => {
    const chosen = this.chosen();
    return this.framable().find((candidate) => candidate.href === chosen) ?? null;
  });

  /**
   * The prefix the framed app lives under, with its trailing slash — the live path's base.
   *
   * The **path** of it, never the origin: it is compared against `location.pathname` inside the
   * frame, which carries no origin of its own. A hosted application's base is therefore `/`.
   */
  protected readonly base = computed(() => {
    const href = this.link()?.href;
    if (!href) {
      return '';
    }
    const path = pathOf(href);
    return path.endsWith('/') ? path : `${path}/`;
  });

  /** The same prefix as the frame will resolve it — absolute for a hosted application. */
  private readonly frameBase = computed(() => {
    const href = this.link()?.href;
    if (!href) {
      return '';
    }
    return href.endsWith('/') ? href : `${href}/`;
  });

  /** Where the frame lands: the link's own href. */
  protected readonly frameUrl = computed(() => this.link()?.href ?? null);

  /**
   * The same URL, trusted.
   *
   * Angular sanitizes an `iframe`'s `src` as a resource URL and refuses a plain string. Trusting
   * this one is not a shortcut: {@link framable} admits only a relative path or an absolute address
   * on this site — and a typed path goes through {@link navigate}, which refuses anything carrying
   * a scheme.
   */
  protected readonly frameSrc = computed<SafeResourceUrl | null>(() => {
    const url = this.frameUrl();
    return url === null ? null : this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  /**
   * The route the framed app is on **right now**, with the link's base prefix stripped.
   *
   * Read from the framed window rather than remembered from the source, so it tracks navigation
   * inside the app. A foreign-origin frame throws on the read and answers null, which the toolbar
   * renders as its own state rather than as an empty box.
   */
  protected readonly livePath = computed<string | null>(() => {
    this.loads();
    const element = this.frame()?.nativeElement;
    if (!element) {
      return null;
    }
    try {
      const location = element.contentWindow?.location;
      if (!location || location.href === 'about:blank') {
        return null;
      }
      const here = `${location.pathname}${location.search}${location.hash}`;
      const base = this.base();
      return here.startsWith(base) ? here.slice(base.length) : here;
    } catch {
      // Cross-origin. The frame still works; this page simply cannot see where it is.
      return null;
    }
  });

  /** Whether this page can see inside the frame at all. The picker's precondition, and the bar's. */
  protected readonly sameOrigin = computed(() => {
    this.loads();
    const element = this.frame()?.nativeElement;
    if (!element) {
      return false;
    }
    try {
      return element.contentDocument !== null;
    } catch {
      return false;
    }
  });

  // ---- what the panel does -----------------------------------------------------------------

  protected choose(href: string): void {
    this.chosen.set(href);
    this.barOpen.set(false);
  }

  /** Re-read the navigation — the strip's Retry, and the edge's warm-up `503` lands here too. */
  protected reload(): void {
    this.navigation.set(LOADING);
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const answer = await new Promise<QitsNavigation>((resolve, reject) =>
        this.http.get<QitsNavigation>('/main-navigation').subscribe({
          next: resolve,
          error: reject,
        }),
      );
      this.navigation.set(ready(toNavTree(answer)));
    } catch (error) {
      this.navigation.set(failed(error));
    }
  }

  protected onFrameLoad(): void {
    this.loads.update((count) => count + 1);
    // Navigating inside the app replaces the document, so the picker re-attaches through the load
    // hook — one code path for a link, for the URL bar and for a fresh source.
    if (this.picking()) {
      this.attachPicker();
    }
  }

  /**
   * Arm or disarm the picker.
   *
   * Arming is what fetches the map, once. A frame this page cannot see into is refused rather than
   * armed: the toolbar already says why, and a mode that captured nothing would be worse.
   */
  protected togglePicking(): void {
    if (this.picking()) {
      this.picking.set(false);
      this.picker.arm(false);
      return;
    }
    if (!this.sameOrigin()) {
      return;
    }
    this.picking.set(true);
    this.picker.arm(true);
    this.attachPicker();
    void this.loadMap();
  }

  protected clearPicks(): void {
    this.picked.clear();
  }

  /**
   * Capture the framed page.
   *
   * The route is stripped against the same {@link base} the live-path readout uses, so a design
   * records where it came from in the app's own terms. A capture that could not be made says so on
   * the toolbar's problem line rather than raising: nothing about the frame changed.
   */
  protected freeze(): void {
    const captured = freezeWebView(this.frame()?.nativeElement ?? null, this.base());
    if (!captured) {
      this.barProblem.set('Could not freeze the framed page.');
      return;
    }
    this.barProblem.set(null);
    this.frozen.emit(captured);
  }

  /** A pick: into the store, and disarmed unless shift said to keep going. */
  private onPicked(pick: FramePick): void {
    this.picked.toggleElement({
      tag: pick.tag,
      selector: pick.selector,
      textPreview: pick.textPreview,
      route: pick.route,
      componentName: pick.componentName,
      sourceFiles: pick.sourceFiles,
    });
    if (!pick.keepPicking) {
      this.picking.set(false);
      this.picker.arm(false);
    }
  }

  private attachPicker(): void {
    const document = frameDocument(this.frame()?.nativeElement ?? null);
    if (document) {
      this.picker.attach(document);
    }
  }

  /**
   * The map, once per activation.
   *
   * A failure is swallowed: attribution is an enrichment, and a pick with a selector and a route is
   * still a useful pick. A checkout whose tree the scanner does not recognise — the ordinary case
   * for a refinement, whose checkout is the project wrapper and not the framed UI's source — answers
   * an empty list, and that lands here as the same "no attribution" screen.
   */
  private async loadMap(): Promise<void> {
    try {
      this.map.set(await this.maps.componentMap(this.workspaceRowId()));
    } catch {
      this.map.set(null);
    }
  }

  /**
   * Open or close the URL bar.
   *
   * Opening seeds the input from the frame's *current* path, so it says where the app actually is.
   * **Closing discards**, which is why the opened value is kept: an edit that was never navigated to
   * must not survive as a claim about the frame.
   */
  protected toggleBar(): void {
    const open = !this.barOpen();
    this.barOpen.set(open);
    this.barProblem.set(null);
    if (open) {
      this.openedWith = this.livePath() ?? '';
      this.barValue.set(this.openedWith);
    }
  }

  protected resetBar(): void {
    this.barValue.set(this.openedWith);
    this.barProblem.set(null);
  }

  /**
   * Navigate the frame.
   *
   * An **in-frame location change**, not a new `src`: the app keeps whatever it holds that survives
   * a route change, and the load hook fires exactly as it would for a link inside the app — which is
   * what makes the picker re-attach through one code path rather than two.
   */
  protected navigate(): void {
    const typed = this.barValue().trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(typed) || typed.startsWith('//')) {
      this.barProblem.set('Only a path inside this application, not another address.');
      return;
    }
    const element = this.frame()?.nativeElement;
    if (!element) {
      return;
    }
    const target = this.frameBase() + typed.replace(/^\/+/, '');
    this.barProblem.set(null);
    try {
      const window = element.contentWindow;
      if (window) {
        window.location.assign(target);
        return;
      }
    } catch {
      // Cross-origin: the frame cannot be driven from here, so replace it wholesale instead.
    }
    element.src = target;
  }
}

/** One destination the panel can offer: what it is called, and the address it frames. */
export interface FramableLink {
  readonly label: string;
  readonly href: string;
}

/** The host of an origin, port included — or `undefined` for anything that is not one. */
function hostOf(origin: string | undefined): string | undefined {
  if (!origin) {
    return undefined;
  }
  try {
    return new URL(origin).host;
  } catch {
    return undefined;
  }
}

/** The path part of an href, which is the whole of it when it is already relative. */
function pathOf(href: string): string {
  if (href.startsWith('/') && !href.startsWith('//')) {
    return href;
  }
  try {
    return new URL(href).pathname;
  } catch {
    return '/';
  }
}

function trimEnd(origin: string): string {
  return origin.replace(/\/+$/, '');
}

/**
 * Whether an href may reach the frame: a relative path, or an absolute one on this environment.
 *
 * "On this environment" is the authority itself or exactly one label under it — `dev.example.com`
 * and `ci.dev.example.com`, and never `evil-dev.example.com`, which is why the test is on a `.`
 * boundary rather than a suffix. A protocol-relative `//host` href is refused outright: it names
 * another site while looking like a path.
 */
function isSameSite(href: string, authority: string | undefined): boolean {
  if (href.startsWith('//')) {
    return false;
  }
  if (href.startsWith('/')) {
    return true;
  }
  const host = hostOf(href);
  if (!host || !authority) {
    return false;
  }
  return host === authority || host.endsWith(`.${authority}`);
}

/** The framed document, or null when the frame is missing or on another origin. */
function frameDocument(frame: HTMLIFrameElement | null): Document | null {
  if (!frame) {
    return null;
  }
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}
