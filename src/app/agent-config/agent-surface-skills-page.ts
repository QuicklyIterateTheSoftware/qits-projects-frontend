import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { surfaceName } from './surface-names';

/**
 * Skills and subagents for one surface: **routed, reachable, and empty on purpose.**
 *
 * <p>Reserving the place is the whole scope. The feature is not fleshed out — nobody has designed
 * what a per-surface skill or subagent is, how it is installed, or how it interacts with the plugin
 * marketplace the workspace daemon already has — and a page that guessed would be inventing a
 * contract for somebody else to be bound by.
 *
 * <p>What a placeholder buys is the address. The sub-route is `…/surfaces/:surface/skills`, under the
 * surface rather than beside it, which fixes the one thing that is genuinely known: these belong to a
 * surface's configuration and not to the platform or to a container. A link from the surface page
 * makes it reachable, so the empty page is found by walking rather than by being told the URL — which
 * is what makes it a reservation instead of a dead route.
 */
@Component({
  selector: 'app-agent-surface-skills-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <p class="back">
      <a [routerLink]="['/agent-configuration/surfaces', surface()]">← {{ name().title }}</a>
    </p>

    <h1>Skills and subagents</h1>
    <code class="key">{{ surface() }}</code>

    <p class="prose">
      Not built yet. This page exists to fix where per-surface skills and subagents will live; there
      is nothing to configure here until somebody designs what one is.
    </p>
  `,
  styles: `
    :host {
      display: block;
    }
    .back {
      margin: 0 0 0.5rem;
      font-size: 0.85rem;
    }
    .back a {
      color: #2563eb;
    }
    h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
    }
    .key {
      color: #6b7280;
      font-size: 0.8rem;
    }
    .prose {
      margin: 0.75rem 0 0;
      max-width: 40rem;
      color: #6b7280;
      font-size: 0.9rem;
    }
  `,
})
export class AgentSurfaceSkillsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.paramMap, { initialValue: null });

  protected readonly surface = computed(() => this.params()?.get('surface') ?? '');
  protected readonly name = computed(() => surfaceName(this.surface()));
}
