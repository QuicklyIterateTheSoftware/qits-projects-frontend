import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { QitsBadge, QitsButton } from '@qits/ui-components';
import {
  AgentConfigurationApi,
  type AgentCapabilityCatalogueDto,
  type AgentMcpAttachmentDto,
  type AgentMcpCatalogEntryDto,
  type AgentSurfaceConfigurationDto,
  type McpAttachmentRequest,
} from '../api/agent-configuration-api';
import { Async } from '../ui/async';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { choicesFor, effortOptions, effortToStore } from './harness-choices';
import { surfaceName } from './surface-names';

/**
 * The placeholder names an initial prompt may use, shown beside the field.
 *
 * <p>**Hardcoded here, and that is the honest arrangement rather than a shortcut.** The list is
 * `AgentPromptTemplate.NAMES` in `qits-coding-agents`, which is a released library with no HTTP
 * surface of its own — nothing serves it, so nothing can be read. A name that does not exist renders
 * literally rather than as `null`, which is what makes a mistake here visible instead of silent; and
 * showing the names beside the field is the whole reason the library documents them, because a
 * template written against a name that does not exist is a prompt that reads as configured and
 * renders as a placeholder.
 */
const TEMPLATE_NAMES: readonly string[] = [
  'project',
  'epic',
  'repository',
  'branch',
  'workspace',
  'ticket',
  'commit',
];

/** One built-in MCP server as the form holds it: attached or not, and how narrow. */
interface AttachmentDraft {
  attached: boolean;
  narrowProject: boolean;
  narrowRepository: boolean;
  narrowWorkspace: boolean;
  readOnly: boolean;
  /** The shipped pre-approval list, shown and never edited. Empty when the server is unattached. */
  readonly allowedTools: readonly string[];
}

/** Everything one read of the store answers, held together so the form draws from one moment. */
interface Loaded {
  readonly configuration: AgentSurfaceConfigurationDto;
  readonly builtInServers: readonly string[];
}

/**
 * One session surface, edited: what a session started from this place will actually run as.
 *
 * <p><b>The model and effort controls are a cascade, and the cascade is the feature.</b> Choosing a
 * harness reshapes both, because the valid values belong to the *binary in the workspace image* and
 * the two harnesses answer in different kinds: Claude Code has `--effort` with levels its own
 * `--help` enumerates and no command that lists models at all; Kimi Code has a machine-readable model
 * catalogue and no effort concept whatsoever. So a Kimi surface shows **no effort control** — not a
 * disabled one carrying Claude's values — and the model control is a combobox rather than a select,
 * because pinning a full model id the harness never enumerated is exactly what somebody comes to this
 * page to do. See {@link ./harness-choices#choicesFor}, which is where all of that lives so it can be
 * asserted without a DOM.
 *
 * <p><b>Remote control is shown on every surface.</b> The refinement that produced this feature said
 * it should be hidden on the chat surfaces, on the grounds that `--remote-control` is dropped under
 * `--print`. The code moved after that: the chat sessions are the ones that enable Remote Control
 * today, over the SDK control channel, and the interactive ones have none — exactly inverted. The
 * owner's rule stands over both: when the knob is on, the flag is set, and this page does not
 * validate the combination.
 *
 * <p><b>Nothing here says anything about staleness.</b> A container keeps the configuration it was
 * created with and an edit applies to the next one. No pending badge, no warning, no "takes effect
 * after recreate" — that is simply how it works, and what makes it safe rather than opaque is that
 * every launch records what it actually ran with.
 */
@Component({
  selector: 'app-agent-surface-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, QitsBadge, QitsButton, RouterLink],
  templateUrl: './agent-surface-page.html',
  styleUrl: './agent-surface-page.css',
})
export class AgentSurfacePage {
  private readonly api = inject(AgentConfigurationApi);
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.paramMap, { initialValue: null });

  /** Which surface this page is about, from the address. */
  protected readonly surface = computed(() => this.params()?.get('surface') ?? '');

  protected readonly name = computed(() => surfaceName(this.surface()));

  protected readonly state = signal<Loadable<Loaded>>(LOADING);

  /**
   * The capability catalogue, held apart from the surface read and allowed to fail on its own.
   *
   * A surface is editable without it — every field still saves — so a catalogue that 403s or is
   * simply not there yet must not take the form down with it. `null` is "nothing known", and
   * {@link choicesFor} answers that honestly rather than pretending the lists are empty.
   */
  protected readonly catalogue = signal<AgentCapabilityCatalogueDto | null>(null);

  /** The external MCP catalog, for the attachment checkboxes. Same rule: its failure is not fatal. */
  protected readonly catalogEntries = signal<readonly AgentMcpCatalogEntryDto[] | null>(null);

  // ---- the draft ----------------------------------------------------------------------------

  protected readonly harness = signal('CLAUDE');
  protected readonly model = signal('');
  protected readonly effort = signal('');
  protected readonly remoteControl = signal(false);
  protected readonly permissionMode = signal('SKIP_PERMISSIONS');
  protected readonly activityTracking = signal(true);
  protected readonly systemPrompt = signal('');
  protected readonly initialPrompt = signal('');
  protected readonly attachments = signal<Readonly<Record<string, AttachmentDraft>>>({});
  protected readonly externalKeys = signal<readonly string[]>([]);

  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly problem = signal<string | null>(null);

  /**
   * The placeholders as they are written, braces and all.
   *
   * Composed here rather than in the template because an Angular template cannot show a literal
   * `{{…}}` — the braces are its own interpolation syntax, entity-escaped or not — and the whole
   * value of showing these is that they can be copied exactly as they must be typed.
   */
  protected readonly templateNames = TEMPLATE_NAMES.map((name) => `{{${name}}}`);

  /** What the model and effort controls are, for the harness and model currently chosen. */
  protected readonly choices = computed(() =>
    choicesFor(this.catalogue(), this.harness(), this.model()),
  );

  protected readonly effortChoices = computed(() => effortOptions(this.choices(), this.effort()));

  protected readonly loaded = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.value : undefined;
  });

  protected readonly forbidden = computed(() => {
    const state = this.state();
    return state.kind === 'error' && (state.status === 401 || state.status === 403);
  });

  /** Whether this page has never been saved and is showing what the platform ships. */
  protected readonly shipped = computed(() => this.loaded()?.configuration.shipped ?? false);

  /**
   * The sentence that appears when permissions stop being skipped.
   *
   * <p>It is drawn only on the change, and it exists because **every session on this platform has run
   * auto-approved since there were sessions**. Somebody moving this control is changing what an agent
   * does between turns, not a preference, and the consequence — it will start asking, and a run
   * nobody is watching will sit there — is not guessable from the words "prompt".
   */
  protected readonly prompting = computed(() => this.permissionMode() === 'PROMPT');

  constructor() {
    // Keyed on the address, so a bookmark and a click resolve the same way and a surface hop
    // re-reads rather than showing the previous one's draft under the new heading.
    effect(() => {
      const surface = this.surface();
      if (surface) {
        void this.load(surface);
      }
    });
  }

  protected async load(surface = this.surface()): Promise<void> {
    this.state.set(LOADING);
    this.problem.set(null);
    this.saved.set(false);
    // The two side reads are fired without being awaited together with the main one: they fill
    // controls, they do not gate them, and a page that waited on all three would be as slow as its
    // slowest optional part.
    void this.loadCatalogue();
    void this.loadCatalog();
    try {
      const answer = await this.api.surfaces();
      const configuration = answer.surfaces.find((entry) => entry.surface === surface);
      if (!configuration) {
        this.state.set({
          kind: 'error',
          status: 404,
          message: `this platform has no surface called “${surface}”`,
        });
        return;
      }
      this.state.set(ready({ configuration, builtInServers: answer.builtInServers }));
      this.fill(configuration, answer.builtInServers);
    } catch (error) {
      this.state.set(failed(error));
    }
  }

  private async loadCatalogue(): Promise<void> {
    try {
      this.catalogue.set(await this.api.capabilities());
    } catch {
      // Nothing known. The controls stay and take what is typed — see `choicesFor`.
      this.catalogue.set(null);
    }
  }

  private async loadCatalog(): Promise<void> {
    try {
      this.catalogEntries.set((await this.api.catalog()).entries);
    } catch {
      this.catalogEntries.set(null);
    }
  }

  /** Point every control at what the store answered. The one place the draft is seeded. */
  private fill(
    configuration: AgentSurfaceConfigurationDto,
    builtInServers: readonly string[],
  ): void {
    this.harness.set(configuration.harness);
    this.model.set(configuration.model ?? '');
    this.effort.set(configuration.effort ?? '');
    this.remoteControl.set(configuration.remoteControl);
    this.permissionMode.set(configuration.permissionMode);
    this.activityTracking.set(configuration.activityTracking);
    this.systemPrompt.set(configuration.systemPrompt ?? '');
    this.initialPrompt.set(configuration.initialPrompt ?? '');
    this.externalKeys.set(configuration.externalMcpServers.map((entry) => entry.key));

    const drafts: Record<string, AttachmentDraft> = {};
    for (const server of builtInServers) {
      drafts[server] = draftFor(
        configuration.mcpServers.find((attachment) => attachment.server === server),
      );
    }
    this.attachments.set(drafts);
  }

  // ---- what the controls do -----------------------------------------------------------------

  protected setHarness(value: string): void {
    this.harness.set(value);
    this.saved.set(false);
  }

  protected setAttachment(server: string, patch: Partial<AttachmentDraft>): void {
    const current = this.attachments()[server];
    if (!current) {
      return;
    }
    this.attachments.set({ ...this.attachments(), [server]: { ...current, ...patch } });
    this.saved.set(false);
  }

  protected toggleExternal(key: string, attached: boolean): void {
    const keys = new Set(this.externalKeys());
    if (attached) {
      keys.add(key);
    } else {
      keys.delete(key);
    }
    this.externalKeys.set([...keys]);
    this.saved.set(false);
  }

  protected attachedExternal(key: string): boolean {
    return this.externalKeys().includes(key);
  }

  /**
   * The external entries to offer.
   *
   * The catalog when it answered; otherwise what this surface already attaches, taken off the
   * configuration itself. That fallback is not cosmetic — without it a catalog outage would make a
   * save silently detach every external server this surface holds, because the form would have no
   * checkbox to remember them by.
   */
  protected readonly externalOptions = computed<readonly AgentMcpCatalogEntryDto[]>(
    () => this.catalogEntries() ?? this.loaded()?.configuration.externalMcpServers ?? [],
  );

  /** The order the built-in servers are drawn in, and the drafts behind them. */
  protected readonly builtIns = computed(() =>
    (this.loaded()?.builtInServers ?? []).map((server) => ({
      server,
      draft: this.attachments()[server] ?? draftFor(undefined),
    })),
  );

  protected async save(): Promise<void> {
    const surface = this.surface();
    if (!surface || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.problem.set(null);
    try {
      const stored = await this.api.saveSurface(surface, {
        harness: this.harness(),
        model: this.model().trim(),
        // A harness with no effort concept stores none: the control is absent, so a kept value
        // would be invisible here and still true in the row.
        effort: effortToStore(this.choices(), this.effort().trim()),
        remoteControl: this.remoteControl(),
        permissionMode: this.permissionMode(),
        activityTracking: this.activityTracking(),
        systemPrompt: this.systemPrompt(),
        initialPrompt: this.initialPrompt(),
        mcpServers: this.attachmentRequests(),
        externalMcpServers: this.externalKeys(),
      });
      const builtInServers = this.loaded()?.builtInServers ?? [];
      this.state.set(ready({ configuration: stored, builtInServers }));
      this.fill(stored, builtInServers);
      this.saved.set(true);
    } catch (error) {
      this.problem.set(`This surface was not saved — ${describeError(error)}.`);
    } finally {
      this.saving.set(false);
    }
  }

  private attachmentRequests(): readonly McpAttachmentRequest[] {
    const drafts = this.attachments();
    return Object.keys(drafts)
      .filter((server) => drafts[server].attached)
      .map((server) => ({
        server,
        narrowProject: drafts[server].narrowProject,
        narrowRepository: drafts[server].narrowRepository,
        narrowWorkspace: drafts[server].narrowWorkspace,
        readOnly: drafts[server].readOnly,
      }));
  }
}

/** One server's draft, from its attachment or from nothing at all. */
function draftFor(attachment: AgentMcpAttachmentDto | undefined): AttachmentDraft {
  return {
    attached: attachment !== undefined,
    narrowProject: attachment?.narrowProject ?? false,
    narrowRepository: attachment?.narrowRepository ?? false,
    narrowWorkspace: attachment?.narrowWorkspace ?? false,
    readOnly: attachment?.readOnly ?? false,
    allowedTools: attachment?.allowedTools ?? [],
  };
}
