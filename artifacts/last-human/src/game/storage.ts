import type { HighScore, RunSnapshot, SaveData } from "./types";

const KEY = "last-human-save-v1";
const MAX_SCORES = 10;
export const RUN_VERSION = 1;

const DEFAULT: SaveData = {
  highScore: 0,
  bestSector: 0,
  lore: [],
  runsCompleted: 0,
  settings: { muted: false },
  scores: [],
  run: null,
};

function freshDefault(): SaveData {
  return {
    ...DEFAULT,
    lore: [],
    scores: [],
    settings: { ...DEFAULT.settings },
  };
}

function sanitizeScores(raw: unknown): HighScore[] {
  if (!Array.isArray(raw)) return [];
  const out: HighScore[] = [];
  for (const s of raw) {
    if (s && typeof s === "object") {
      const e = s as Partial<HighScore>;
      if (typeof e.score === "number") {
        out.push({
          score: e.score,
          sector: e.sector ?? 0,
          duration: e.duration ?? 0,
          endless: !!e.endless,
          faction: typeof e.faction === "string" ? e.faction : "Unknown",
          date: e.date ?? 0,
        });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_SCORES);
}

function sanitizeRun(raw: unknown): RunSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RunSnapshot>;
  if (r.v !== RUN_VERSION) return null;
  if (
    typeof r.sectorIndex !== "number" ||
    typeof r.runSeed !== "number" ||
    !r.metrics ||
    !r.rep ||
    !r.player ||
    !Array.isArray(r.consumed) ||
    !Array.isArray(r.headlines)
  ) {
    return null;
  }
  return r as RunSnapshot;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshDefault();
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      highScore: parsed.highScore ?? 0,
      bestSector: parsed.bestSector ?? 0,
      lore: Array.isArray(parsed.lore) ? parsed.lore : [],
      runsCompleted: parsed.runsCompleted ?? 0,
      settings: { muted: parsed.settings?.muted ?? false },
      scores: sanitizeScores(parsed.scores),
      run: sanitizeRun(parsed.run),
    };
  } catch {
    return freshDefault();
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

export function saveRun(data: SaveData, snapshot: RunSnapshot) {
  data.run = snapshot;
  writeSave(data);
}

export function clearRun(data: SaveData) {
  if (data.run === null) return;
  data.run = null;
  writeSave(data);
}

export function addHighScore(data: SaveData, entry: HighScore) {
  data.scores.push(entry);
  data.scores.sort((a, b) => b.score - a.score);
  if (data.scores.length > MAX_SCORES) data.scores.length = MAX_SCORES;
  writeSave(data);
}
