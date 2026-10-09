import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  CampaignDto,
  CampaignMemberDto,
  CampaignMemberResponse,
  CampaignProgressDto,
  CampaignSummaryDto,
  ConditionGroup,
  EntityStatus,
} from './dto';
import { ProjectsApi } from './projects-api';
import {
  campaignSummaryOf,
  workRef,
  type WorkEntityDto,
  type WorkMembersResponse,
  type WorkProgressResponse,
} from './work';

/**
 * **A project's campaigns** (qits-413 … qits-418) on the `/work` surface (epic qits-965): a desk
 * row's summary, the create, one campaign's read and its lifecycle move, the authoring of its
 * membership, the one person's latch, and the progress read.
 *
 * <p><b>Everything is addressed by the campaign's qualified id</b> (`/work/{q}/…`; a UUID still
 * resolves). A campaign is an ordinary work entity there: it is listed by
 * `GET /projects/{project}/work`, created by `POST /work`, read by `GET /work/{q}` and moved by
 * `POST /work/{q}/status` — those four are {@link ProjectsApi}'s, which this delegates to rather than
 * keeping a second copy of an address. What is a campaign's own is its members and its progress.
 *
 * <p><b>The start is not here.</b> It is the dispatching press every archetype shares,
 * `EntitiesApi.dispatch(ref, 'FLOW')`, which on a campaign answers `{progress}`.
 *
 * <p>Every answer is unwrapped here, once: the envelopes (`{"member": …}`, `{"members": …}`,
 * `{"progress": …}`) add nothing a caller needs.
 */
@Injectable({ providedIn: 'root' })
export class CampaignsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);
  private readonly projects = inject(ProjectsApi);

  /**
   * A campaign's desk row: whether it has started, whether that start is live, and how many members
   * it gathers — the retired listing's summary, read off the campaign's progress.
   */
  async summary(campaign: WorkEntityDto): Promise<CampaignSummaryDto> {
    return campaignSummaryOf(campaign, await this.progress(workRef(campaign)));
  }

  /** A new campaign, REPORTED and empty. An empty description is left off the body. */
  create(projectId: string, title: string, description?: string): Promise<WorkEntityDto> {
    return this.projects.createWork({
      archetype: 'CAMPAIGN',
      project: projectId,
      title,
      ...(description ? { description } : {}),
    });
  }

  /**
   * One campaign whole: the entity, its members in order, and its start — three reads in parallel,
   * since `/work` answers each on its own (`GET /work/{q}`, `…/members`, and the start off
   * `…/progress`).
   */
  async get(ref: string): Promise<CampaignDto> {
    const [campaign, members, progress] = await Promise.all([
      this.projects.workItem(ref),
      this.members(ref),
      this.progress(ref),
    ]);
    return {
      id: campaign.id,
      number: campaign.number,
      qualifiedId: campaign.qualifiedId,
      projectId: campaign.projectId,
      slug: campaign.slug,
      title: campaign.title,
      description: campaign.description ?? null,
      status: campaign.status ?? 'REPORTED',
      blocked: campaign.blocked ?? false,
      blockSource: campaign.blockSource,
      blockReason: campaign.blockReason,
      blockedBy: campaign.blockedBy,
      start: progress.campaign.start,
      members,
    };
  }

  /**
   * A lifecycle step. REFINED or READY_FOR_DEV readies it to be started (qits-887); moving between
   * the two neither starts nor pauses it — the start press is the only start — and leaving both
   * (back to REPORTED, DROPPED, or on to IMPLEMENTED) pauses a started one.
   */
  transition(ref: string, target: EntityStatus): Promise<WorkEntityDto> {
    return this.projects.setStatus(ref, target);
  }

  /** The members, in campaign order. */
  async members(ref: string): Promise<readonly CampaignMemberDto[]> {
    const response = await firstValueFrom(
      this.http.get<WorkMembersResponse>(`${this.campaign(ref)}/members`),
    );
    return response.members ?? [];
  }

  /**
   * Gather an entity (by qualified id or id). `position` omitted appends; `inFlight` omitted lets the
   * service decide (true when the entity is IMPLEMENTED or later, or an ACTIVE workspace stands on
   * its branch) — so an absent argument is left off the body rather than sent as null. The answer's
   * `joinedRunning` echoes what was decided.
   */
  async addMember(
    ref: string,
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
      this.http.post<CampaignMemberResponse>(`${this.campaign(ref)}/members`, body),
    );
    return response.member;
  }

  /**
   * Move a member to another place in the order. Order only — the conditions do not move. Answers
   * the members as the move left them.
   */
  async moveMember(
    ref: string,
    membershipId: string,
    position: number,
  ): Promise<readonly CampaignMemberDto[]> {
    const response = await firstValueFrom(
      this.http.put<WorkMembersResponse>(`${this.member(ref, membershipId)}/position`, {
        position,
      }),
    );
    return response.members ?? [];
  }

  /**
   * Remove a member; answers the members left. 409 once claimed, and while another member's
   * criterion targets this one.
   */
  async removeMember(ref: string, membershipId: string): Promise<readonly CampaignMemberDto[]> {
    const response = await firstValueFrom(
      this.http.delete<WorkMembersResponse>(this.member(ref, membershipId)),
    );
    return response?.members ?? [];
  }

  /**
   * Restate a member's whole condition (PUT semantics). A criterion carrying its `id` keeps its
   * latch; an empty list means the member waits on nothing. The service refuses an empty group.
   */
  async setCondition(
    ref: string,
    membershipId: string,
    groups: readonly ConditionGroup[],
  ): Promise<CampaignMemberDto> {
    const response = await firstValueFrom(
      this.http.put<CampaignMemberResponse>(`${this.member(ref, membershipId)}/condition`, {
        groups,
      }),
    );
    return response.member;
  }

  /** A person's yes on an APPROVAL criterion — `qits:admin` alone. An empty note is left off. */
  async approve(
    ref: string,
    membershipId: string,
    criterionId: string,
    note?: string,
  ): Promise<CampaignMemberDto> {
    const body = note ? { note } : {};
    const response = await firstValueFrom(
      this.http.post<CampaignMemberResponse>(
        `${this.member(ref, membershipId)}/criteria/${encodeURIComponent(criterionId)}/approve`,
        body,
      ),
    );
    return response.member;
  }

  /** How the campaign is doing: every member's derived state and the evaluator's health. */
  async progress(ref: string): Promise<CampaignProgressDto> {
    const response = await firstValueFrom(
      this.http.get<WorkProgressResponse>(`${this.campaign(ref)}/progress`),
    );
    return response.progress;
  }

  private campaign(ref: string): string {
    return `${this.base}/projects/api/work/${encodeURIComponent(ref)}`;
  }

  private member(ref: string, membershipId: string): string {
    return `${this.campaign(ref)}/members/${encodeURIComponent(membershipId)}`;
  }
}
