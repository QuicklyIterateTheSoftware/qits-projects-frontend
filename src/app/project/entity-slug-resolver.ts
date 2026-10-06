import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { ProjectsApi } from '../api/projects-api';
import { ProjectParam } from '../nav/project-param';
import { Async } from '../ui/async';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { entityBySlug, type Archetype } from './entities-model';
import { entityRoute, refinementRoute } from './entity-nodes';

/**
 * **Not a page: the old slug addresses, resolved to the numbered ones** (qits-397).
 *
 * <p>`/<project>/tickets/<slug>` was a ticket's page and `/<project>/epics/<slug>/refining` an epic's
 * refining room. Both are in links people have sent each other, so both keep working: this reads the
 * project's work listing (one request, the summary rows), finds the archetype's root with the slug,
 * and replaces itself with `/<project>/work/<qualified id>` or that plus `/refinement`, carrying the
 * query string along (`?tab=`, `?page=`). The route's `data` says which archetype the slug is of and
 * whether the room was meant — a slug is only unique within one archetype.
 *
 * <p>A slug nobody has is a sentence, not a redirect to a guess.
 */
@Component({
  selector: 'app-entity-slug-resolver',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async],
  template: `
    <app-async
      [state]="state()"
      loadingLabel="Looking up the address"
      errorLabel="Could not look up the address"
      (retry)="resolve()"
    />
    @if (missing()) {
      <p class="miss">Nothing in this project is called “{{ slug() }}”.</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .miss {
      margin: 0.5rem 0;
      color: #6b7280;
    }
  `,
})
export class EntitySlugResolver {
  private readonly api = inject(ProjectsApi);
  private readonly param = inject(ProjectParam);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.paramMap, { initialValue: convertToParamMap({}) });

  protected readonly state = signal<Loadable<boolean>>(LOADING);

  /** The slug segment, under whichever name the old route gave it. */
  protected readonly slug = computed(
    () => this.params().get('ticket') ?? this.params().get('epicSlug') ?? '',
  );

  private readonly archetype = computed<Archetype>(() =>
    this.route.snapshot.data['archetype'] === 'EPIC' ? 'EPIC' : 'TICKET',
  );

  protected readonly missing = computed(() => {
    const state = this.state();
    return state.kind === 'ready' && !state.value;
  });

  private resolvedFor = '';

  constructor() {
    effect(() => {
      const key = `${this.param.projectId()}/${this.slug()}`;
      if (!this.param.projectId() || !this.slug() || key === this.resolvedFor) {
        return;
      }
      this.resolvedFor = key;
      untracked(() => void this.resolve());
    });
  }

  protected async resolve(): Promise<void> {
    this.state.set(LOADING);
    try {
      // The listing's summary carries the slug and the number, which is all an address needs.
      const archetype = this.archetype();
      const roots = (await this.api.work(this.param.projectId())).filter((row) => !row.parent);
      const found = entityBySlug(roots, archetype, this.slug());
      if (!found) {
        this.state.set(ready(false));
        return;
      }
      const room = this.route.snapshot.data['room'] === true;
      const target = room
        ? refinementRoute(this.param.projectSlug(), found)
        : entityRoute(this.param.projectSlug(), found);
      await this.router.navigate(target as string[], {
        queryParams: this.route.snapshot.queryParams,
        replaceUrl: true,
      });
    } catch (error) {
      this.state.set(failed(error));
    }
  }
}
