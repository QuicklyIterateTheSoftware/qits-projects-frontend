// @ts-check
//
// The `app` prefix is deliberate and it is a boundary marker, not a default left in place: a
// `qits-*` element in a template comes from @qits/ui-components, an `app-*` element is this
// application's own. Sharing the library prefix would make "is this ours or the design system's?"
// unanswerable from the template.
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const { existsSync } = require('node:fs');
const { basename } = require('node:path');
const qits = require('@qits/angular/eslint').default;

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The consumer pact (epic qits-965), the way qits-landing-app keeps its own: pacts name both
    // sides by repository name (`pact-names`: the consumer is package.json's `name`), and a store
    // that imports a client has a pact spec beside it (`store-has-pact`). This app's clients are
    // the hand-written `src/app/api/*-api.ts` classes rather than stores over a generated client,
    // and `store-has-pact` only ever looks at a `*.store.ts` — so `api-has-pact` below holds the
    // api files to the same rule: one that addresses qits-projects' `/work` surface has its
    // `*-api.pact.spec.ts` beside it.
    files: ['**/*.ts'],
    plugins: { qits, local: { rules: { 'api-has-pact': apiHasPact() } } },
    rules: {
      'qits/store-has-pact': 'error',
      'qits/pact-names': 'error',
      'local/api-has-pact': 'error',
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);

/**
 * `src/app/api/<x>-api.ts` that names a `/projects/api/work` path needs `<x>-api.pact.spec.ts`
 * beside it, where its calls are recorded against qits-projects' golden masters.
 */
function apiHasPact() {
  return {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        noPact:
          "This api calls qits-projects' /work surface but has no pact spec: add {{pact}} beside it.",
      },
    },
    create(context) {
      const file = context.physicalFilename ?? context.filename;
      if (!/[/\\]src[/\\]app[/\\]api[/\\][^/\\]+-api\.ts$/.test(file)) return {};
      const pact = file.replace(/\.ts$/, '.pact.spec.ts');
      let reported = false;
      const check = (node, text) => {
        if (reported || !text.includes('/projects/api/work') || existsSync(pact)) return;
        reported = true;
        context.report({ node, messageId: 'noPact', data: { pact: basename(pact) } });
      };
      return {
        Literal: (node) => typeof node.value === 'string' && check(node, node.value),
        TemplateElement: (node) => check(node, node.value.cooked ?? ''),
      };
    },
  };
}
