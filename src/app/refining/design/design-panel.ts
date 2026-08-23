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
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { QitsButton } from '@qits/ui-components';
import { DesignsApi, type DesignDto, type DesignResolution } from '../../api/designs-api';
import { WorkspaceEvents } from '../../api/workspace-events';
import { Async } from '../../ui/async';
import { Empty } from '../../ui/empty';
import { formatRelativeTime } from '../../ui/format';
import {
  IDLE,
  LOADING,
  describeError,
  failed,
  ready,
  statusOf,
  type Loadable,
} from '../../ui/loadable';
import { DesignSelection } from './design-selection';

/**
 * The Design tab: the frozen pages of this application, and the agent's answers to them.
 *
 * ## What a design is
 *
 * A page of the running application, frozen from the Web view tab with every computed style inlined
 * — so it renders like the original without the original's stylesheets, and keeps rendering that way
 * after the application has moved on. That is the point: a design is what the reader and the agent
 * are talking *about*, and it must not change underneath the conversation.
 *
 * ## Proposals, and why nothing is overwritten
 *
 * An agent does not edit a design. It writes another row — `PROPOSED`, pointing at the one it is
 * answering — and stops. A person then says which of the two is the truth:
 *
 * - **Replace original** folds the proposal's markup into the design it was based on. One row
 *   survives, and it is the one every earlier reference already names.
 * - **Keep as new** promotes the proposal to a design of its own and leaves the original standing —
 *   two pages, both real, which is what a variant is.
 * - **Discard** deletes it.
 *
 * The service answers a resolve with **the row that survived**, so the panel re-selects that rather
 * than guessing which id it is now looking at.
 *
 * ## The frame runs nothing, ever
 *
 * The stored markup is rendered in `<iframe sandbox="allow-same-origin">` and **never with
 * `allow-scripts`**. This html was authored by an agent, and it is drawn on this page's own origin;
 * a script in it would hold the reader's session. `allow-same-origin` is granted alone and for one
 * reason: the frozen page's images are proxied paths that only load with the session cookie.
 * Angular sanitizes `[srcdoc]` as HTML, and the bypass here is what lets a whole document through —
 * the sandbox, not the sanitizer, is what makes that safe.
 *
 * ## What it loads
 *
 * The listing on first open — the gallery, which carries no markup — and one single read per
 * design opened, which is the only read that does. It follows the quiet-panel visibility rule: no
 * refetching behind another tab, one catch-up read on becoming visible, and the selection survives
 * a hide.
 */
@Component({
  selector: 'app-design-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsButton],
  templateUrl: './design-panel.html',
  styleUrl: './design-panel.css',
})
export class DesignPanel {
  private readonly api = inject(DesignsApi);
  private readonly events = inject(WorkspaceEvents);
  private readonly requestedSelection = inject(DesignSelection);
  private readonly sanitizer = inject(DomSanitizer);

  /** Which refinement the designs hang off. The row id, which is what the host addresses. */
  readonly workspaceRowId = input.required<number>();

  /** Whether this tab is showing. It gates the listing read and nothing else. */
  readonly visible = input(false);

  /** The gallery. */
  protected readonly designs = signal<Loadable<readonly DesignDto[]>>(IDLE);

  /** The opened design, with its markup. Its own state: the strip stands while a page fails. */
  protected readonly page = signal<Loadable<DesignDto>>(IDLE);

  /** Which tile is lit. Null is "nothing opened", which is where the panel starts. */
  private readonly selectedId = signal<string | null>(null);

  /** On a proposal with a base, which of the two the frame is showing. */
  protected readonly viewing = signal<'proposed' | 'current'>('proposed');

  /** The action in flight, by name, so one press spins one button. */
  protected readonly busy = signal<string | null>(null);

  /** What went wrong with the last press, as a whole sentence. */
  protected readonly failure = signal<string | null>(null);

  /** The rename input's value, and whether it is open. */
  protected readonly renaming = signal(false);
  protected readonly renameValue = signal('');

  private readonly designHints = this.events.invalidations('designs');

  private loadedFor: number | null = null;
  private seenHint = -1;
  private missedHint = false;
  /** What the opened page was read for — id and stamp — so the same row is not re-read. */
  private pageKey = '';
  /** Bumped per page read; a late answer paints only if it is still the latest. */
  private pageSeq = 0;

  constructor() {
    // Driven off the id and the hint, gated on visibility — never off a click, so a deep link and a
    // press behave identically.
    effect(() => {
      const workspaceRowId = this.workspaceRowId();
      const hint = this.designHints();
      const visible = this.visible();
      untracked(() => this.decideRead(workspaceRowId, hint, visible));
    });

    // The markup follows whatever is on screen, and re-reads when that row's stamp moves — an agent
    // replacing a design must not leave the frame showing the page it replaced.
    effect(() => {
      const id = this.shownId();
      const stamp = this.rows().find((row) => row.id === id)?.updatedAt ?? '';
      untracked(() => void this.loadPage(id, stamp));
    });

    effect(() => {
      const designId = this.requestedSelection.designId();
      const row = this.rows().find((candidate) => candidate.id === designId);
      if (designId && row) {
        untracked(() => {
          this.select(row);
          this.requestedSelection.consumed(designId);
        });
      }
    });
  }

  // ---- what is on screen -------------------------------------------------------------------

  protected readonly rows = computed<readonly DesignDto[]>(() => {
    const state = this.designs();
    return state.kind === 'ready' ? state.value : [];
  });

  /**
   * The design the tiles point at.
   *
   * Derived rather than stored, so a row that vanishes underneath the selection — resolved in
   * another tab, say — quietly reads as "nothing opened" instead of leaving the panel pointed at a
   * row that is gone.
   */
  protected readonly selectedRow = computed<DesignDto | null>(() => {
    const id = this.selectedId();
    return id === null ? null : (this.rows().find((row) => row.id === id) ?? null);
  });

  protected readonly isProposal = computed(() => this.selectedRow()?.status === 'PROPOSED');

  /** The design a proposal answers, when it answers one. */
  protected readonly baseRow = computed<DesignDto | null>(() => {
    const baseId = this.selectedRow()?.basedOnDesignId;
    return baseId ? (this.rows().find((row) => row.id === baseId) ?? null) : null;
  });

  /** Which row's markup the frame is showing: the proposal, or the design it would replace. */
  private readonly shownId = computed<string | null>(() => {
    const selected = this.selectedRow();
    if (!selected) {
      return null;
    }
    const baseId = selected.basedOnDesignId;
    return this.viewing() === 'current' && baseId ? baseId : selected.id;
  });

  protected readonly shownRow = computed<DesignDto | null>(() => {
    const state = this.page();
    return state.kind === 'ready' ? state.value : null;
  });

  /**
   * The frozen page, trusted so the whole document reaches `srcdoc`.
   *
   * Safe because of the sandbox on the element and not because of anything about the markup — see
   * the class note. Nothing in it can run.
   */
  protected readonly srcdoc = computed<SafeHtml | null>(() => {
    const html = this.shownRow()?.html;
    return html === undefined ? null : this.sanitizer.bypassSecurityTrustHtml(html);
  });

  protected readonly frameTitle = computed(() => {
    const row = this.shownRow();
    return row ? `${row.title}, frozen` : 'A frozen design';
  });

  protected isSelected(design: DesignDto): boolean {
    return this.selectedId() === design.id;
  }

  /** `12 kB`, rounded up, because a design under half a kilobyte is still a design. */
  protected sizeLabel(design: DesignDto): string {
    return `${Math.max(1, Math.round(design.htmlBytes / 1024))} kB`;
  }

  protected whenLabel(design: DesignDto): string {
    return formatRelativeTime(design.updatedAt);
  }

  // ---- what the panel does -----------------------------------------------------------------

  /** Open a design. A fresh selection always shows the row itself, never the base it answers. */
  protected select(design: DesignDto): void {
    this.selectedId.set(design.id);
    this.viewing.set('proposed');
    this.renaming.set(false);
    this.failure.set(null);
  }

  protected show(which: 'proposed' | 'current'): void {
    this.viewing.set(which);
  }

  /** Fold the proposal into the design it answers, then follow the row that survived. */
  protected replaceOriginal(): Promise<void> {
    const row = this.selectedRow();
    if (!row?.basedOnDesignId) {
      return Promise.resolve();
    }
    return this.settle('replace', row.id, 'REPLACE');
  }

  /** Promote the proposal to a design of its own, leaving the original standing. */
  protected keepAsNew(): Promise<void> {
    const row = this.selectedRow();
    return row ? this.settle('keep', row.id, 'KEEP') : Promise.resolve();
  }

  private settle(action: string, designId: string, mode: DesignResolution): Promise<void> {
    return this.act(action, async (workspaceRowId) => {
      const survivor = await this.api.resolve(workspaceRowId, designId, mode);
      // The service says which row is left; guessing it here would point the panel at a deleted id.
      this.selectedId.set(survivor.id);
      this.viewing.set('proposed');
    });
  }

  /** Delete the opened design — a proposal being discarded, or a design being dropped. */
  protected remove(): Promise<void> {
    const row = this.selectedRow();
    if (!row) {
      return Promise.resolve();
    }
    return this.act('remove', async (workspaceRowId) => {
      await this.api.remove(workspaceRowId, row.id);
      this.selectedId.set(null);
    });
  }

  protected startRename(): void {
    this.renameValue.set(this.selectedRow()?.title ?? '');
    this.renaming.set(true);
  }

  protected cancelRename(): void {
    this.renaming.set(false);
  }

  protected saveRename(): Promise<void> {
    const row = this.selectedRow();
    const title = this.renameValue().trim();
    if (!row || !title) {
      return Promise.resolve();
    }
    return this.act('rename', async (workspaceRowId) => {
      await this.api.rename(workspaceRowId, row.id, title);
      this.renaming.set(false);
    });
  }

  protected reload(): void {
    void this.load(this.workspaceRowId());
  }

  protected rereadPage(): void {
    this.pageKey = '';
    const id = this.shownId();
    const stamp = this.rows().find((row) => row.id === id)?.updatedAt ?? '';
    void this.loadPage(id, stamp);
  }

  /**
   * One write, then a re-read of the strip.
   *
   * The 413 is named rather than printed as a status code: it is the only failure here a reader can
   * act on, and "over the size limit" is what tells them the page they froze was too big.
   */
  private async act(
    action: string,
    write: (workspaceRowId: number) => Promise<void>,
  ): Promise<void> {
    const workspaceRowId = this.workspaceRowId();
    if (workspaceRowId <= 0 || this.busy()) {
      return;
    }
    this.busy.set(action);
    this.failure.set(null);
    try {
      await write(workspaceRowId);
    } catch (error) {
      this.failure.set(
        statusOf(error) === 413
          ? 'That did not work — the page is over the size limit.'
          : `That did not work — ${describeError(error)}.`,
      );
      return;
    } finally {
      this.busy.set(null);
    }
    await this.load(workspaceRowId);
  }

  /**
   * Whether to read now.
   *
   * A hint that lands while another tab is showing is remembered and spent as one catch-up read on
   * becoming visible — refetching behind a hidden tab would pay for a gallery nobody is looking at.
   */
  private decideRead(workspaceRowId: number, hint: number, visible: boolean): void {
    if (workspaceRowId <= 0) {
      return;
    }
    if (hint !== this.seenHint) {
      this.seenHint = hint;
      this.missedHint = true;
    }
    if (!visible) {
      return;
    }
    if (this.loadedFor === workspaceRowId && !this.missedHint) {
      return;
    }
    this.missedHint = false;
    this.loadedFor = workspaceRowId;
    void this.load(workspaceRowId);
  }

  private async load(workspaceRowId: number): Promise<void> {
    if (workspaceRowId <= 0) {
      return;
    }
    this.designs.set(LOADING);
    try {
      this.designs.set(ready(await this.api.list(workspaceRowId)));
    } catch (error) {
      this.designs.set(failed(error));
    }
  }

  private async loadPage(designId: string | null, stamp: string): Promise<void> {
    const key = `${designId}:${stamp}`;
    if (key === this.pageKey) {
      return;
    }
    this.pageKey = key;
    if (!designId) {
      this.page.set(IDLE);
      return;
    }
    const seq = ++this.pageSeq;
    this.page.set(LOADING);
    try {
      const design = await this.api.get(this.workspaceRowId(), designId);
      if (seq === this.pageSeq) {
        this.page.set(ready(design));
      }
    } catch (error) {
      if (seq === this.pageSeq) {
        this.page.set(failed(error));
      }
    }
  }
}
