// ── Audio settings persistence ─────────────────────────────────────────────────────────────────────────────

import { getSave, setSaveValue } from "./saveData";

export function isMusicEnabled(): boolean {
  return getSave().musicOn;
}

export function isSoundEnabled(): boolean {
  return getSave().soundOn;
}

export function setMusicEnabled(v: boolean) {
  setSaveValue("musicOn", v);
}

export function setSoundEnabled(v: boolean) {
  setSaveValue("soundOn", v);
}

export function toggleMusic(): boolean {
  const v = !isMusicEnabled();
  setMusicEnabled(v);
  return v;
}

export function toggleSound(): boolean {
  const v = !isSoundEnabled();
  setSoundEnabled(v);
  return v;
}
