import { PactV4 } from '@pact-foundation/pact';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addGoldenInteraction } from '@qits/angular/testing';
import type { EntityTransitionRequest } from '../project/entity-transition-model';
import { projectsGoldenMasters as masters } from '../../testing/golden-masters';
import { apiAt } from '../../testing/pact-client';
import { assertPactPart } from '../../testing/pact-part';
import { EntitiesApi } from './entities-api';

/**
 * `EntitiesApi`'s part of qits-projects-frontend's pact with qits-projects-service (epic qits-965):
 * the writes about one entity (the multi-entity transition, the merge patch, the block), the
 * dispatching door and what it would start, the audit, the thread and the workspaces — every one
 * addressed by qualified id under `/work`. In the same file as the other api classes' parts
 * (`pacts/qits-projects-frontend_qits-projects-service.json`, see `src/testing/pact-part.ts`).
 */
const CONSUMER = 'qits-projects-frontend';
const PROVIDER = 'qits-projects-service';
const COMMITTED = resolve(process.cwd(), `pacts/${CONSUMER}_${PROVIDER}.json`);
const OPERATIONS = [
  'transitionWork',
  'patchWork',
  'setWorkBlocked',
  'getWorkDispatch',
  'dispatchWork',
  'getWorkAudit',
  'listWorkComments',
  'addWorkComment',
  'editWorkComment',
  'deleteWorkComment',
  'listWorkWorkspaces',
];

/** The block as the write left it — what `setBlocked` answers. */
const SET_WORK_BLOCKED = ['block.entityId', 'block.archetype', 'block.blocked'] as const;

/** What a press would start: the detail page draws Dispatch, Run the next phase and Refine off it. */
const GET_WORK_DISPATCH = [
  'state.entityId',
  'state.status',
  'state.nextPhase',
  'state.blocked',
  'state.dispatchable',
  'state.mode',
] as const;

/** Where a press went: the detail page links the workspace it landed in. */
const DISPATCH_WORK = [
  'dispatch.phase',
  'dispatch.mode',
  'dispatch.workspaceRowId',
  'dispatch.repositoryId',
  'dispatch.branch',
  'dispatch.agentLaunch',
] as const;

/** The history tab's rows. */
const GET_WORK_AUDIT = [
  'entries[].id',
  'entries[].entityType',
  'entries[].entityId',
  'entries[].operation',
  'entries[].changedBy',
  'entries[].changedAt',
] as const;

/** The thread, oldest first. */
const LIST_WORK_COMMENTS = [
  'entries[].comment.id',
  'entries[].comment.author',
  'entries[].comment.body',
  'entries[].comment.createdAt',
  'entries[].comment.updatedAt',
] as const;

/** One comment as a write left it. */
const WORK_COMMENT = ['comment.id', 'comment.body', 'comment.updatedAt'] as const;

/** The workspace links on a card and on the detail page. */
const LIST_WORK_WORKSPACES = ['workspaces'] as const;

const dir = mkdtempSync(join(tmpdir(), 'qits-projects-frontend-entities-api-pact-'));
const pact = new PactV4({ consumer: CONSUMER, provider: PROVIDER, dir, logLevel: 'warn' });

const given = (
  state: string,
  operationId: string,
  interaction: string,
  consumes: readonly string[],
) =>
  addGoldenInteraction(pact, masters, {
    provider: PROVIDER,
    state,
    operationId,
    trigger: { kind: 'ui', app: CONSUMER, interaction },
    consumes,
  });

/** `state`'s param `name`, as recorded for `operationId`. */
const param = (state: string, operationId: string, name: string) =>
  masters.operation(state, operationId).params[name];

/** The entity a recording addresses. */
const ref = (state: string, operationId: string) => param(state, operationId, 'qualifiedId');

/** What the recording sent. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the recorded JSON, read by key
const sent = (state: string, operationId: string): any =>
  masters.operation(state, operationId).body;

describe('qits-projects-frontend → qits-projects-service pact: EntitiesApi', () => {
  afterAll(() => {
    try {
      assertPactPart(
        join(dir, `${CONSUMER}-${PROVIDER}.json`),
        COMMITTED,
        OPERATIONS,
        'QITS_GOLDEN_UPDATE',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reshape-work: restates an entity as one post-state', () => {
    const state = 'a reported ticket';
    const body = sent(state, 'transitionWork') as Record<string, EntityTransitionRequest>;
    return given(state, 'transitionWork', 'reshape-work', []).executeTest(async (server) => {
      const written = await apiAt(server.url, EntitiesApi).transitionEntities(
        new Map(Object.entries(body)),
      );
      expect(written).toBeInstanceOf(Map);
    });
  });

  it('edit-work-item: writes a field as a merge patch', () => {
    const state = 'a reported ticket';
    return given(state, 'patchWork', 'edit-work-item', []).executeTest(async (server) => {
      await apiAt(server.url, EntitiesApi).patch(ref(state, 'patchWork'), sent(state, 'patchWork'));
    });
  });

  it('block-work-item: blocks an entity, saying why', () => {
    const state = 'a reported ticket';
    const { blocked, reason } = sent(state, 'setWorkBlocked');
    return given(state, 'setWorkBlocked', 'block-work-item', SET_WORK_BLOCKED).executeTest(
      async (server) => {
        const block = await apiAt(server.url, EntitiesApi).setBlocked(
          ref(state, 'setWorkBlocked'),
          blocked,
          reason,
        );
        expect(block.blocked).toBe(true);
      },
    );
  });

  it('show-work-item: what a press would start', () => {
    const state = 'a reported ticket';
    return given(state, 'getWorkDispatch', 'show-work-item', GET_WORK_DISPATCH).executeTest(
      async (server) => {
        const dispatch = await apiAt(server.url, EntitiesApi).dispatchState(
          ref(state, 'getWorkDispatch'),
        );
        expect(dispatch.nextPhase).toBe('refine');
        expect(dispatch.dispatchable).toBe(true);
      },
    );
  });

  /**
   * `a refined ticket` joined the successes here under qits-1075: a person's FLOW press at an
   * unblocked REFINED is no longer the service's 409 — it schedules the ticket (REFINED →
   * READY_FOR_DEV, as that person) and goes straight on into the implement phase, so the door
   * answers the same `{dispatch}` shape as any other dispatching press.
   */
  it.each(['a reported epic', 'a ready for dev ticket', 'a refined ticket'])(
    'dispatch-work-item: presses the dispatching door of %s',
    (state) =>
      given(state, 'dispatchWork', 'dispatch-work-item', DISPATCH_WORK).executeTest(
        async (server) => {
          const answer = await apiAt(server.url, EntitiesApi).dispatch(
            ref(state, 'dispatchWork'),
            sent(state, 'dispatchWork').mode,
          );
          expect('dispatch' in answer && answer.dispatch.branch).toBeTruthy();
        },
      ),
  );

  it('show-work-item: the history', () => {
    const state = 'a reported ticket';
    return given(state, 'getWorkAudit', 'show-work-item', GET_WORK_AUDIT).executeTest(
      async (server) => {
        const entries = await apiAt(server.url, EntitiesApi).audit(ref(state, 'getWorkAudit'));
        expect(entries.length).toBeGreaterThan(0);
      },
    );
  });

  it('show-work-item: the thread', () => {
    const state = 'a ticket with a comment';
    return given(state, 'listWorkComments', 'show-work-item', LIST_WORK_COMMENTS).executeTest(
      async (server) => {
        const thread = await apiAt(server.url, EntitiesApi).comments(
          ref(state, 'listWorkComments'),
        );
        expect(thread[0].body).toBeTruthy();
      },
    );
  });

  it('comment-on-work-item: says something on the thread', () => {
    const state = 'a ticket with a comment';
    return given(state, 'addWorkComment', 'comment-on-work-item', WORK_COMMENT).executeTest(
      async (server) => {
        const comment = await apiAt(server.url, EntitiesApi).addComment(
          ref(state, 'addWorkComment'),
          sent(state, 'addWorkComment').body,
        );
        expect(comment.id).toBeTruthy();
      },
    );
  });

  it('edit-comment: rewrites a comment as a merge patch', () => {
    const state = 'a ticket with a comment';
    return given(state, 'editWorkComment', 'edit-comment', WORK_COMMENT).executeTest(
      async (server) => {
        const comment = await apiAt(server.url, EntitiesApi).updateComment(
          ref(state, 'editWorkComment'),
          param(state, 'editWorkComment', 'commentId'),
          sent(state, 'editWorkComment').body,
        );
        expect(comment.body).toBe(sent(state, 'editWorkComment').body);
      },
    );
  });

  it('delete-comment: takes a comment back', () => {
    const state = 'a ticket with a comment';
    return given(state, 'deleteWorkComment', 'delete-comment', []).executeTest(async (server) => {
      await expect(
        apiAt(server.url, EntitiesApi).removeComment(
          ref(state, 'deleteWorkComment'),
          param(state, 'deleteWorkComment', 'commentId'),
        ),
      ).resolves.toBeUndefined();
    });
  });

  it('show-work-desk: the workspaces a dispatch stood on its branch', () => {
    const state = 'a reported ticket';
    return given(state, 'listWorkWorkspaces', 'show-work-desk', LIST_WORK_WORKSPACES).executeTest(
      async (server) => {
        const workspaces = await apiAt(server.url, EntitiesApi).workspaces(
          ref(state, 'listWorkWorkspaces'),
        );
        expect(workspaces).toEqual([]);
      },
    );
  });
});
