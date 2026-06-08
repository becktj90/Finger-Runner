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
