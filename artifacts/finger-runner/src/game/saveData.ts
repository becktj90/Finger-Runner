// ── Persistent versioned save data with legacy migration ──────────────────────

export const SAVE_VERSION = 3;

export interface GameSave {
  version: number;
  maxLevel: number;
  bestScore: number;
  totalCoins: number;
  /** Legacy (pre-v3) — hats were replaced by vehicles; kept for parse back-compat. */
  equippedHat: string;
  selectedCharacter: string;
  /** Legacy (pre-v3) — hats were replaced by vehicles; kept for parse back-compat. */
  ownedHats: string[];
  equippedVehicle: string;
  ownedVehicles: string[];
  /** Paint-shop hex for the ride's body; "" = auto (character palette). */
  vehicleColor: string;
  saberLevel: number;
  ownedSabers: number[];
  equippedSaber: number;
  kidsMode: boolean;
  musicOn: boolean;
  soundOn: boolean;
  achievements: Record<string, boolean>;
  stats: GameStats;
  endlessHighScore: number;
  endlessDistance: number;
}

export interface GameStats {
  totalRuns: number;
  totalDeaths: number;
  totalCoinsCollected: number;
  totalObstaclesSliced: number;
  totalJumps: number;
  totalDoubleJumps: number;
  bestLevelScores: Record<number, number>;
  playTimeSeconds: number;
}

const SAVE_KEY = "fingerRunnerSave";
const PLAYER_ID_KEY = "fingerRunnerPlayerId";

function createDefaultSave(): GameSave {
  return {
    version: SAVE_VERSION,
    maxLevel: 1,
    bestScore: 0,
    totalCoins: 0,
    equippedHat: "none",
    selectedCharacter: "apollo",
    ownedHats: ["none"],
    equippedVehicle: "vespa",
    ownedVehicles: ["vespa"],
    vehicleColor: "",
    saberLevel: 1,
    ownedSabers: [1],
    equippedSaber: 1,
    kidsMode: false,
    musicOn: true,
    soundOn: true,
    achievements: {},
    stats: {
      totalRuns: 0,
      totalDeaths: 0,
      totalCoinsCollected: 0,
      totalObstaclesSliced: 0,
      totalJumps: 0,
      totalDoubleJumps: 0,
      bestLevelScores: {},
      playTimeSeconds: 0,
    },
    endlessHighScore: 0,
    endlessDistance: 0,
  };
}

function migrateLegacy(save: GameSave): GameSave {
  // Migrate from old scattered localStorage keys
  try {
    const oldMaxLevel = parseInt(localStorage.getItem("fingerRunnerMaxLevel") || "0");
    if (oldMaxLevel > save.maxLevel) save.maxLevel = oldMaxLevel;

    const oldBest = parseInt(localStorage.getItem("fingerRunnerBest") || "0");
    if (oldBest > save.bestScore) save.bestScore = oldBest;

    const oldCoins = parseInt(localStorage.getItem("fingerRunnerCoins") || "0");
    if (oldCoins > save.totalCoins) save.totalCoins = oldCoins;

    const oldHat = localStorage.getItem("fingerRunnerHat");
    if (oldHat && !save.ownedHats.includes(oldHat)) {
      save.ownedHats.push(oldHat);
      save.equippedHat = oldHat;
    }

    const oldSaber = parseInt(localStorage.getItem("fingerRunnerSaber") || "0");
    if (oldSaber > 0 && !save.ownedSabers.includes(oldSaber)) {
      save.ownedSabers.push(oldSaber);
      save.saberLevel = oldSaber;
      save.equippedSaber = oldSaber;
    }

    const oldKids = localStorage.getItem("fingerRunnerKids");
    if (oldKids === "1") save.kidsMode = true;

    // Clear old keys after migration
    localStorage.removeItem("fingerRunnerMaxLevel");
    localStorage.removeItem("fingerRunnerBest");
    localStorage.removeItem("fingerRunnerCoins");
    localStorage.removeItem("fingerRunnerHat");
    localStorage.removeItem("fingerRunnerSaber");
    localStorage.removeItem("fingerRunnerKids");
  } catch {
    // ignore migration errors
  }
  return save;
}

// ── v2 → v3: hats retired in favour of vehicles ──────────────────────────────
// Refunds coins spent on purchased hats and seeds the vehicle fields.
const HAT_REFUNDS: Record<string, number> = {
  beanie: 25, party: 50, wizard: 90, propeller: 140, halo: 200,
};

function migrateToV3(save: GameSave): GameSave {
  let refund = 0;
  for (const hat of save.ownedHats) refund += HAT_REFUNDS[hat] || 0;
  save.totalCoins += refund;
  if (!save.ownedVehicles || save.ownedVehicles.length === 0) save.ownedVehicles = ["vespa"];
  if (!save.equippedVehicle) save.equippedVehicle = "vespa";
  return save;
}

export function loadSave(): GameSave {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      const save = createDefaultSave();
      return migrateLegacy(save);
    }
    const parsed = JSON.parse(raw) as Partial<GameSave>;
    let save = { ...createDefaultSave(), ...parsed };
    // Ensure nested stats exist
    if (!save.stats) save.stats = createDefaultSave().stats;
    else save.stats = { ...createDefaultSave().stats, ...save.stats };
    if (!save.achievements) save.achievements = {};
    if (!save.ownedHats) save.ownedHats = ["none"];
    if (!save.ownedSabers) save.ownedSabers = [1];
    if (!save.ownedVehicles) save.ownedVehicles = ["vespa"];
    if (!save.equippedVehicle) save.equippedVehicle = "vespa";
    if (save.version < 2) {
      save = migrateLegacy(save);
    }
    if (save.version < 3) {
      save = migrateToV3(save);
    }
    if (save.version < SAVE_VERSION) {
      save.version = SAVE_VERSION;
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* ignore */ }
    }
    return save;
  } catch {
    const save = createDefaultSave();
    return migrateLegacy(save);
  }
}

export function saveGame(save: GameSave) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // storage full or private mode
  }
  schedulePushToCloud();
}

// Quick accessors that read/write through the save system
let _cachedSave: GameSave | null = null;

export function getSave(): GameSave {
  if (!_cachedSave) _cachedSave = loadSave();
  return _cachedSave;
}

function flushSave() {
  if (_cachedSave) saveGame(_cachedSave);
}

export function getSaveValue<K extends keyof GameSave>(key: K): GameSave[K] {
  return getSave()[key];
}

export function setSaveValue<K extends keyof GameSave>(key: K, value: GameSave[K]) {
  const s = getSave();
  s[key] = value;
  flushSave();
}

export function patchSave(patch: Partial<GameSave>) {
  const s = getSave();
  Object.assign(s, patch);
  flushSave();
}

export function getStatValue<K extends keyof GameStats>(key: K): GameStats[K] {
  return getSave().stats[key];
}

export function setStatValue<K extends keyof GameStats>(key: K, value: GameStats[K]) {
  const s = getSave();
  s.stats[key] = value;
  flushSave();
}

export function incrementStat(key: keyof GameStats, amount = 1) {
  const s = getSave();
  const current = (s.stats[key] as number) || 0;
  (s.stats[key] as number) = current + amount;
  flushSave();
}

export function recordLevelScore(level: number, score: number) {
  const s = getSave();
  const prev = s.stats.bestLevelScores[level] || 0;
  if (score > prev) {
    s.stats.bestLevelScores[level] = score;
    flushSave();
  }
}

export function clearCache() {
  _cachedSave = null;
}

// ── Cloud sync ────────────────────────────────────────────────────────────────

function getApiBase(): string {
  try {
    return `${window.location.origin}/api`;
  } catch {
    return "/api";
  }
}

export function getPlayerId(): string {
  try {
    const existing = localStorage.getItem(PLAYER_ID_KEY);
    if (existing) return existing;
    const id = generateUuid();
    localStorage.setItem(PLAYER_ID_KEY, id);
    return id;
  } catch {
    return generateUuid();
  }
}

function generateUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface SaveSync {
  coins: number;
  ownedSabers: number[];
  equippedSaber: number;
  maxLevel: number;
  bestScore: number;
  updatedAt: number;
}

function saveToSyncBlob(save: GameSave): SaveSync {
  return {
    coins: save.totalCoins,
    ownedSabers: save.ownedSabers,
    equippedSaber: save.equippedSaber,
    maxLevel: save.maxLevel,
    bestScore: save.bestScore,
    updatedAt: Date.now(),
  };
}

function mergeCloudIntoSave(save: GameSave, cloud: SaveSync): boolean {
  let changed = false;

  if (cloud.coins > save.totalCoins) {
    save.totalCoins = cloud.coins;
    changed = true;
  }

  const cloudOwned = Array.isArray(cloud.ownedSabers) ? cloud.ownedSabers : [];
  for (const tier of cloudOwned) {
    if (!save.ownedSabers.includes(tier)) {
      save.ownedSabers.push(tier);
      save.ownedSabers.sort((a, b) => a - b);
      changed = true;
    }
  }

  // Carry the equipped saber across devices too (max-wins, and only if the
  // tier is actually owned after the ownership merge above).
  if (
    typeof cloud.equippedSaber === "number" &&
    cloud.equippedSaber > (save.equippedSaber || 1) &&
    save.ownedSabers.includes(cloud.equippedSaber)
  ) {
    save.equippedSaber = cloud.equippedSaber;
    changed = true;
  }

  if (cloud.maxLevel > save.maxLevel) {
    save.maxLevel = cloud.maxLevel;
    changed = true;
  }

  if (cloud.bestScore > save.bestScore) {
    save.bestScore = cloud.bestScore;
    changed = true;
  }

  return changed;
}

export async function syncFromCloud(): Promise<void> {
  try {
    const playerId = getPlayerId();
    const res = await fetch(`${getApiBase()}/saves/${playerId}`);
    if (!res.ok) return;
    const cloud = (await res.json()) as SaveSync;
    const save = getSave();
    const changed = mergeCloudIntoSave(save, cloud);
    if (changed) {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      } catch {
        // ignore
      }
    }
  } catch {
    // Network unavailable — silently continue with local data.
  }
}

let _pushTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePushToCloud() {
  if (_pushTimer !== null) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    _pushTimer = null;
    void pushToCloud();
  }, 2000);
}

async function pushToCloud(): Promise<void> {
  try {
    const save = getSave();
    const playerId = getPlayerId();
    const blob = saveToSyncBlob(save);
    await fetch(`${getApiBase()}/saves/${playerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blob),
    });
  } catch {
    // Network unavailable — local save is still intact.
  }
}

export async function fetchSyncCode(): Promise<string | null> {
  try {
    const playerId = getPlayerId();
    const res = await fetch(`${getApiBase()}/saves/${playerId}/link-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { code?: string };
    return data.code ?? null;
  } catch {
    return null;
  }
}

export async function adoptSyncCode(
  code: string,
): Promise<{ ok: boolean; merged?: boolean }> {
  try {
    const save = getSave();
    const body = {
      playerId: getPlayerId(),
      coins: save.totalCoins,
      ownedSabers: save.ownedSabers,
      equippedSaber: save.equippedSaber,
      maxLevel: save.maxLevel,
      bestScore: save.bestScore,
    };
    const res = await fetch(`${getApiBase()}/saves/link/${code.trim().toUpperCase()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as {
      playerId?: string;
      coins?: number;
      ownedSabers?: number[];
      equippedSaber?: number;
      maxLevel?: number;
      bestScore?: number;
    };
    if (!data.playerId) return { ok: false };

    try {
      localStorage.setItem(PLAYER_ID_KEY, data.playerId);
    } catch {
      // ignore
    }

    const s = getSave();
    if (typeof data.coins === "number" && data.coins > s.totalCoins) s.totalCoins = data.coins;
    if (Array.isArray(data.ownedSabers)) {
      for (const tier of data.ownedSabers) {
        if (!s.ownedSabers.includes(tier)) s.ownedSabers.push(tier);
      }
      s.ownedSabers.sort((a, b) => a - b);
    }
    if (typeof data.maxLevel === "number" && data.maxLevel > s.maxLevel) s.maxLevel = data.maxLevel;
    if (typeof data.bestScore === "number" && data.bestScore > s.bestScore) s.bestScore = data.bestScore;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    } catch {
      // ignore
    }

    return { ok: true, merged: true };
  } catch {
    return { ok: false };
  }
}

// Kick off a background sync on module load.
if (typeof window !== "undefined") {
  void syncFromCloud();
}
