---
name: Vanilla canvas game inside react-vite artifact
description: How to mount a framework-free HTML5 Canvas game in the react-vite scaffold and the two gotchas that bite.
---

When building a logic-heavy vanilla TS canvas game, mount it inside a normal
`react-vite` web artifact instead of inventing a new artifact kind.

**How to apply:**
- Replace `src/main.tsx` so it does NOT render React — just `new Game(document.getElementById("root"))`. Add `import.meta.hot?.dispose(() => game.destroy())` to avoid duplicate RAF/listeners on HMR.
- Replace `src/index.css` ENTIRELY. The scaffold's index.css ships Tailwind with placeholder CSS vars (e.g. `--background` set to a stark red); if you don't replace it the page renders with that red background.
- Delete the unused scaffold tree (`src/App.tsx`, `src/components`, `src/hooks`, `src/lib`, `src/pages`) once nothing imports them — Vite only bundles what `main.tsx` reaches, but the dead files are noise and a reviewer flag.
- Vite build uses esbuild and does NOT typecheck; run `pnpm --filter @workspace/<pkg> run typecheck` before declaring done.

**Why:** these two defaults (React entry + Tailwind placeholder CSS) silently break a non-React canvas game, and the symptom (red screen / no canvas) is not obvious from the game code itself.

## Resumable-run snapshots: commit consumption at resolution, not on touch

For a roguelite with mid-run save/resume (snapshot to localStorage + restore by
regenerating sectors from a stored seed and replaying a `consumed` id set):
commit an entity to the persisted `consumed` set only when its interaction is
fully resolved, never when the modal/interaction merely *opens*.

**Why:** autosave can fire while a choice modal is open (periodic timer,
pagehide, visibilitychange). If you mark an event/ruin consumed at open, a
background/reload during the unresolved modal permanently loses that event (and
its rewards) on resume. Resources are different — they consume atomically at
pickup (reward + consumed together), so committing immediately is correct there.

**How to apply:** at open, set only an in-memory `used` flag (dedup for the live
session) plus a `pendingEntityId`; add to the persisted `consumed` set inside
the resolver after effects apply, then null `pendingEntityId`. Reset both
`pendingEntityId` and `currentEvent` whenever you load/restore a sector so they
never leak across sectors. Use deterministic per-sector entity ids
(`index*1000 + localIndex`, no global counter) so a regenerated sector's ids
match the saved `consumed` set.
