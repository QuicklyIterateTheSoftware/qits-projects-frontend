import { PactV4 } from '@pact-foundation/pact';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addGoldenInteraction } from '@qits/angular/testing';
import { projectsGoldenMasters as masters } from '../../testing/golden-masters';
import { apiAt } from '../../testing/pact-client';
import { assertPactPart } from '../../testing/pact-part';
import { ArchetypesApi } from './archetypes-api';

/**
 * `ArchetypesApi`'s part of qits-projects-frontend's pact with qits-projects-service (epic qits-965):
 * the archetype registry, `GET /work/archetypes`, in the same file as the other api classes' parts
 * (`pacts/qits-projects-frontend_qits-projects-service.json`, see `src/testing/pact-part.ts`).
 */
const CONSUMER = 'qits-projects-frontend';
const PROVIDER = 'qits-projects-service';
const COMMITTED = resolve(process.cwd(), `pacts/${CONSUMER}_${PROVIDER}.json`);
const OPERATIONS = ['listWorkArchetypes'];
const STATE = 'the archetype registry';

/** What the desks, the reshape form and the detail page read of the registry. */
const LIST_WORK_ARCHETYPES = [
  'properties',
  'serverOwned',
  'archetypes[].archetype',
  'archetypes[].depth',
  'archetypes[].mayBeRoot',
  'archetypes[].required',
  'archetypes[].requiredOnTransition',
  'archetypes[].permitted',
  'archetypes[].legalStatuses',
  'archetypes[].lifecycle',
  'archetypes[].transitions',
] as const;

const dir = mkdtempSync(join(tmpdir(), 'qits-projects-frontend-archetypes-api-pact-'));
const pact = new PactV4({ consumer: CONSUMER, provider: PROVIDER, dir, logLevel: 'warn' });

describe('qits-projects-frontend → qits-projects-service pact: ArchetypesApi', () => {
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

  it('show-work-item-actions: reads the registry once', () =>
    addGoldenInteraction(pact, masters, {
      provider: PROVIDER,
      state: STATE,
      operationId: 'listWorkArchetypes',
      trigger: { kind: 'ui', app: CONSUMER, interaction: 'show-work-item-actions' },
      consumes: LIST_WORK_ARCHETYPES,
    }).executeTest(async (server) => {
      const registry = await apiAt(server.url, ArchetypesApi).registry();
      expect(registry.archetypes.length).toBeGreaterThan(0);
      expect(registry.archetypes[0].transitions).toBeTruthy();
    }));
});
