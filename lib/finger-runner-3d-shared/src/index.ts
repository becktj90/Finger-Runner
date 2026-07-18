// ── Single source of truth for the Finger Runner 3D visual layer ─────────
export const FINGER_CENTER_X = 185;
export const DEPTH_SCALE = 0.032;
export const HEIGHT_SCALE = 0.02;
export const LANE_X = 0;
export const LANE_OFFSET = 0.85;
export const ROAD_SURFACE_OFFSET = 108;
export const FINGER_TIP_OFFSET = 90;
export const HIDE_Z = -9999;

export const SLIDE_FRAMES = 34;
export const SLIDE_DUCK = 58;
export const BARRIER_GAP = 52;

export function worldZ(oldX: number): number {
  return -(oldX - FINGER_CENTER_X) * DEPTH_SCALE;
}
export function worldY(oldYAbs: number, roadYOld: number): number {
  return (roadYOld - oldYAbs) * HEIGHT_SCALE;
}
export function roadYOld(heightPx: number): number {
  return heightPx - ROAD_SURFACE_OFFSET;
}

export const POOL_OBSTACLES = 18;
export const POOL_COINS = 40;
export const POOL_PARTICLES = 100;
export const POOL_POWERUPS = 6;
export const POOL_PLATFORMS = 4;
export const POOL_ROPES = 3;
export const POOL_PUDDLES = 12;

// ── Ghibli-inspired painterly theme palettes ──────────────────────────────
// Warm golden-hour light, soft horizons, muted naturalistic colors.
export type Theme3D = "suburb" | "city" | "highway" | "mountain" | "night" | "moon";

export interface ThemePalette {
  fog: string; sky: string; ambient: string; sun: string; sunIntensity: number;
  road: string; shoulder: string; prop: string; propAccent: string;
  cloudColor: string; hillFar: string; hillMid: string;
}

export const THEME_COLORS: Record<Theme3D, ThemePalette> = {
  // Totoro-style: warm sun, lush green, cream sky
  suburb:   { fog: "#bce4c2", sky: "#72c8e8", ambient: "#ffd880", sun: "#fff6cc", sunIntensity: 3.0,
    road: "#786850", shoulder: "#5a8048", prop: "#1e6820", propAccent: "#78e040",
    cloudColor: "#f5f8f0", hillFar: "#558a40", hillMid: "#3a7230" },
  // Spirited Away dusk: warm lantern-lit buildings against dusky sky
  city:     { fog: "#c8a888", sky: "#d08050", ambient: "#ffb870", sun: "#ffe090", sunIntensity: 2.4,
    road: "#3a3028", shoulder: "#504030", prop: "#40383a", propAccent: "#ff8030",
    cloudColor: "#f0c888", hillFar: "#50486a", hillMid: "#604858" },
  // Nausicaa golden desert: warm amber sky, dusty road, glowing horizon
  highway:  { fog: "#c8982a", sky: "#e08830", ambient: "#ffc878", sun: "#ffe0a0", sunIntensity: 3.2,
    road: "#605038", shoulder: "#987040", prop: "#786010", propAccent: "#ffc820",
    cloudColor: "#f0d080", hillFar: "#907040", hillMid: "#b09050" },
  // Castle in the Sky: dreamy periwinkle, lavender mist, cottony clouds
  mountain: { fog: "#a8b0e0", sky: "#8090d0", ambient: "#c8d0f0", sun: "#ffecd8", sunIntensity: 2.6,
    road: "#4a4060", shoulder: "#706888", prop: "#585888", propAccent: "#c0a8f0",
    cloudColor: "#e8e0f8", hillFar: "#6060a0", hillMid: "#7878b8" },
  // Howl's Moving Castle night: deep indigo, amber embers, purple mist
  night:    { fog: "#1c1430", sky: "#0e0820", ambient: "#3820a8", sun: "#7050e8", sunIntensity: 1.4,
    road: "#181020", shoulder: "#20182c", prop: "#281e40", propAccent: "#a888ff",
    cloudColor: "#282040", hillFar: "#181028", hillMid: "#201838" },
  // Lunar surface: near-black sky, harsh white sun (no atmosphere), grey
  // regolith road and dusty silver hills. Cool blue Earthlight fill.
  moon:     { fog: "#0a0a12", sky: "#04040a", ambient: "#8a94b8", sun: "#ffffff", sunIntensity: 3.4,
    road: "#6a6a72", shoulder: "#4c4c55", prop: "#7e7e88", propAccent: "#c8d4ff",
    cloudColor: "#20202c", hillFar: "#3a3a44", hillMid: "#54545e" },
};

export const CHROME_ACCENT = "#e6e6f0";

// ── Obstacle visual configs ────────────────────────────────────────────
export type ObstacleRenderKind = "box" | "cylinder" | "cone" | "animal" | "bicycle" | "sign" | "barrier"
  | "poop" | "toilet" | "duck" | "dino" | "pinata" | "undies";

// Real-world street furniture (mailbox, hydrant, stopsign, trashcan, bicycle,
// gnome, cone, newsbox) is toned toward natural, plausible hues now that real
// shadows/textures/lighting are in play — the old neon-toy palette clashed
// with the grounded look. The intentionally-playful cast (duck, dino, poop,
// pinata, undies, toilet) stays vivid since those ARE meant to look like toys.
export const OBSTACLE_COLORS: Record<string, string> = {
  mailbox: "#1f5fa8", hydrant: "#c8331f", stopsign: "#b3122a", trashcan: "#71757c",
  dog: "#c77b4a", cat: "#9a958f", bicycle: "#7d818a", gnome: "#2f8f4e",
  cone: "#e8720c", newsbox: "#2f4fa0", barrier: "#e0299a",
  // New obstacle types
  pumpkin: "#e06010", cactus: "#3c7a3f", flamingo: "#f2799e", cart: "#a7abb5",
  // Silly kid obstacles
  poop: "#8a5a2b", toilet: "#f0f0f5", duck: "#ffd23f", dino: "#34b23e",
  pinata: "#ef3d97", undies: "#f7f7ff",
};

export const OBSTACLE_KIND: Record<string, ObstacleRenderKind> = {
  mailbox: "box", hydrant: "cylinder", stopsign: "sign", trashcan: "cylinder",
  dog: "animal", cat: "animal", bicycle: "bicycle", gnome: "cone", cone: "cone", newsbox: "box",
  barrier: "barrier",
  // New obstacle types
  pumpkin: "cylinder", cactus: "cone", flamingo: "animal", cart: "bicycle",
  // Silly kid obstacles
  poop: "poop", toilet: "toilet", duck: "duck", dino: "dino",
  pinata: "pinata", undies: "undies",
};

export const OBSTACLE_GLOW: Record<string, boolean> = {
  mailbox: true, hydrant: true, stopsign: true, trashcan: true,
  cone: true, gnome: true, newsbox: true, bicycle: true, barrier: true,
  dog: false, cat: false,
  pumpkin: false, cactus: false, flamingo: false, cart: true,
  poop: false, toilet: false, duck: false, dino: false, pinata: true, undies: false,
};
export const OBSTACLE_METAL: Record<string, boolean> = {
  mailbox: true, trashcan: true, bicycle: true, barrier: true,
  hydrant: false, stopsign: false, cone: false, gnome: false, newsbox: false,
  dog: false, cat: false,
  pumpkin: false, cactus: false, flamingo: false, cart: true,
  poop: false, toilet: false, duck: false, dino: false, pinata: false, undies: false,
};

// Wobble personality per obstacle type: [speed, amplitude, axis]
// axis: 0=tilt (z-rotation), 1=sway (y-rotation), 2=bob (y-position)
export const OBSTACLE_WOBBLE: Record<string, [number, number, number]> = {
  cat:      [0.14, 0.08, 1], dog:     [0.12, 0.07, 1],
  cone:     [0.18, 0.10, 0], gnome:   [0.10, 0.12, 0],
  hydrant:  [0.06, 0.04, 2], trashcan:[0.08, 0.05, 2],
  mailbox:  [0.05, 0.03, 0], newsbox: [0.07, 0.04, 0],
  bicycle:  [0.09, 0.06, 1], stopsign:[0.06, 0.06, 0],
  barrier:  [0.04, 0.02, 0],
  pumpkin:  [0.10, 0.06, 2], cactus:  [0.08, 0.09, 0],
  flamingo: [0.16, 0.12, 1], cart:    [0.11, 0.07, 1],
  // Silly kid obstacles — big comedy wobbles
  poop:     [0.12, 0.07, 2], toilet:  [0.05, 0.03, 0],
  duck:     [0.16, 0.11, 2], dino:    [0.13, 0.09, 1],
  pinata:   [0.15, 0.12, 0], undies:  [0.11, 0.08, 1],
};

// ── Runner hat colors ──────────────────────────────────────────────────
export type HatId = "none" | "tophat" | "cap" | "crown" | "cowboy" | "viking" | "beanie" | "party" | "wizard" | "propeller" | "halo";

export const HAT_COLORS: Record<HatId, string> = {
  none: "#000000", tophat: "#111111", cap: "#2255cc", crown: "#ffd700", cowboy: "#a0662a",
  viking: "#9aa0a8", beanie: "#cc5577", party: "#ff44aa", wizard: "#6633aa", propeller: "#dd3333", halo: "#ffee88",
};

// ── Playable characters ────────────────────────────────────────────────
export type CharacterId = "apollo" | "rocco" | "santi";

export interface CharacterDef {
  id: CharacterId;
  name: string;
  ageLabel: string;
  emoji: string;
  backHand: string;
  finger: string;
  knuckle: string;
  nail: string;
  saberColor: string;
  saberGlow: string;
  /** Kylo-style crossguard saber: side vent blades + unstable flicker. */
  crossguard?: boolean;
  tagline: string;
  voice: "cheer" | "giggle" | "bark";
}

export const CHARACTERS: CharacterDef[] = [
  { id: "apollo", name: "Apollo", ageLabel: "5 yrs", emoji: "🧢",
    backHand: "#dfae8a", finger: "#e8b892", knuckle: "#e0ac86", nail: "#f7ddc4",
    saberColor: "#ff2b2b", saberGlow: "#ff6b6b", crossguard: true,
    tagline: "Catch me if you can!", voice: "cheer" },
  { id: "rocco", name: "Rocco", ageLabel: "2 yrs", emoji: "🧒",
    backHand: "#c98f63", finger: "#d89b6f", knuckle: "#c1885c", nail: "#f0d3ad",
    saberColor: "#34ff5e", saberGlow: "#86ff9e",
    tagline: "ZOOM ZOOM ZOOM!!!", voice: "giggle" },
  { id: "santi", name: "Santi", ageLabel: "Good Boy dog", emoji: "🐶",
    backHand: "#b3743f", finger: "#c2824a", knuckle: "#a76a38", nail: "#e6c193",
    saberColor: "#ff8c00", saberGlow: "#ffbb33",
    tagline: "Treats ahead! Sniff sniff!", voice: "bark" },
];

export const DEFAULT_CHARACTER: CharacterId = "apollo";

export function getCharacterDef(id: string): CharacterDef {
  for (let i = 0; i < CHARACTERS.length; i++) if (CHARACTERS[i].id === id) return CHARACTERS[i];
  return CHARACTERS[0];
}

// ── Fart Boost ─────────────────────────────────────────────────────────
export const BOOST_FRAMES = 150;
export const BOOST_MULT = 1.8;
export const BOOST_COOLDOWN = 300;
export const BOOST_GAS_COLORS = ["#3dff5e", "#7CFC00", "#a8ff8a"];

// ── Power-up colors ────────────────────────────────────────────────────
export const POWERUP_COLORS: Record<string, string> = {
  magnet: "#ff44ff", shield: "#44ddff", multiplier: "#ffee00",
};

// ── Bloom tuning ───────────────────────────────────────────────────────
export interface BloomThemeConfig { intensity: number; threshold: number; smoothing: number; }

export const BLOOM_CONFIG: Record<Theme3D, BloomThemeConfig> = {
  suburb:   { intensity: 0.45, threshold: 0.68, smoothing: 0.20 },
  city:     { intensity: 0.70, threshold: 0.55, smoothing: 0.28 },
  highway:  { intensity: 0.50, threshold: 0.65, smoothing: 0.20 },
  mountain: { intensity: 0.60, threshold: 0.62, smoothing: 0.24 },
  night:    { intensity: 1.10, threshold: 0.42, smoothing: 0.34 },
  moon:     { intensity: 0.85, threshold: 0.50, smoothing: 0.30 },
};

export const BLOOM_LAYER = 1;
