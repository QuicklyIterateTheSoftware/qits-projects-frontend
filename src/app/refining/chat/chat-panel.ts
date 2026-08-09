import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { QitsButton } from '@qits/ui-components';
import { CommandsApi, type CommandDto } from '../../api/commands-api';
import { WEB_SOCKET_FACTORY } from '../../api/web-socket';
import { WorkspaceCommands } from '../../api/workspace-commands';
import { WorkspaceDaemonApi } from '../../api/workspace-daemon-api';
import { Async } from '../../ui/async';
import { describeError } from '../../ui/loadable';
import { ChatSocket, type ChatLink } from './chat-socket';
import { EMPTY_CONVERSATION, buildConversation } from './chat-model';
import { Conversation } from './conversation';
import {
  PickedContext,
  epicReferenceLabel,
  referenceLabel,
  serializePrompt,
} from './picked-context';
import { PromptPanel } from './prompt-panel';

/**
 * The room's front door: compose a prompt, or watch the agent work.
 *
 * Copied from qits-spa-workspaces' detail shell, which is this codebase's sanctioned way to share a
 * screen. It attaches to `WS /workspaces/container/{id}/chat/commands/{commandId}` — the workspace
 * daemon, not the projects one, and a different conversation from the refinement chat on the project
 * page.
 *
 * ## What it loads
 *
 * **On first open this panel reads `1`, plus one socket while a session is live.** The read is the
 * container's command list, and it is a *shared* entry — the Actions history, the session tree and
 * the embedded session read the same one, so being first here costs the others nothing. The prompt
 * panel's own draft read is its budget, not this one's.
 *
 * ## Two modes, one tab, no navigation
 *
 * Nothing running is the prompt panel. Something running is the conversation. Launching swaps one
 * for the other **in place** — the spec is specific that this is not a navigation, and it is the
 * behaviour that makes the tab feel like a room rather than a form.
 *
 * A session started anywhere is picked up here, because the mode is derived from the command list
 * and not from what this panel did. That is also why the list keeps refreshing while the tab is
 * hidden: coming back to a prompt panel over a running agent would be a lie.
 *
 * ## The launch bridge
 *
 * A launch answers before the registry reports the new run, so a panel driven purely off the list
 * blinks back to its empty state for a beat after every launch. {@link bridged} holds the id the
 * launch just returned and stops the moment the registry knows the command — either by reporting it
 * running, or by reporting it finished.
 *
 * ## Side-chains join at the end, and the UI says so
 *
 * The live tail covers the main session only; a sub-agent's side-chain is imported by the exit
 * sweep. So a running conversation shows the main thread and *gains* its side-chains when the run
 * ends. Left unsaid that reads as a bug — an agent visibly spawning sub-agents whose work never
 * appears — so it is said, once, in the header strip while the run is live.
 */
@Component({
  selector: 'app-chat-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Conversation, PromptPanel, QitsButton],
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.css',
})
export class ChatPanel {
  private static readonly TAIL_THRESHOLD_PX = 32;

  private readonly commands = inject(WorkspaceCommands);
  private readonly api = inject(CommandsApi);
  private readonly daemon = inject(WorkspaceDaemonApi);
  private readonly openSocket = inject(WEB_SOCKET_FACTORY);
  protected readonly picked = inject(PickedContext);

  /** Which workspace's container this conversation lives in. */
  readonly workspaceRowId = input.required<number>();

  /** The workspace's stated goal, handed to the refinement request. */
  readonly preamble = input<string | null>(null);

  /** Whether the keep-mounted tab is currently measurable on screen. */
  readonly visible = input(true);

  protected readonly commandsState = this.commands.commands;

  /** The command a launch just returned, until the registry has an opinion about it. */
  private readonly bridged = signal<CommandDto | null>(null);

  protected readonly terminating = signal(false);
  protected readonly terminateProblem = signal<string | null>(null);

  /**
   * The attachment, as a signal so the panel's own state composes out of the socket's rather than
   * being copied into it by an effect. One source of truth, and a detach is one `set`.
   */
  private readonly socket = signal<ChatSocket | null>(null);
  private readonly attached = signal<string | null>(null);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private followTail = true;
  private followedCommandId: string | null = null;

  constructor() {
    effect(() => {
      const workspaceRowId = this.workspaceRowId();
      untracked(() => {
        // The bridge is about one launch in one container. The shell remounts this panel when the
        // workspace changes, but a panel that only worked because its host tore it down would be a
        // dependency nobody wrote down.
        this.bridged.set(null);
        this.picked.use(workspaceRowId);
        this.commands.use(workspaceRowId);
      });
    });

    // The bridge ends when the registry knows the id, whatever it says about it.
    effect(() => {
      const state = this.commandsState();
      const bridged = untracked(() => this.bridged());
      if (bridged && state.kind === 'ready' && state.value.some((row) => row.id === bridged.id)) {
        untracked(() => this.bridged.set(null));
      }
    });

    effect(() => {
      const command = this.session();
      const workspaceRowId = this.workspaceRowId();
      untracked(() => this.attach(workspaceRowId, command?.id ?? null));
    });

    // Remember whether the reader was at the tail before the DOM grows. Recalculating that after a
    // message renders would mistake the newly added height for a deliberate scroll away from the
    // bottom. A new conversation always starts at its tail; later updates only follow while the
    // reader has left it there.
    effect(() => {
      const element = this.log()?.nativeElement;
      const commandId = this.session()?.id ?? null;
      const visible = this.visible();
      this.conversation();
      if (!element || !visible) {
        return;
      }

      untracked(() => {
        if (commandId !== this.followedCommandId) {
          this.followedCommandId = commandId;
          this.followTail = true;
        }
        queueMicrotask(() => {
          if (this.log()?.nativeElement === element && this.followTail) {
            element.scrollTop = element.scrollHeight;
          }
        });
      });
    });

    inject(DestroyRef).onDestroy(() => this.detach());
  }

  // ---- which conversation, if any ----------------------------------------------------------------

  /** The chat that owns this workspace: what the registry says, or what a launch just returned. */
  protected readonly session = computed<CommandDto | null>(
    () => this.commands.runningChat() ?? this.bridged(),
  );

  private readonly lines = computed<readonly string[]>(() => this.socket()?.lines() ?? []);

  protected readonly conversation = computed(() => {
    const lines = this.lines();
    return lines.length === 0 ? EMPTY_CONVERSATION : buildConversation(lines);
  });

  protected readonly status = computed<ChatLink>(() => this.socket()?.status() ?? 'closed');

  protected readonly pending = computed(() => this.socket()?.queued() ?? 0);

  /** Whether the run is still going, as far as this panel can tell. */
  protected readonly live = computed(() => this.session() !== null && !this.conversation().closed);

  protected readonly draft = signal('');

  protected readonly outgoing = computed(() =>
    serializePrompt({
      text: this.draft(),
      references: this.picked.references(),
      elements: this.picked.elements(),
      epics: this.picked.epics(),
    }).trim(),
  );

  protected readonly canSend = computed(() => this.outgoing().length > 0 && this.live());

  protected epicLabel = epicReferenceLabel;
  protected referenceLabel = referenceLabel;

  // ---- what the panel does ------------------------------------------------------------------------

  /** A launch from the prompt panel. The mode swaps here rather than navigating. */
  protected onLaunched(command: CommandDto): void {
    this.bridged.set(command);
    void this.commands.refresh();
  }

  protected send(): void {
    const text = this.outgoing();
    const socket = this.socket();
    if (!text || !socket) {
      return;
    }
    socket.send(text);
    // Never an optimistic bubble: the turn appears when the server echoes it, which is what makes
    // the live view and a later replay agree.
    this.draft.set('');
    this.picked.clear();
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.send();
    }
  }

  protected rememberScrollPosition(): void {
    const element = this.log()?.nativeElement;
    if (!element) {
      return;
    }
    const distanceFromTail = element.scrollHeight - element.clientHeight - element.scrollTop;
    this.followTail = distanceFromTail <= ChatPanel.TAIL_THRESHOLD_PX;
  }

  /** End the run. Invalidates on settled, not on success — a failed terminate still refetches. */
  protected async terminate(): Promise<void> {
    const command = this.session();
    if (!command || this.terminating()) {
      return;
    }
    this.terminating.set(true);
    this.terminateProblem.set(null);
    try {
      await this.api.terminate(this.workspaceRowId(), command.id);
    } catch (error) {
      this.terminateProblem.set(`The session did not stop — ${describeError(error)}.`);
    } finally {
      this.terminating.set(false);
      await this.commands.refresh();
    }
  }

  protected retry(): void {
    void this.commands.refresh();
  }

  // ---- the socket ---------------------------------------------------------------------------------

  /**
   * Attach to one command's conversation, or to none.
   *
   * Keyed by command id: a relaunch is a new id, and reusing a socket bound to a dead process is the
   * bug keying exists to prevent. Detaching only closes this end — the agent keeps running, which is
   * the whole reason switching tabs is free.
   */
  private attach(workspaceRowId: number, commandId: string | null): void {
    if (this.attached() === commandId) {
      return;
    }
    this.detach();
    this.attached.set(commandId);
    if (!commandId || workspaceRowId <= 0) {
      return;
    }
    const socket = new ChatSocket(
      this.daemon.socketUrl(workspaceRowId, `/chat/commands/${encodeURIComponent(commandId)}`),
      this.openSocket,
    );
    this.socket.set(socket);
    socket.connect();
  }

  private detach(): void {
    this.socket()?.close();
    this.socket.set(null);
    this.attached.set(null);
  }
}
