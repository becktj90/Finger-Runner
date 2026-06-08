---
name: Fixing transitive npm vulns in this pnpm monorepo
description: How to patch vulnerable transitive deps without touching app code
---

To fix a vulnerable **transitive** npm dependency, add a version override under
the `overrides:` block in the root `pnpm-workspace.yaml` (NOT package.json), then
run `pnpm install` to regenerate the lockfile. The file already uses this pattern
(e.g. `qs`, `esbuild`). Keep an inline comment with the GHSA id + why it's safe.

**Why:** These deps are pulled by tooling we don't control (commonly the Expo
toolchain — `xcode`, `@expo/ngrok`, `@expo/metro-config`). Overrides are the only
clean lever; editing node_modules or app code won't stick.

**How to apply / verify:**
- Get the patched-version range from `runDependencyAudit()` (it returns
  `fix.version` and `fix.requiresMajorUpdate`).
- If a fix `requiresMajorUpdate` (e.g. uuid 3/7 -> 11), CHECK consumer usage
  first (`rg "require\('pkg'\)"` in node_modules, then how the var is used). A
  major bump is safe only if consumers use APIs that survived it — e.g. uuid's
  named `.v4()` export exists in v11's CJS build, so xcode/ngrok keep working.
- Re-run `runDependencyAudit()` to confirm 0 findings; smoke-test the bumped
  package with a quick `node -e` require + call.

**Unrelated noise:** the `finger-runner-mobile` (expo) and `last-human` (vite)
workflows often FAIL with EADDRINUSE on fixed ports (e.g. metro 19117) from
stale processes — not caused by dependency changes.
