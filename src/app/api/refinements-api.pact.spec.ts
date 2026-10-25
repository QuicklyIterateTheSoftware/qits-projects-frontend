import { HttpErrorResponse } from '@angular/common/http';
import { PactV4 } from '@pact-foundation/pact';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addGoldenInteraction } from '@qits/angular/testing';
import { projectsGoldenMasters as masters } from '../../testing/golden-masters';
import { apiAt } from '../../testing/pact-client';
import { assertPactPart, type OwnedOperation } from '../../testing/pact-part';
import { RefinementsApi, isSessionRoom } from './refinements-api';

/**
 * `RefinementsApi`'s part of qits-projects-frontend's pact with qits-projects-service (epic
 * qits-965): an entity's refinement room, found (`GET /work/{q}/refinement`) and opened (`POST`),
 * in the same file as the other api classes' parts
 * (`pacts/qits-projects-frontend_qits-projects-service.json`, see `src/testing/pact-part.ts`).
 *
 * <p><b>The session rooms (epic qits-770).</b> A room opened now is a session of the project's
 * front desk: it is found with the session fields the SPA decides on and draws (`deskBase`,
 * `deskStatus`, `deskDetail`, `sessionId`, `commandId`, the session's `runtimeStatus` and
 * `runtimeError`), ensured (`POST …/ensure`) and stopped (`POST …/stop`). **No container field is
 * consumed** — not `branch`, `clean`, the drift or the daemon's version — so the service can drop
 * them (qits-1316) without breaking this pact: the SPA tells a legacy room by a `branch` that is
 * there, and an absent one reads as a session room.
 *
 * <p>Those three interactions need the session golden masters (qits-projects-service f4e0962d,
 * released by its rr-362). Until the pinned `@qits/projects-golden-masters` records them, this spec
 * neither generates nor owns them — {@link SESSIONS} — and the committed pact keeps the ones
 * generated against the service's own recording; once the pin moves, they are checked like the rest.
 */
const CONSUMER = 'qits-projects-frontend';
const PROVIDER = 'qits-projects-service';
const COMMITTED = resolve(process.cwd(), `pacts/${CONSUMER}_${PROVIDER}.json`);

/** The state the session golden masters are recorded in. */
const SESSION_STATE = 'a ticket with a design';

/** What a session room's find is read for. */
const SESSION_FIELDS = [
  'refinement.id',
  'refinement.entityId',
  'refinement.runtimeStatus',
  'refinement.runtimeError',
  'refinement.sessionId',
  'refinement.commandId',
  'refinement.deskStatus',
  'refinement.deskDetail',
  'refinement.deskBase',
];

/** Whether the pinned golden masters record a session room — see the class note. */
const SESSIONS = ((): boolean => {
  try {
    masters.operation(SESSION_STATE, 'ensureRefinementSession');
    masters.operation(SESSION_STATE, 'stopRefinementSession');
    const found = masters.body<{ refinement?: Record<string, unknown> }>(
      SESSION_STATE,
      'getWorkRefinement',
    );
    return found.refinement !== undefined && 'deskBase' in found.refinement;
  } catch {
    return false;
  }
})();

const OPERATIONS: readonly OwnedOperation[] = [
  'startWorkRefinement',
  { operationId: 'getWorkRefinement', interactions: ['show-work-item'] },
  ...(SESSIONS
    ? [
        { operationId: 'getWorkRefinement', interactions: ['show-refinement-room'] },
        'ensureRefinementSession',
        'stopRefinementSession',
      ]
    : []),
];

const dir = mkdtempSync(join(tmpdir(), 'qits-projects-frontend-refinements-api-pact-'));
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

/** The entity a recording addresses. */
const ref = (state: string, operationId: string) =>
  masters.operation(state, operationId).params['qualifiedId'];

/** The room a recording addresses. */
const roomId = (state: string, operationId: string) =>
  Number(masters.operation(state, operationId).params['refinementId']);

/** Registers the test only where the pinned golden masters record a session room. */
const withSessions = SESSIONS ? it : it.skip;

describe('qits-projects-frontend → qits-projects-service pact: RefinementsApi', () => {
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

  it('show-work-item: an entity with no room answers none', () => {
    const state = 'a reported ticket';
    return given(state, 'getWorkRefinement', 'show-work-item', ['refinement']).executeTest(
      async (server) => {
        const room = await apiAt(server.url, RefinementsApi).findFor(
          ref(state, 'getWorkRefinement'),
        );
        expect(room).toBeNull();
      },
    );
  });

  it('open-refinement-room: a refused open is the service’s 409', () => {
    const state = 'a refined ticket';
    return given(state, 'startWorkRefinement', 'open-refinement-room', []).executeTest(
      async (server) => {
        const refused = await apiAt(server.url, RefinementsApi)
          .openFor(ref(state, 'startWorkRefinement'))
          .catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(HttpErrorResponse);
        expect((refused as HttpErrorResponse).status).toBe(409);
      },
    );
  });

  withSessions('show-refinement-room: a session room is found with its session and its desk', () =>
    given(SESSION_STATE, 'getWorkRefinement', 'show-refinement-room', SESSION_FIELDS).executeTest(
      async (server) => {
        const room = await apiAt(server.url, RefinementsApi).findFor(
          ref(SESSION_STATE, 'getWorkRefinement'),
        );
        expect(room).not.toBeNull();
        expect(isSessionRoom(room!)).toBe(true);
        expect(room!.deskBase).toMatch(/^\/projects\/container\/[^/]+\/$/);
        expect(room!.deskStatus).toBe('QUEUED');
        expect(room!.runtimeStatus).toBe('STARTING');
      },
    ),
  );

  withSessions('start-refinement-session: ensure answers the room as it now stands', () =>
    given(SESSION_STATE, 'ensureRefinementSession', 'start-refinement-session', [
      'refinement.id',
      'refinement.runtimeStatus',
      'refinement.runtimeError',
      'refinement.deskStatus',
      'refinement.deskDetail',
    ]).executeTest(async (server) => {
      const room = await apiAt(server.url, RefinementsApi).ensure(
        roomId(SESSION_STATE, 'ensureRefinementSession'),
      );
      expect(room.runtimeStatus).toBe('STARTING');
    }),
  );

  withSessions('stop-refinement-session: stop answers the room stopped', () =>
    given(SESSION_STATE, 'stopRefinementSession', 'stop-refinement-session', [
      'refinement.id',
      'refinement.runtimeStatus',
      'refinement.runtimeError',
      'refinement.deskStatus',
      'refinement.deskDetail',
    ]).executeTest(async (server) => {
      const room = await apiAt(server.url, RefinementsApi).stop(
        roomId(SESSION_STATE, 'stopRefinementSession'),
      );
      expect(room.runtimeStatus).toBe('STOPPED');
    }),
  );
});
