// ── Endless mode — unlocks after level 8 ─────────────────────────────────────────────────────────────────

import { getSave, setSaveValue, incrementStat } from "./saveData";

export interface EndlessState {
  score: number;
  distance: number;
  speed: number;
  spawnRate: number;
  combo: number;
  maxCombo: number;
  phase: number;
  phaseTimer: number;
  coinsCollected: number;
  obstaclesSliced: number;
}

export function createEndlessState(): EndlessState {
  return {
    score: 0,
    distance: 0,
    speed: 2.5,
    spawnRate: 120,
    combo: 0,
    maxCombo: 0,
    phase: 1,
    phaseTimer: 0,
    coinsCollected: 0,
    obstaclesSliced: 0,
  };
}

export function isEndlessUnlocked(): boolean {
  return getSave().maxLevel > 8;
}

export function updateEndless(state: EndlessState): EndlessState {
  // Distance increases by speed each frame
  state.distance += state.speed;
  // Score = distance + combo bonus
  state.score = Math.floor(state.distance + state.combo * 10);

  // Phase progression every ~500 distance
  const targetPhase = 1 + Math.floor(state.distance / 500);
  if (targetPhase > state.phase) {
    state.phase = targetPhase;
    // Speed up every phase
    state.speed = Math.min(6.0, 2.5 + state.phase * 0.4);
    state.spawnRate = Math.max(50, 120 - state.phase * 8);
  }

  state.phaseTimer++;
  return state;
}

export function recordSlice(state: EndlessState) {
  state.obstaclesSliced++;
  state.combo++;
  if (state.combo > state.maxCombo) state.maxCombo = state.combo;
  return state;
}

export function resetCombo(state: EndlessState) {
  state.combo = 0;
  return state;
}

export function collectCoin(state: EndlessState) {
  state.coinsCollected++;
  return state;
}

export function saveEndlessResults(state: EndlessState) {
  const save = getSave();
  if (state.score > save.endlessHighScore) {
    save.endlessHighScore = state.score;
    setSaveValue("endlessHighScore", state.score);
  }
  if (state.distance > save.endlessDistance) {
    save.endlessDistance = state.distance;
    setSaveValue("endlessDistance", state.distance);
  }
  incrementStat("totalCoinsCollected", state.coinsCollected);
  incrementStat("totalObstaclesSliced", state.obstaclesSliced);
  incrementStat("totalRuns", 1);
}

export function getEndlessHighScore(): number {
  return getSave().endlessHighScore;
}

export function getEndlessBestDistance(): number {
  return getSave().endlessDistance;
}
