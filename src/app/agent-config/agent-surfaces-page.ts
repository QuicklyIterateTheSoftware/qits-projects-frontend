import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsBadge } from '@qits/ui-components';
import { AgentConfigurationApi, type SurfaceListResponse } from '../api/agent-configuration-api';
import { Async } from '../ui/async';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { surfaceName } from './surface-names';

/**
 * The surfaces, listed: every place on this platform a session is started from, and what each one
 * runs as.
 *
 * <p><b>Named for where they are, never for their keys.</b> `epic.chat` and `workspace.chat` are one
 * word apart and are two different tabs in two different routes — a reader about to change one has
 * to know which screen they are changing. See {@link ./surface-names#SURFACE_NAMES}. The key is shown
 * beside the name because it is what a launch sends and what a log spells.
 *
 * <p><b>Platform-wide, and that is why this route has no project in it.</b> One configuration per
 * surface for the whole platform. Per-project overrides are a later epic and deliberately not
 * designed for here.
 *
 * <p><b>Nothing on this page or its children says anything about staleness</b>, and that is a
 * decision rather than an omission. A container keeps the configuration it was created with, and an
 * edit applies to the next one. There is no pending badge, no "will apply after recreate" flag and
 * no warning, because that is simply how it works — what makes it safe rather than opaque is that
 * every launch records what it actually ran with.
 */
@Component({
  selector: 'app-agent-surfaces-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, QitsBadge, RouterLink],
  template: `
    <header class="head">
      <h1>Agent configuration</h1>
      <a class="catalog" routerLink="/agent-configuration/mcp-catalog">External MCP servers</a>
    </header>

    <p class="lead">
      Every place on this platform a coding-agent session is started from, and what it runs as: the
      harness, the model, the prompts, which MCP servers it may call and whether it asks before it
      acts. One configuration per surface, for the whole platform.
    </p>

    <app-async
      [state]="state()"
      loadingLabel="Loading the session surfaces"
      errorLabel="Could not load the session surfaces"
      (retry)="load()"
    />

    @if (forbidden()) {
      <p class="denied" role="status">
        These are administrator settings. The session you are signed in with does not carry
        <code>qits:admin</code>, so the store will not answer it.
      </p>
    }

    @if (loaded(); as answer) {
      <ul class="surfaces">
        @for (surface of answer.surfaces; track surface.surface) {
          <li>
            <a class="row" [routerLink]="['/agent-configuration/surfaces', surface.surface]">
              <span class="title">{{ name(surface.surface).title }}</span>
              <code class="key">{{ surface.surface }}</code>
              <qits-badge
                [label]="surface.shipped ? 'Shipped default' : 'Edited'"
                [tone]="surface.shipped ? 'neutral' : 'info'"
              />
            </a>
            <p class="where">{{ name(surface.surface).where }}</p>
            <p class="summary">{{ summaryOf(surface) }}</p>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
    }
    .catalog {
      color: #2563eb;
      font-size: 0.9rem;
    }
    .lead {
      margin: 0 0 1rem;
      max-width: 46rem;
      color: #4b5563;
      font-size: 0.9rem;
    }
    .denied {
      margin: 0.5rem 0;
      color: #b45309;
      font-size: 0.9rem;
    }
    .surfaces {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .surfaces li {
      padding: 0.6rem 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
      text-decoration: none;
    }
    .title {
      color: #111827;
      font-weight: 600;
    }
    .key {
      color: #6b7280;
      font-size: 0.8rem;
    }
    .where,
    .summary {
      margin: 0.2rem 0 0;
      color: #6b7280;
      font-size: 0.85rem;
    }
    .summary {
      color: #9ca3af;
    }
  `,
})
export class AgentSurfacesPage {
  private readonly api = inject(AgentConfigurationApi);

  protected readonly state = signal<Loadable<SurfaceListResponse>>(LOADING);

  protected readonly loaded = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.value : undefined;
  });

  /**
   * Whether the refusal was about who is asking rather than about what was asked.
   *
   * The gate is the service's — `qits:admin` on the route — and this application guards no route on
   * the client, so a reader without the scope reaches the page and is told by it. A guard here would
   * be a second copy of a decision only the service can make.
   */
  protected readonly forbidden = computed(() => {
    const state = this.state();
    return state.kind === 'error' && (state.status === 401 || state.status === 403);
  });

  protected readonly name = surfaceName;

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set(LOADING);
    try {
      this.state.set(ready(await this.api.surfaces()));
    } catch (error) {
      this.state.set(failed(error));
    }
  }

  /** The one line under a row: what a reader scanning for "which one runs Kimi" is looking for. */
  protected summaryOf(surface: {
    harness: string;
    model: string;
    permissionMode: string;
    mcpServers: readonly { server: string }[];
    externalMcpServers: readonly unknown[];
  }): string {
    const parts = [
      surface.harness === 'CLAUDE' ? 'Claude Code' : 'Kimi Code',
      surface.model.trim() || 'the harness’s default model',
      surface.permissionMode === 'PROMPT' ? 'asks before acting' : 'skips permissions',
    ];
    const servers = surface.mcpServers.length + surface.externalMcpServers.length;
    parts.push(servers === 1 ? '1 MCP server' : `${servers} MCP servers`);
    return parts.join(' · ');
  }
}
