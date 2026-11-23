# anti-slop provenance

- Source: https://github.com/dmmulroy/anti-slop
- Source commit: `63dbb09f73438e550a6991dc6d778f979ffbf183` (the `install-anti-slop` skill snapshot, folder hash
  `7fdaa6312dac0ec3a6929933dc45d516bb4a7b71`, installed 2026-11-23). Files were copied from the skill's
  `assets/anti-slop/` by its `scripts/install.mjs`, unmodified.
- Installed on: 2026-11-23, with `oxlint` and `@oxlint/plugins` pinned at 1.95.0.
- Installed paths: `tools/oxlint/anti-slop/` (generic plugin `index.ts`, `rules/`, `shared/`, `vendor/eslint-stylistic/`).
  `effect/` was copied but is not registered: the repo has no direct `effect` dependency.

## Intentional deviations

- These rules are set to `warn` instead of `error`, because the existing code had many violations at install time
  (about 6,800 findings, mostly `require-readable-spacing`): `no-array-filter-map`, `no-chained-type-assertions`,
  `no-conditional-empty-object-spread`, `no-known-value-widening`, `no-object-parameters`, `no-reflect-get`,
  `no-runtime-typeof`, `no-shape-in-symbol-names`, `no-unknown-parameters`, `no-unsafe-dictionary-type`,
  `require-readable-spacing`, `require-safety-comment-for-type-assertion`. Move each back to `error` once its
  findings are cleaned up.
- `.scratch/**` is added to `ignorePatterns` (local agent scratch space).
