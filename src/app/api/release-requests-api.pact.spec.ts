import { PactV4 } from '@pact-foundation/pact';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addGoldenInteraction } from '@qits/angular/testing';
import { projectsGoldenMasters as masters } from '../../testing/golden-masters';
import { apiAt } from '../../testing/pact-client';
import { assertPactPart } from '../../testing/pact-part';
import { ReleaseRequestsApi } from './release-requests-api';

/**
 * `ReleaseRequestsApi`'s part of qits-projects-frontend's pact with qits-projects-service: the
 * deploy hold of a release request (qits-2268) — the switch, `PUT …/deploy-hold`, on and off, and
 * the request read whose hold fields the release request page draws. In the same file as the other
 * api classes' parts (`pacts/qits-projects-frontend_qits-projects-service.json`, see
 * `src/testing/pact-part.ts`).
 *
 * <p>Only the hold is bound here. The rest of the page's release-request surface predates this
 * consumer's pacts and is not claimed by this spec; `getReleaseRequest` is owned for the one UI
 * interaction below only, so a later spec can bind the page's other reads beside it.
 */
const CONSUMER = 'qits-projects-frontend';
const PROVIDER = 'qits-projects-service';
const COMMITTED = resolve(process.cwd(), `pacts/${CONSUMER}_${PROVIDER}.json`);
const OPERATIONS = [
  'setReleaseRequestDeployHold',
  { operationId: 'getReleaseRequest', interactions: ['show-deploy-hold'] },
];

/** A request whose deploy is held: released or not, what the switch and its byline read. */
const HELD = 'a release request whose deploy is held';
/** A request still waiting for a person, which is where a hold is switched on. */
const AWAITING_APPROVAL = 'a release request awaiting approval';

/** What the hold control reads of a request: the row it replaces, the flag, and who switched it. */
const DEPLOY_HOLD = [
  'request.id',
  'request.repoId',
  'request.state',
  'request.deployHold',
  'request.deployHoldBy',
  'request.deployHoldAt',
] as const;

const dir = mkdtempSync(join(tmpdir(), 'qits-projects-frontend-release-requests-api-pact-'));
const pact = new PactV4({ consumer: CONSUMER, provider: PROVIDER, dir, logLevel: 'warn' });

const given = (state: string, operationId: string, interaction: string) =>
  addGoldenInteraction(pact, masters, {
    provider: PROVIDER,
    state,
    operationId,
    trigger: { kind: 'ui', app: CONSUMER, interaction },
    consumes: DEPLOY_HOLD,
  });

/** `state`'s param `name`, as recorded for `operationId`. */
const param = (state: string, operationId: string, name: string) =>
  masters.operation(state, operationId).params[name];

describe('qits-projects-frontend → qits-projects-service pact: ReleaseRequestsApi', () => {
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

  it('show-deploy-hold: reads who holds a request’s deploy', () => {
    const op = 'getReleaseRequest';
    return given(HELD, op, 'show-deploy-hold').executeTest(async (server) => {
      const request = await apiAt(server.url, ReleaseRequestsApi).get(
        param(HELD, op, 'repositoryId'),
        param(HELD, op, 'requestId'),
      );
      expect(request.deployHold).toBe(true);
      expect(request.deployHoldBy).toBeTruthy();
    });
  });

  it('hold-deploy: holds a request’s deploy for approval', () => {
    const op = 'setReleaseRequestDeployHold';
    return given(AWAITING_APPROVAL, op, 'hold-deploy').executeTest(async (server) => {
      const request = await apiAt(server.url, ReleaseRequestsApi).setDeployHold(
        param(AWAITING_APPROVAL, op, 'repositoryId'),
        param(AWAITING_APPROVAL, op, 'requestId'),
        true,
      );
      expect(request.deployHold).toBe(true);
    });
  });

  it('release-deploy-hold: releases a request’s deploy hold', () => {
    const op = 'setReleaseRequestDeployHold';
    return given(HELD, op, 'release-deploy-hold').executeTest(async (server) => {
      const request = await apiAt(server.url, ReleaseRequestsApi).setDeployHold(
        param(HELD, op, 'repositoryId'),
        param(HELD, op, 'requestId'),
        false,
      );
      expect(request.deployHold).toBe(false);
    });
  });
});
