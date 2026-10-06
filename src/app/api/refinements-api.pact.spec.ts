import { HttpErrorResponse } from '@angular/common/http';
import { PactV4 } from '@pact-foundation/pact';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addGoldenInteraction } from '@qits/angular/testing';
import { projectsGoldenMasters as masters } from '../../testing/golden-masters';
import { apiAt } from '../../testing/pact-client';
import { assertPactPart } from '../../testing/pact-part';
import { RefinementsApi } from './refinements-api';

/**
 * `RefinementsApi`'s part of qits-projects-frontend's pact with qits-projects-service (epic
 * qits-965): an entity's refinement room, found (`GET /work/{q}/refinement`) and opened (`POST`),
 * in the same file as the other api classes' parts
 * (`pacts/qits-projects-frontend_qits-projects-service.json`, see `src/testing/pact-part.ts`).
 */
const CONSUMER = 'qits-projects-frontend';
const PROVIDER = 'qits-projects-service';
const COMMITTED = resolve(process.cwd(), `pacts/${CONSUMER}_${PROVIDER}.json`);
const OPERATIONS = ['getWorkRefinement', 'startWorkRefinement'];

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
});
