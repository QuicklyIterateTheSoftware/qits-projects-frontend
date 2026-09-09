import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';

/** Which harness a surface runs. The store's own enum, and a closed set on both sides. */
export type AgentHarness = 'CLAUDE' | 'KIMI';

/**
 * Whether the agent is asked before it acts.
 *
 * `SKIP_PERMISSIONS` renders `--dangerously-skip-permissions`, which is what every launch on this
 * platform has done unconditionally since there were launches. `PROMPT` is the other value, and it
 * is the reason the knob exists at all: an attached third-party MCP server's tools would otherwise
 * be auto-approved inside a container holding platform credentials.
 */
export type AgentPermissionMode = 'SKIP_PERMISSIONS' | 'PROMPT';

/**
 * One of the platform's own MCP servers, attached to a surface with the narrowing it carries.
 *
 * <p>`allowedTools` is read-only here: the pre-approval lists for the three built-ins are shipped
 * constants keyed by server, not operator-editable, and the update request has no field for them.
 * They are shown because "which tools are pre-approved" is exactly what somebody reading this page
 * wants to know, and hiding a shipped fact is not the same as not editing it.
 */
export interface AgentMcpAttachmentDto {
  readonly server: string;
  readonly narrowProject: boolean;
  readonly narrowRepository: boolean;
  readonly narrowWorkspace: boolean;
  readonly readOnly: boolean;
  readonly allowedTools: readonly string[];
}

/** One external MCP server, defined once in the catalog and attached by key from many surfaces. */
export interface AgentMcpCatalogEntryDto {
  readonly key: string;
  readonly displayName: string;
  readonly url: string;
  readonly headerName: string;
  /**
   * The **qits-configuration key** holding the header's value — never the value.
   *
   * That indirection is the whole design: the value lives in qits-configuration and is resolved when
   * the document a container is born with is built, so when that service grows real secrets
   * management the same key is served as a secret and nothing here changes.
   */
  readonly credentialKey: string;
  readonly allowedTools: readonly string[];
  /** Which surfaces attach this entry. Answered on the catalog's list, empty elsewhere. */
  readonly attachedBy: readonly string[];
}

/** One surface's whole configuration, as the editor reads it. */
export interface AgentSurfaceConfigurationDto {
  readonly surface: string;
  readonly harness: AgentHarness;
  readonly model: string;
  readonly effort: string;
  readonly remoteControl: boolean;
  readonly permissionMode: AgentPermissionMode;
  readonly activityTracking: boolean;
  readonly systemPrompt: string;
  readonly initialPrompt: string;
  readonly mcpServers: readonly AgentMcpAttachmentDto[];
  readonly externalMcpServers: readonly AgentMcpCatalogEntryDto[];
  /** True while no row has ever been written: this is what the platform ships, unedited. */
  readonly shipped: boolean;
}

/** What a surface's list read answers: every surface, plus the reserved server keys. */
export interface SurfaceListResponse {
  readonly surfaces: readonly AgentSurfaceConfigurationDto[];
  readonly builtInServers: readonly string[];
}

/** One built-in server's attachment, as it is written back. No `allowedTools`: they are shipped. */
export interface McpAttachmentRequest {
  readonly server: string;
  readonly narrowProject: boolean;
  readonly narrowRepository: boolean;
  readonly narrowWorkspace: boolean;
  readonly readOnly: boolean;
}

/**
 * A whole surface, replaced.
 *
 * A PUT of everything rather than a patch of what changed: the record is small, the editor holds all
 * of it on screen, and a partial write would make "empty" ambiguous — an empty system prompt is a
 * first-class value here (it is what the epics desk steers with, deliberately), not an omission.
 */
export interface SurfaceUpdateRequest {
  readonly harness: string;
  readonly model: string;
  readonly effort: string;
  readonly remoteControl: boolean;
  readonly permissionMode: string;
  readonly activityTracking: boolean;
  readonly systemPrompt: string;
  readonly initialPrompt: string;
  readonly mcpServers: readonly McpAttachmentRequest[];
  /** Catalog **keys** only — everything about an external server belongs to its catalog entry. */
  readonly externalMcpServers: readonly string[];
}

/** One image build a harness was probed on, kept beside the newest report rather than merged in. */
export interface AgentCapabilityImageVersionDto {
  readonly imageVersion: string;
  readonly reportedAt: string;
}

/**
 * What one harness reports it can be configured with, as some container's binary answered.
 *
 * <p>The three booleans each mean something an empty list does not, and the editor reads all three:
 *
 * - `modelsEnumerated` false says the harness has **no command that lists models** (Claude Code has
 *   none), so what is offered is a shipped alias set rather than the legal values — the free-text
 *   escape is the point, not a fallback.
 * - `effortSupported` false says the harness has no effort concept at all (Kimi has none), so the
 *   editor must show **no control**, never a disabled one carrying the other harness's values.
 * - `probeFailed` says these lists are the library's shipped fallback rather than a reading of the
 *   binary. An empty dropdown would be worse than a slightly stale one.
 */
export interface AgentHarnessCapabilityDto {
  readonly harness: string;
  readonly imageVersion: string;
  readonly harnessVersion: string;
  readonly models: readonly string[];
  readonly modelsEnumerated: boolean;
  readonly effortSupported: boolean;
  readonly effortLevels: readonly string[];
  readonly authenticated: boolean;
  readonly authDetail: string;
  readonly probeFailed: boolean;
  readonly probeDetail: string;
  readonly reportedBy: string;
  readonly reportedAt: string;
  /** True when nothing has ever reported: the library's shipped set, flagged as such. */
  readonly shipped: boolean;
  readonly otherImageVersions: readonly AgentCapabilityImageVersionDto[];
}

export interface AgentCapabilityCatalogueDto {
  readonly harnesses: readonly AgentHarnessCapabilityDto[];
}

/** The catalog, and the two facts an operator needs before adding to it. */
export interface CatalogListResponse {
  readonly entries: readonly AgentMcpCatalogEntryDto[];
  /** Keys an entry may not claim, because a platform server already renders under them. */
  readonly reservedKeys: readonly string[];
  /** The qits-configuration application every `credentialKey` lives under. Reserved; nothing deploys it. */
  readonly credentialApplication: string;
}

/** One catalog entry, written whole. The key is the address, so it is not in the body. */
export interface CatalogEntryRequest {
  readonly displayName: string;
  readonly url: string;
  readonly headerName: string;
  readonly credentialKey: string;
  readonly allowedTools: readonly string[];
}

/**
 * The agent configuration store's editor doors, in qits-projects itself.
 *
 * <p><b>Platform-wide, not per project.</b> Every route here is unscoped — one configuration per
 * *session surface* for the whole platform, which is the decision this epic settled and not an
 * omission. Per-project overrides are a later epic; nothing here is keyed by a project id, and
 * adding one would be the wrong shape rather than a smaller version of the right one.
 *
 * <p><b>Admin-scoped at the service, and only there.</b> `qits:admin` guards `/agent-surfaces` and
 * `/agent-mcp-catalog`; `/agent-capabilities` takes `qits:admin` or `qits:system`. This application
 * has no client-side route guard for anything, and this is not the feature that invents one: the
 * gateway session is what the browser carries, the service is the only thing that can decide, and a
 * guard here would either duplicate that decision or contradict it. A reader without the scope gets
 * a 403 and the page says so.
 *
 * <p><b>What is deliberately not here.</b> `GET /agent-configuration` — the resolved document a
 * container is born with — is the *container's* door, not the editor's, and it carries resolved
 * credential values. Nothing in a browser should ever ask for it.
 *
 * <p>Written from `docs/openapi.yml` and the controllers behind it (`AgentSurfaceConfigurationController`,
 * `AgentCapabilityController`, `AgentMcpCatalogController`).
 */
@Injectable({ providedIn: 'root' })
export class AgentConfigurationApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /**
   * Every surface, resolved, and the servers this platform can attach.
   *
   * <p>One read for both, and the detail page makes the same one rather than a narrower
   * `/agent-surfaces/{surface}`: the narrower read cannot answer which servers exist, so a page
   * using it would need a second request and would then hold two answers taken at two moments. The
   * list is eight small rows.
   *
   * <p>A surface with no row answers its shipped default rather than 404ing — which is what lets a
   * daemon know a key this store has not been told about and still launch.
   */
  async surfaces(): Promise<SurfaceListResponse> {
    return firstValueFrom(
      this.http.get<SurfaceListResponse>(`${this.base}/projects/api/agent-surfaces`),
    );
  }

  /** Replace one surface's configuration. The answer is what was stored, resolved. */
  async saveSurface(
    surface: string,
    request: SurfaceUpdateRequest,
  ): Promise<AgentSurfaceConfigurationDto> {
    return firstValueFrom(
      this.http.put<AgentSurfaceConfigurationDto>(
        `${this.base}/projects/api/agent-surfaces/${encodeURIComponent(surface)}`,
        request,
      ),
    );
  }

  /**
   * What the harnesses report they can be configured with — the model and effort controls.
   *
   * Read from a cache the daemons write when a container starts. Nothing on this path spawns a
   * process or waits on a container, which is the entire reason the cache exists: the editor is a
   * platform-wide route with no container in front of it.
   */
  async capabilities(): Promise<AgentCapabilityCatalogueDto> {
    return firstValueFrom(
      this.http.get<AgentCapabilityCatalogueDto>(`${this.base}/projects/api/agent-capabilities`),
    );
  }

  /** The external MCP server catalog, with the reserved keys and the credential application. */
  async catalog(): Promise<CatalogListResponse> {
    return firstValueFrom(
      this.http.get<CatalogListResponse>(`${this.base}/projects/api/agent-mcp-catalog`),
    );
  }

  /** Add or replace one catalog entry. The same door for both — the key is the address. */
  async saveCatalogEntry(
    key: string,
    request: CatalogEntryRequest,
  ): Promise<AgentMcpCatalogEntryDto> {
    return firstValueFrom(
      this.http.put<AgentMcpCatalogEntryDto>(
        `${this.base}/projects/api/agent-mcp-catalog/${encodeURIComponent(key)}`,
        request,
      ),
    );
  }

  /** Remove one catalog entry. */
  async deleteCatalogEntry(key: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<unknown>(
        `${this.base}/projects/api/agent-mcp-catalog/${encodeURIComponent(key)}`,
      ),
    );
  }
}
