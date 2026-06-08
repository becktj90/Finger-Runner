import type { SaveData } from "./types";

const KEY = "last-human-save-v1";

const DEFAULT: SaveData = {
  highScore: 0,
  bestSector: 0,
  lore: [],
  runsCompleted: 0,
  settings: { muted: false },
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT, settings: { ...DEFAULT.settings } };
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      highScore: parsed.highScore ?? 0,
      bestSector: parsed.bestSector ?? 0,
      lore: Array.isArray(parsed.lore) ? parsed.lore : [],
      runsCompleted: parsed.runsCompleted ?? 0,
      settings: { muted: parsed.settings?.muted ?? false },
    };
  } catch {
    return { ...DEFAULT, settings: { ...DEFAULT.settings } };
  }
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function unlockLore(data: SaveData, id: string): boolean {
  if (data.lore.includes(id)) return false;
  data.lore.push(id);
  writeSave(data);
  return true;
}
