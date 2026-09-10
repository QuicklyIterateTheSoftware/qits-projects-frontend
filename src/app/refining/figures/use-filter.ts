import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * The *In use* / *Dangling* filter, on both tabs a dossier figure comes from.
 *
 * **What the flag means, and the tooltip says it:** *in use* is "some dossier page inlines this". So
 * a dangling figure is safe to delete and an in-use one is not — the dossier keeps its own copy
 * either way, but deleting the source loses the ability to re-inline a fresh version of it.
 *
 * **Neither chip is selected by default.** The unfiltered list is the landing state: a filter that
 * came on by itself would hide work somebody had just made.
 *
 * The flag arrives on each row from the service, in one query per listing rather than one per row —
 * which is only answerable because inlining copies a figure under the source's own id.
 */
export type UseFilter = 'in-use' | 'dangling' | null;

/** Anything with the flag: a sketch or a design, both of which can be inlined. */
export interface Usable {
  readonly inUse?: boolean;
}

/** The rows a filter leaves. `null` is "no filter", which is where both tabs open. */
export function filterByUse<T extends Usable>(rows: readonly T[], filter: UseFilter): readonly T[] {
  if (filter === null) return rows;
  return rows.filter((row) => (filter === 'in-use' ? row.inUse === true : row.inUse !== true));
}

@Component({
  selector: 'app-use-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="group" role="group" aria-label="Filter by dossier use">
      <button
        type="button"
        class="chip"
        [class.on]="filter() === 'in-use'"
        [attr.aria-pressed]="filter() === 'in-use'"
        title="A dossier page inlines this. Deleting it here keeps the page — but loses the chance to re-inline a fresh version."
        (click)="choose('in-use')"
      >
        In use ({{ inUseCount() }})
      </button>
      <button
        type="button"
        class="chip"
        [class.on]="filter() === 'dangling'"
        [attr.aria-pressed]="filter() === 'dangling'"
        title="No dossier page inlines this, so it is safe to delete."
        (click)="choose('dangling')"
      >
        Dangling ({{ danglingCount() }})
      </button>
    </div>
  `,
  styles: `
    .group {
      display: flex;
      gap: 0.35rem;
    }
  `,
})
export class UseFilterChips {
  /** Every row, unfiltered — the counts are of the whole list, not of what is shown. */
  readonly rows = input<readonly Usable[]>([]);

  /** Which chip is lit, `null` for neither. */
  readonly filter = input<UseFilter>(null);

  /** The chip pressed; pressing the lit one clears the filter. */
  readonly chosen = output<UseFilter>();

  protected readonly inUseCount = computed(
    () => this.rows().filter((row) => row.inUse === true).length,
  );

  protected readonly danglingCount = computed(
    () => this.rows().filter((row) => row.inUse !== true).length,
  );

  protected choose(which: Exclude<UseFilter, null>): void {
    this.chosen.emit(this.filter() === which ? null : which);
  }
}
