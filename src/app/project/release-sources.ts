import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ReleaseRequestDto } from '../api/dto';
import { releaseSources, sourceTitle } from './release-requests-model';

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
 */
@Component({
  selector: 'app-release-sources',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sources().length) {
      <ul class="sources">
        @for (source of sources(); track source.ref) {
          <li class="source" [class.implicit]="source.implicit" [title]="title(source)">
            {{ source.name }}
          </li>
        }
      </ul>
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
  `,
})
export class ReleaseSources {
  readonly request = input.required<ReleaseRequestDto>();

  protected readonly title = sourceTitle;

  protected readonly sources = computed(() => releaseSources(this.request()));
}
