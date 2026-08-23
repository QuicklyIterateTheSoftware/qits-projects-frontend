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
import { QitsButton, type QitsNavLink, type QitsNavigation } from '@qits/ui-components';
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
 * ## Same origin, on purpose
 *
 * The list comes from `GET /main-navigation`, fetched **relative**: the edge answers it from its
 * deployment projection and derives the environment from the request's Host header, so the answer
 * is exactly the environment this page came from. The frame's `src` is the selected link's
 * **relative** `href`, which makes the framed UI same-origin by construction — and that is not a
 * convenience: it is what lets the toolbar read the framed window's **live** location as the user
 * navigates, and it is what the element picker needs to exist at all.
 *
 * There is deliberately no environment picker. Nothing on the platform can answer "what is the base
 * URL of environment X", and a foreign origin would go dark for the toolbar and the picker anyway.
 * You refine against the environment you are standing in.
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

  /** The environment's navigation, as the edge answered it. */
  protected readonly navigation = signal<Loadable<readonly QitsNavLink[]>>(LOADING);

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
   * The links worth framing: every one the environment publishes, kept to **relative** hrefs.
   *
   * The edge only ever answers path-shaped hrefs; the filter is what lets {@link frameSrc} trust
   * the URL it builds — nothing carrying a scheme or a `//` authority can reach the frame, however
   * the answer was produced.
   */
  protected readonly framable = computed<readonly QitsNavLink[]>(() => {
    const state = this.navigation();
    if (state.kind !== 'ready') {
      return [];
    }
    return state.value.filter((link) => link.href.startsWith('/') && !link.href.startsWith('//'));
  });

  protected readonly link = computed<QitsNavLink | null>(() => {
    const chosen = this.chosen();
    return this.framable().find((candidate) => candidate.href === chosen) ?? null;
  });

  /** The prefix the framed app lives under, with its trailing slash — the live path's base. */
  protected readonly base = computed(() => {
    const link = this.link();
    if (!link) {
      return '';
    }
    return link.href.endsWith('/') ? link.href : `${link.href}/`;
  });

  /** Where the frame lands: the link's own relative href. */
  protected readonly frameUrl = computed(() => this.link()?.href ?? null);

  /**
   * The same URL, trusted.
   *
   * Angular sanitizes an `iframe`'s `src` as a resource URL and refuses a plain string. Trusting
   * this one is not a shortcut: {@link framable} admits only path-shaped hrefs, so the frame can
   * only ever land inside this page's own origin — and a typed path goes through {@link navigate},
   * which refuses anything carrying a scheme.
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
      this.navigation.set(ready(answer?.links ?? []));
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
    const target = this.base() + typed.replace(/^\/+/, '');
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
