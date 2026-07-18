// ── Shared coordinate mapping between the original 2D screen-space game
// state and the new 3D world ─────────────────────────────────────────────
// The physics/game-state loop (Game.tsx) still runs entirely in the old
// screen-space units (x = scroll position, y = absolute screen height).
// These helpers translate that flat state into a 3D world so the render
// layer (Scene3D) can place objects with real depth without touching any
// gameplay logic.
//
// All of the actual *values* (coordinate constants, pool sizes, theme
// palettes, obstacle/hat/powerup colors) live in the shared
// @workspace/finger-runner-3d-shared package so the mobile WebView render
// layer (artifacts/finger-runner-mobile/constants/gameHtml.ts) can consume
// the exact same data at build time instead of a hand-copied duplicate.
// This module just re-exports them plus the web-only React state typings.
export {
  FINGER_CENTER_X, DEPTH_SCALE, HEIGHT_SCALE, LANE_X, LANE_OFFSET,
  ROAD_SURFACE_OFFSET, FINGER_TIP_OFFSET, HIDE_Z,
  SLIDE_FRAMES, SLIDE_DUCK, BARRIER_GAP,
  worldZ, worldY, roadYOld,
  POOL_OBSTACLES, POOL_COINS, POOL_PARTICLES, POOL_POWERUPS,
  POOL_PLATFORMS, POOL_ROPES, POOL_PUDDLES,
  THEME_COLORS, OBSTACLE_COLORS, OBSTACLE_KIND, HAT_COLORS, POWERUP_COLORS,
  CHROME_ACCENT, OBSTACLE_GLOW, OBSTACLE_METAL, OBSTACLE_WOBBLE,
  BLOOM_CONFIG, BLOOM_LAYER,
  CHARACTERS, DEFAULT_CHARACTER, getCharacterDef,
  BOOST_FRAMES, BOOST_MULT, BOOST_COOLDOWN, BOOST_GAS_COLORS,
  type Theme3D, type ThemePalette, type ObstacleRenderKind, type HatId, type BloomThemeConfig,
  type CharacterId, type CharacterDef,
} from "@workspace/finger-runner-3d-shared";

// ── Structural mirror of Game.tsx's runtime state, kept loose (string
// instead of literal unions) so the real stateRef object is always
// assignable into it without any coupling/export churn in Game.tsx ──────
export interface Obstacle3D { x: number; obsWidth: number; obsHeight: number; type: string; passed: boolean; lane: number; }
export interface Particle3D { x: number; y: number; vx: number; vy: number; life: number; size: number; color: string; shape?: string; rot?: number; rotV?: number; }
export interface BloodPuddle3D { x: number; y: number; rx: number; ry: number; life: number; maxLife: number; }
export interface Coin3D { x: number; y: number; phase: number; }
export interface PowerUp3D { x: number; y: number; type: string; phase: number; }
export interface Platform3D { x: number; y: number; w: number; }
export interface RopeScroll3D { x: number; anchorY: number; length: number; }
export interface ActiveSwing3D { anchorX: number; anchorY: number; length: number; angle: number; angVel: number; swingFrames: number; }

export interface GameSceneState {
  gameRunning: boolean;
  currentLevel: number;
  playerY: number;
  velocity: number;
  onGround: boolean;
  lane: number;
  laneVisual: number;
  laneVel: number;
  lastObstacleLane: number;
  time: number;
  shake: number;
  landImpact: number;
  sliding: boolean;
  slideTimer: number;
  crashFlash: number;
  saberSwing: number;
  saberCooldown: number;
  worldScroll: number;
  curSpeed: number;
  boostTimer: number;
  obstacles: Obstacle3D[];
  particles: Particle3D[];
  bloodPuddles: BloodPuddle3D[];
  coins: Coin3D[];
  powerUps: PowerUp3D[];
  platforms: Platform3D[];
  ropes: RopeScroll3D[];
  activeSwing: ActiveSwing3D | null;
}
