import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  CampaignDto,
  CampaignMemberDto,
  CampaignMemberResponse,
  CampaignProgressDto,
  CampaignProgressResponse,
  CampaignResponse,
  CampaignSummaryDto,
  CampaignsResponse,
  ConditionGroup,
  EntityStatus,
} from './dto';

/**
 * **A project's campaigns** (qits-413 … qits-418): the listing and the create, one campaign's read and
 * its lifecycle move, the authoring of its membership, the one person's latch, and the progress read.
 *
 * <p><b>Two path families, the service's split.</b> The listing and the create are addressed under
 * the project (`projects/{id}/campaigns`), because that is the only place the project is known;
 * everything about one campaign is addressed by its own id (`campaigns/{id}`), as the epic and ticket
 * doors are.
 *
 * <p><b>The start is not here.</b> It is the dispatching press every archetype shares,
 * `EntitiesApi.dispatch(id, 'FLOW')`, which on a campaign answers `{progress}`.
 *
 * <p><b>The transition is the only door that moves a campaign's status</b> — the multi-entity
 * `POST /entities/transition` refuses a campaign — so a status step on a campaign's page comes here.
 *
 * <p>Every answer is unwrapped here, once: the envelopes (`{"campaign": …}`, `{"member": …}`,
 * `{"progress": …}`) add nothing a caller needs.
 */
@Injectable({ providedIn: 'root' })
export class CampaignsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /** The project's campaigns, oldest first, each with whether it has started and how many members. */
  async list(projectId: string): Promise<readonly CampaignSummaryDto[]> {
    const response = await firstValueFrom(
      this.http.get<CampaignsResponse>(this.projectPath(projectId)),
    );
    return response.campaigns ?? [];
  }

  /** A new campaign, REPORTED and empty. An empty description is left off the body. */
  async create(projectId: string, title: string, description?: string): Promise<CampaignDto> {
    const body = description ? { title, description } : { title };
    const response = await firstValueFrom(
      this.http.post<CampaignResponse>(this.projectPath(projectId), body),
    );
    return response.campaign;
  }

  async get(id: string): Promise<CampaignDto> {
    const response = await firstValueFrom(this.http.get<CampaignResponse>(this.campaign(id)));
    return response.campaign;
  }

  /**
   * A lifecycle step. REFINED or READY_FOR_DEV readies it to be started (qits-887); moving between
   * the two neither starts nor pauses it — the start press is the only start — and leaving both
   * (back to REPORTED, DROPPED, or on to IMPLEMENTED) pauses a started one.
   */
  async transition(id: string, target: EntityStatus): Promise<CampaignDto> {
    const response = await firstValueFrom(
      this.http.post<CampaignResponse>(`${this.campaign(id)}/transition`, { target }),
    );
    return response.campaign;
  }

  /**
   * Gather an entity. `position` omitted appends; `inFlight` omitted lets the service decide (true
   * when the entity is IMPLEMENTED or later, or an ACTIVE workspace stands on its branch) — so an
   * absent argument is left off the body rather than sent as null. The answer's `joinedRunning`
   * echoes what was decided.
   */
  async addMember(
    id: string,
    entityId: string,
    position?: number,
    inFlight?: boolean,
  ): Promise<CampaignMemberDto> {
    const body: { entityId: string; position?: number; inFlight?: boolean } = { entityId };
    if (position !== undefined) {
      body.position = position;
    }
    if (inFlight !== undefined) {
      body.inFlight = inFlight;
    }
    const response = await firstValueFrom(
      this.http.post<CampaignMemberResponse>(`${this.campaign(id)}/members`, body),
    );
    return response.member;
  }

  /** Move a member to another place in the order. Order only — the conditions do not move. */
  async moveMember(id: string, membershipId: string, position: number): Promise<CampaignDto> {
    const response = await firstValueFrom(
      this.http.put<CampaignResponse>(`${this.member(id, membershipId)}/position`, { position }),
    );
    return response.campaign;
  }

  /** 204. 409 once claimed, and while another member's criterion targets this one. */
  async removeMember(id: string, membershipId: string): Promise<void> {
    await firstValueFrom(this.http.delete<unknown>(this.member(id, membershipId)));
  }

  /**
   * Restate a member's whole condition (PUT semantics). A criterion carrying its `id` keeps its
   * latch; an empty list means the member waits on nothing. The service refuses an empty group.
   */
  async setCondition(
    id: string,
    membershipId: string,
    groups: readonly ConditionGroup[],
  ): Promise<CampaignMemberDto> {
    const response = await firstValueFrom(
      this.http.put<CampaignMemberResponse>(`${this.member(id, membershipId)}/condition`, {
        groups,
      }),
    );
    return response.member;
  }

  /** A person's yes on an APPROVAL criterion — `qits:admin` alone. An empty note is left off. */
  async approve(
    id: string,
    membershipId: string,
    criterionId: string,
    note?: string,
  ): Promise<CampaignMemberDto> {
    const body = note ? { note } : {};
    const response = await firstValueFrom(
      this.http.post<CampaignMemberResponse>(
        `${this.member(id, membershipId)}/criteria/${encodeURIComponent(criterionId)}/approve`,
        body,
      ),
    );
    return response.member;
  }

  /** How the campaign is doing: every member's derived state and the evaluator's health. */
  async progress(id: string): Promise<CampaignProgressDto> {
    const response = await firstValueFrom(
      this.http.get<CampaignProgressResponse>(`${this.campaign(id)}/progress`),
    );
    return response.progress;
  }

  private projectPath(projectId: string): string {
    return `${this.base}/projects/api/projects/${encodeURIComponent(projectId)}/campaigns`;
  }

  private campaign(id: string): string {
    return `${this.base}/projects/api/campaigns/${encodeURIComponent(id)}`;
  }

  private member(id: string, membershipId: string): string {
    return `${this.campaign(id)}/members/${encodeURIComponent(membershipId)}`;
  }
}
