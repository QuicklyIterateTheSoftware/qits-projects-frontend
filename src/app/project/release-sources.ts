import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { ReleaseRequestDto, ReleaseRequestSourceDto } from '../api/dto';
import { ReleaseRequestsApi } from '../api/release-requests-api';
import { describeError } from '../ui/loadable';
import {
  canPrioritiseSource,
  canSetPriority,
  priorityOptions,
  releasePriorityBadge,
  releaseSources,
  sourceTitle,
} from './release-requests-model';

/**
 * What a release request is folding together, as one chip per participant.
 *
 * <p>It exists as a component rather than as markup in each page because both release-request lists
 * draw the same thing at two scopes, and a request is no longer a branch and a sha: it is a set, and
 * a set drawn two slightly different ways would read as two different facts.
 *
 * <p><b>The implicit chips look different, and that is the whole design.</b> A named branch is
 * somebody's choice and can be taken off the request; a `RELEASED_TAG` is a release of the same
 * repository that has not reached `main` yet, which the service adds and removes on its own. Drawing
 * them identically would invite a reader to go looking for who added a tag they are then told they
 * cannot remove — so the derived ones are dashed and muted, and say what they are on hover.
 *
 * <p><b>Each named chip carries what its branch is worth</b>, because the request's own badge is a
 * maximum and a maximum does not say *which* branch is the urgent one. The implicit ones carry
 * nothing, which is the honest answer rather than a default: a tag the service added underneath was
 * never given a priority by anybody.
 *
 * <p><b>Where the host asks for it, the word becomes a select</b> — the one place a priority can be
 * changed. The lists do not ask: they are scanned and they poll, and a form control on every row of
 * a page that redraws itself every six seconds is a control that moves under the hand using it. The
 * request's own page asks, because that is where somebody has already decided which release they
 * care about.
 *
 * <p>The change is posted from here rather than from the page: a source knows its own request, the
 * request carries the repository it belongs to, and the answer is the whole request — which is
 * emitted, so the host replaces the row it already holds instead of paying for a re-read.
 */
@Component({
  selector: 'app-release-sources',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sources().length) {
      <ul class="sources">
        @for (source of sources(); track source.ref) {
          <li class="source" [class.implicit]="source.implicit" [title]="title(source)">
            <span class="name">{{ source.name }}</span>
            @if (editable() && prioritisable(source)) {
              <!-- The chosen option carries "selected" rather than the select carrying a bound
                   value: a value bound on the select is written before the options below it exist,
                   and a select whose value matches nothing shows its first option — which would
                   draw every branch as LOWEST and post that back on the next change. -->
              <select
                class="picker"
                [attr.aria-label]="'Priority of ' + source.name"
                [disabled]="!settable() || busy() !== null"
                (change)="choose(source, $event)"
              >
                @if (!source.priority) {
                  <option value="" selected>unset</option>
                }
                @for (option of options(source); track option) {
                  <option [value]="option" [selected]="option === source.priority">
                    {{ option.toLowerCase() }}
                  </option>
                }
              </select>
            } @else if (priority(source); as badge) {
              <span [class]="'priority ' + badge.tone">{{ badge.label }}</span>
            }
          </li>
        }
      </ul>
      @if (failure(); as failure) {
        <p class="failed" role="alert">
          Could not set the priority of {{ failure.name }} — {{ failure.message }}.
        </p>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .sources {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.3rem;
      margin: 0.3rem 0 0;
      padding: 0;
    }
    .source {
      display: inline-flex;
      align-items: baseline;
      gap: 0.35rem;
      border: 1px solid #e5e7eb;
      border-radius: 0.25rem;
      padding: 0.05rem 0.35rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
      color: #374151;
      background: #f9fafb;
      overflow-wrap: anywhere;
    }
    .source.implicit {
      border-style: dashed;
      color: #6b7280;
      background: transparent;
      font-style: italic;
    }
    .priority {
      font-family: inherit;
      font-size: 0.72rem;
      font-style: normal;
      color: #6b7280;
    }
    .priority.warning {
      color: #b45309;
    }
    .priority.danger {
      color: #b91c1c;
    }
    .picker {
      font: inherit;
      font-size: 0.72rem;
      color: #374151;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 0.2rem;
      padding: 0 0.15rem;
    }
    .picker:disabled {
      color: #6b7280;
      background: transparent;
    }
    .failed {
      margin: 0.35rem 0 0;
      font-size: 0.85rem;
      color: #b91c1c;
    }
  `,
})
export class ReleaseSources {
  private readonly api = inject(ReleaseRequestsApi);

  readonly request = input.required<ReleaseRequestDto>();

  /**
   * Whether this host offers the priority as a control rather than as a word. It says nothing about
   * whether the service would take the change — that is the request's state, and this component
   * asks {@link canSetPriority} itself, so no page can offer a control the service answers 409 to.
   */
  readonly editable = input(false, { transform: booleanAttribute });

  /** The whole request as the service answered the change, for the host to put in place of its own. */
  readonly changed = output<ReleaseRequestDto>();

  protected readonly title = sourceTitle;
  protected readonly priority = (source: ReleaseRequestSourceDto) =>
    releasePriorityBadge(source.priority);
  protected readonly options = (source: ReleaseRequestSourceDto) =>
    priorityOptions(source.priority);
  protected readonly prioritisable = canPrioritiseSource;

  protected readonly sources = computed(() => releaseSources(this.request()));

  /**
   * Whether the service would take a change to this request at all. A RELEASED or WITHDRAWN request
   * keeps its selects — what each branch was worth is part of what shipped — but they are inert.
   */
  protected readonly settable = computed(() => canSetPriority(this.request()));

  /** The branch whose change is in flight, which locks every select rather than only its own. */
  protected readonly busy = signal<string | null>(null);

  protected readonly failure = signal<{ readonly name: string; readonly message: string } | null>(
    null,
  );

  /**
   * Post the chosen priority, and put the whole answered request back to the host.
   *
   * <p>A refusal leaves the control saying what the service still holds. The bound value has not
   * changed — the request is the one it always was — so nothing would redraw the select on its own,
   * and a select left showing a value the platform rejected is the one outcome worth a line of DOM
   * to avoid.
   */
  protected async choose(source: ReleaseRequestSourceDto, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const priority = select.value;
    if (!priority || priority === source.priority) {
      return;
    }
    const request = this.request();
    this.busy.set(source.name);
    this.failure.set(null);
    try {
      this.changed.emit(
        await this.api.setSourcePriority(request.repoId, request.id, source.name, priority),
      );
    } catch (error) {
      this.failure.set({ name: source.name, message: describeError(error) });
      select.value = source.priority ?? '';
    } finally {
      this.busy.set(null);
    }
  }
}
