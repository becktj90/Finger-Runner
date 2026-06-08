---
name: finger-runner typecheck duplicate-react-types
description: Pre-existing tsc errors in shadcn ui components are noise, not your bug
---

Running `pnpm --filter @workspace/finger-runner run typecheck` reports errors in
`src/components/ui/calendar.tsx` and `src/components/ui/spinner.tsx` of the form
"Two different types with this name exist ... VoidOrUndefinedOnly" / `Ref<...>`
mismatch.

**Why:** These come from two `@types/react` copies resolving in the pnpm monorepo
(a duplicate-types issue in the shadcn UI components), NOT from gameplay code in
`Game.tsx`. They predate the coins/outfits and difficulty-tuning work.

**How to apply:** When editing `artifacts/finger-runner/src/Game.tsx`, treat a
clean `Game.tsx` (zero errors pointing at Game.tsx) as passing. Don't chase the
calendar.tsx/spinner.tsx errors as if your change caused them. If you must get a
fully green typecheck, the fix is dependency dedupe (pin/resolve a single
`@types/react`), not editing those UI files.
