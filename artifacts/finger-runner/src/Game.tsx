import { useEffect, useRef, useState, lazy, Suspense, type PointerEvent as ReactPointerEvent } from "react";
import './arcade.css';
import {
  getSaveValue, setSaveValue,
  incrementStat, recordLevelScore,
  checkAchievements, getUnlockedCount, getTotalCount,
  isSaberOwned, buySaber, equipSaber, getNextUnlockableSaber,
  getEquippedSaber, getSaberByTier,
  isEndlessUnlocked,
  getEndlessHighScore, getEndlessBestDistance,
  isMusicEnabled, toggleMusic,
  VEHICLES, isVehicleUnlocked,
  type VehicleDef, type VehicleId,
} from "./game";
import Scene3DBoundary from "./three/Scene3DBoundary";
import type { GameSceneState, Theme3D } from "./three/coords";
import {
  POOL_OBSTACLES, POOL_COINS, POOL_PARTICLES, POOL_POWERUPS,
  POOL_PLATFORMS, POOL_ROPES, POOL_PUDDLES,
  SLIDE_FRAMES, SLIDE_DUCK, BARRIER_GAP,
  getCharacterDef, BOOST_FRAMES, BOOST_MULT, BOOST_COOLDOWN, BOOST_GAS_COLORS,
  LANE_HIT_RADIUS, STEER_CLAMP,
} from "./three/coords";

// Lazily loaded: these pull in the Three.js/R3F render stack and the
// wardrobe UI, which aren't needed to paint the very first frame. Splitting
// them into their own chunks shrinks the critical-path bundle so the
// menu/HUD shows sooner, especially on slower connections.
const Scene3D = lazy(() => import("./three/Scene3D"));
const WardrobeScreen = lazy(() => import("./components/WardrobeScreen"));
const CharacterSelectScreen = lazy(() => import("./components/CharacterSelectScreen"));

// ── Types ─────────────────────────────────────────────────────────────────────
type ObstacleType = "ramp"|"mailbox"|"hydrant"|"stopsign"|"trashcan"|"dog"|"cat"|"bicycle"|"gnome"|"cone"|"newsbox"|"barrier"|"pumpkin"|"cactus"|"flamingo"|"cart"
  |"poop"|"toilet"|"duck"|"dino"|"pinata"|"undies";
type Theme = "italy"|"suburb"|"city"|"highway"|"mountain"|"night"|"moon";

interface Obstacle { x: number; obsWidth: number; obsHeight: number; type: ObstacleType; passed: boolean; lane: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number; color: string; shape?: "rect"|"circle"|"bone"|"gas"; rot?: number; rotV?: number; }
interface BloodPuddle { x: number; y: number; rx: number; ry: number; life: number; maxLife: number; }
interface Coin { x: number; y: number; phase: number; }
type PowerUpType = "magnet"|"shield"|"multiplier";
interface PowerUp { x: number; y: number; type: PowerUpType; phase: number; }
interface Platform { x: number; y: number; w: number; }
interface RopeScroll { x: number; anchorY: number; length: number; }
interface ActiveSwing { anchorX: number; anchorY: number; length: number; angle: number; angVel: number; swingFrames: number; }

// Pushes into a pooled entity array only while under its 3D render pool
// cap (see three/coords.ts POOL_* constants). Without this, a level or
// Endless-mode ramp that spams spawns faster than entities are recycled
// could grow a state array past its render pool size — the extra entities
// would still be fully live for collision/scoring but never drawn.
function pushCapped<T>(arr: T[], cap: number, item: T) {
  if (arr.length < cap) arr.push(item);
}

// ── Constants ─────────────────────────────────────────────────────────────────
const GRAVITY = 0.72;
const JUMP_FORCE = -18.5;
const LOW_JUMP_GRAVITY_MULT = 2.6;   // extra gravity when jump released early → variable jump height
const MAX_FALL = 24;
const COYOTE_FRAMES = 7;             // grace frames to still jump after leaving the ground
const JUMP_BUFFER_FRAMES = 8;        // remember a jump pressed just before landing
const BASE_SPEED = 2.0;
const SCORE_RAMP_CAP = 1.8;     // caps only the within-level score ramp — level base speeds stay intact
const SIM_STEP_MS = 1000 / 60;  // fixed-timestep: sim always runs at 60 steps/sec on any display Hz
const FINGER_TIP_OFFSET = 90;
const ROAD_SURFACE_OFFSET = 108;
const COIN_R = 13;
const OBSTACLE_CENTER_FACTOR = 0.5;
const OBSTACLE_PASS_PROGRESS = 0.55;
const OBSTACLE_HIT_HEIGHT_FACTOR = 0.88;
const SABER_SWING_FRAMES = 16;  // active frames of a saber swing (can slice during these)
const SLASH_COOLDOWN = 24;      // frames before the next swing is allowed
const KIDS_SPEED_MULT = 0.62;   // easy mode: gentler scroll speed
const KIDS_SPAWN_MULT = 1.5;    // easy mode: more breathing room between obstacles
const SWIPE_THRESHOLD = 18;     // px a touch must travel to commit a swipe gesture (lowered for better mobile feel)
const NEAR_MISS_X_THRESHOLD = 46;
const NEAR_MISS_MIN_CLEARANCE = 2;
const NEAR_MISS_MAX_CLEARANCE = 28;
const NEAR_MISS_CHAIN_WINDOW = 160;
const NEAR_MISS_MAX_CHAIN = 5;
const NEAR_MISS_BASE_BONUS = 4;
const NEAR_MISS_CHAIN_BONUS = 2;
const NEAR_MISS_DIALOG_CHANCE = 0.4;
const NEAR_MISS_DIALOG_FRAMES = 55;
const NEAR_MISS_ADJACENT_LANE = 1;

// ── Normal-mode steering (Mario-Kart style) ─────────────────────────────
// Kids mode keeps the original 3-lane snap (see moveLane). Normal mode
// replaces it with continuous hold-to-steer: accelerate sideways while a
// direction is held, coast to a stop on release — no snapping to lanes,
// so the rider can sit anywhere across the road.
const STEER_ACCEL = 0.007;      // lateral accel per frame while held
const STEER_FRICTION = 0.90;    // per-frame velocity decay (both held and released)
const STEER_MAX_VEL = 0.07;     // hard velocity cap

function getGroundY(h: number) { return h - ROAD_SURFACE_OFFSET - FINGER_TIP_OFFSET - 8; }

// ── Level definitions ─────────────────────────────────────────────────────────
// Obstacle dimensions, grouped by jump difficulty (height = how much air you need).
//   low:  cat 42, dog 46, cone 56            — easy hops
//   mid:  hydrant 58, newsbox 60, gnome 62, trashcan 66
//   tall: mailbox 68, bicycle 68, stopsign 88 — need a committed hold-jump
// A full hold-jump clears ~228px, so even the stopsign stays fair.
const OBSTACLE_DIMS: Record<ObstacleType, { w: number; h: number }> = {
  ramp:     { w:52, h:28 },   // jump ramp — NOT a hazard: ride into it for big air
  poop:     { w:40, h:40 },   // giant cartoon poop swirl — easiest hop
  cat:      { w:28, h:42 },
  undies:   { w:48, h:44 },   // giant lost underpants
  dog:      { w:44, h:46 },
  pumpkin:  { w:44, h:44 },   // stumpy round jack-o-lantern
  duck:     { w:46, h:52 },   // giant rubber ducky
  pinata:   { w:40, h:54 },   // party piñata — slash it for bonus coins!
  cone:     { w:32, h:56 },
  hydrant:  { w:34, h:58 },
  dino:     { w:42, h:58 },   // toy T-rex on the loose
  cart:     { w:48, h:56 },   // shopping cart
  newsbox:  { w:36, h:60 },
  gnome:    { w:30, h:62 },
  toilet:   { w:44, h:64 },   // runaway toilet, lid flapping
  flamingo: { w:28, h:64 },   // yard flamingo, tall and slender
  trashcan: { w:36, h:66 },
  mailbox:  { w:36, h:68 },
  bicycle:  { w:46, h:68 },
  cactus:   { w:22, h:74 },   // tall skinny desert cactus
  stopsign: { w:22, h:88 },
  barrier:  { w:44, h:170 },  // overhead gantry — collision uses BARRIER_GAP, not this height
};

// Per-level obstacle pools. Repeated entries bias the random pick, so the mix
// escalates: early levels are short, friendly hops; later levels lean tall and
// dense, with the stopsign showing up more often as the finale approaches.
// `hill` = downhill grade (world tilt in the 3D scene — pure visual descent);
// "ramp" entries in obs are jump kickers: ride into one for launch-assisted air.
const LEVELS = [
  { num:1, name:"Via Italia Downhill",  target:780,  theme:"italy"    as Theme, speedMult:1.0,  minSpawn:135, ramp:6.0, hill:0.055,
    obs:["cat","dog","poop","duck","cone","ramp","pinata","poop","pumpkin","ramp","duck","cat","pinata"] as ObstacleType[] },
  { num:2, name:"Shopping District",    target:920,  theme:"suburb"   as Theme, speedMult:1.2,  minSpawn:122, ramp:6.0, hill:0.03,
    obs:["cat","dog","poop","duck","undies","hydrant","ramp","pinata","trashcan","cone","cart","ramp","pinata","barrier"] as ObstacleType[] },
  { num:3, name:"Downtown",             target:1000, theme:"city"     as Theme, speedMult:1.45, minSpawn:110, ramp:5.6, hill:0.035,
    obs:["dog","cone","poop","toilet","hydrant","newsbox","ramp","dino","undies","gnome","cart","pinata","pinata","barrier"] as ObstacleType[] },
  { num:4, name:"City Center",          target:1080, theme:"city"     as Theme, speedMult:1.75, minSpawn:100, ramp:5.2, hill:0.04,
    obs:["cone","hydrant","toilet","newsbox","dino","gnome","ramp","flamingo","cart","undies","pinata","pinata","mailbox","barrier"] as ObstacleType[] },
  { num:5, name:"Highway On-Ramp",      target:1160, theme:"highway"  as Theme, speedMult:2.1,  minSpawn:90,  ramp:4.8, hill:0.045,
    obs:["hydrant","newsbox","cactus","dino","toilet","gnome","ramp","trashcan","cart","pinata","pinata","mailbox","bicycle","barrier"] as ObstacleType[] },
  { num:6, name:"Open Highway",         target:1240, theme:"highway"  as Theme, speedMult:2.5,  minSpawn:80,  ramp:4.4, hill:0.05,
    obs:["newsbox","cactus","gnome","trashcan","mailbox","bicycle","ramp","stopsign","pinata","pinata","cactus","barrier","barrier"] as ObstacleType[] },
  { num:7, name:"Mountain Pass",        target:1400, theme:"mountain" as Theme, speedMult:3.0,  minSpawn:70,  ramp:4.0, hill:0.065,
    obs:["cactus","gnome","trashcan","mailbox","bicycle","ramp","stopsign","stopsign","pinata","ramp","pinata","barrier","barrier"] as ObstacleType[] },
  { num:8, name:"Night Drive",          target:1560, theme:"night"    as Theme, speedMult:3.6,  minSpawn:62,  ramp:3.6, hill:0.045,
    obs:["trashcan","mailbox","bicycle","stopsign","bicycle","ramp","stopsign","stopsign","pinata","pinata","barrier","barrier"] as ObstacleType[] },
  // Finale: lunar gravity — jumps launch high and hang forever, so the level
  // runs fast and long to compensate. gravityMult scales the whole jump arc.
  { num:9, name:"Sea of Tranquility",   target:1700, theme:"moon"     as Theme, speedMult:3.2,  minSpawn:70,  ramp:3.6, gravityMult:0.38, hill:0.02,
    obs:["trashcan","mailbox","dino","duck","stopsign","bicycle","ramp","toilet","pinata","pinata","barrier","barrier"] as ObstacleType[] },
];
function getLevelDef(num: number) { return LEVELS[Math.min(num - 1, LEVELS.length - 1)]; }

// ── Background music tracks ──────────────────────────────────────────────────
// Requested primary track URL (Suno share link). We keep per-theme local fallbacks
// so music still plays if the remote source is unavailable on a given device/network.
const REQUESTED_TRACK_URL = "https://suno.com/s/ZmKeIZXIQQf2abGa";
type MusicThemeId = Theme | "start";
interface MusicTheme {
  source: string;
  fallbackFile: string;
  leadGain: number; // per-theme loudness character
}
const MUSIC_THEMES: Record<MusicThemeId, MusicTheme> = {
  start:    { source: REQUESTED_TRACK_URL, fallbackFile: "title-theme.mp3",   leadGain: 0.85 },
  italy:    { source: REQUESTED_TRACK_URL, fallbackFile: "level-theme-1.mp3", leadGain: 1.0  },
  suburb:   { source: REQUESTED_TRACK_URL, fallbackFile: "level-theme-1.mp3", leadGain: 1.0  },
  city:     { source: REQUESTED_TRACK_URL, fallbackFile: "level-theme-2.mp3", leadGain: 1.0  },
  highway:  { source: REQUESTED_TRACK_URL, fallbackFile: "level-theme-3.mp3", leadGain: 1.05 },
  mountain: { source: REQUESTED_TRACK_URL, fallbackFile: "level-theme-1.mp3", leadGain: 1.1  },
  night:    { source: REQUESTED_TRACK_URL, fallbackFile: "level-theme-2.mp3", leadGain: 1.1  },
  moon:     { source: REQUESTED_TRACK_URL, fallbackFile: "level-theme-3.mp3", leadGain: 1.15 },
};

// ── Lightsaber tiers ──────────────────────────────────────────────────────────
// The fingers wield a saber to slice obstacles mid-run. Tier 1 (red) is always
// owned; higher tiers cost coins, glow a new colour, and reach a little further.
// Single source of truth: SABER_CATALOG in game/saberCatalog.ts — buying or
// equipping in the garage takes effect here immediately (reach, colours, glow).
const getSaberDef = getSaberByTier;
// ── Legacy persistence wrappers → new save system ───────────────────────────────────────────────────────
function getSaberLevel(): number { return getEquippedSaber().tier; }
function getSelectedCharacter(): string { return getSaveValue("selectedCharacter"); }
function setSelectedCharacterLS(id: string) { setSaveValue("selectedCharacter", id); }
function getKidsMode(): boolean { return getSaveValue("kidsMode"); }
function setKidsModeLS(on: boolean) { setSaveValue("kidsMode", on); }
function getVehicleColor(): string { return getSaveValue("vehicleColor"); }
function setVehicleColorLS(c: string) { setSaveValue("vehicleColor", c); }

// ── Storyline & dialog ────────────────────────────────────────────────────────
const STORY_INTRO =
  "Two butt-shaped scooter legends — Lefty Cheek & Middy Buns — are blasting down the world's most ridiculous road on their trusty boosted scooters. Eight wild stretches of pavement, countless ridiculous obstacles, and one legendary destination: freedom (and snacks).";

const LEVEL_STORY: Record<number, string> = {
  1: "Day one of freedom — a sunny Italian street, all downhill from here!",
  2: "So many shoppers, so many feet to dodge…",
  3: "Downtown! Keep it together, knuckles.",
  4: "Rush hour. Everyone's in a hurry but us!",
  5: "Merging onto the highway — hold onto your nails!",
  6: "Pedal to the metal… er, finger to the asphalt!",
  7: "Mountain air! Don't look down, Middy.",
  8: "One last sprint under the stars. Almost home!",
  9: "THE MOON?! Low gravity, big air — stick the landing!",
};

const RUN_QUIPS = [
  "Wheee!", "Freedom tastes like asphalt!", "Can't catch us!", "Run, Middy, run!",
  "My nails look fabulous today.", "Is it leg day? It's always leg day.",
  "We were BORN to run!", "Two fingers, one dream.", "Don't look back!",
  "This is the way.", "Knuckle down!", "Living on the edge!", "So bouncy!",
];
// ── Per-character personality voice lines ──────────────────────────────────
const CHAR_LINES: Record<string, { jump: string[]; slash: string[]; idle: string[]; win: string[]; dead: string[]; start: string[] }> = {
  apollo: {
    jump:  ["Up up up!", "I got AIR!", "Watch me fly!", "TO THE SKY!", "Parkour!", "This is my moment!"],
    slash: ["Hiya!", "Take THAT!", "Pow!", "Vzzzt!", "Back off!", "Too easy.", "Nailed it!"],
    idle:  ["Catch me if you can!", "I'm not even sweating.", "Don't look back!", "FASTER!", "Apollo doesn't stop!", "This is my track!"],
    win:   ["YEAH! Apollo wins!", "Let's GO next level!", "I did it!", "Too easy.", "BOOM!", "Champion Apollo!"],
    dead:  ["Oof... tell Rocco I tripped.", "I'll do better!", "That was so unfair!", "Ouch!!! Replay!", "This isn't over.", "One more try!"],
    start: ["Let's RUN!", "Apollo's ready!", "Watch this!", "Here we go!", "Full speed ahead!"],
  },
  rocco: {
    jump:  ["Me fly!", "Weeee!", "Up up!", "Me jump good!", "ZOOM!", "Weeee bro!"],
    slash: ["Pew pew!", "Zappie!", "Me got it!", "Hehe gotcha!", "Bam bam!", "ZAPPIE ZAPPIE!"],
    idle:  ["Me go fast!", "Where cookie?!", "Vroom vroom!", "ZOOOOOM!", "Rocco no stop!", "Me not tired yet!"],
    win:   ["ME WIN!!!", "Yay yay yay!", "Cookie please!", "Rocco BEST!", "Hehehe!", "Me did it!!!"],
    dead:  ["Uh oh!", "Me fell down...", "Oopsie!", "Nooo not fair!", "Me try again!", "Boo boo!!!"],
    start: ["Me go ZOOM!", "Rocco ready!", "Weeee!", "GO GO GO!", "Vroom vroom!"],
  },
  santi: {
    jump:  ["Woof!", "Arf arf!", "Bork bork!", "Yip yip!", "Bark bark!", "BORK!"],
    slash: ["Grr got it!", "Ruff ruff!", "Fetch THAT!", "Santi smash!", "Bite! Bite!", "Woof Woof!"],
    idle:  ["Sniff sniff...", "Where treats?!", "Good boy running!", "Ball? Ball?!", "Nose knows!", "Wanna play?!"],
    win:   ["BARK BARK BARK!", "Good boy Santi!", "Treat please!", "Woof won!", "Best boy!", "Who's good?! ME!"],
    dead:  ["Yip!", "Ow ow ow!", "Santi sad...", "No like crash!", "Bad thing bad!", "Whimper..."],
    start: ["WOOF! Let's go!", "Santi ready!", "Sniff the path!", "BORK!", "Good boy running!"],
  },
  goat: {
    jump:  ["BAAAH-borne!", "Goat air!", "Gravity is a suggestion!", "Yeet!", "BLEAT MODE!", "Sky goat!"],
    slash: ["Headbutt!", "BAAH-M!", "Ram it!", "Horns out!", "Get wrecked!", "Goated."],
    idle:  ["Baaah.", "Must... lick... everything.", "Chaos time!", "I ate the map.", "MEHEHEHE!", "No brakes. Never had 'em."],
    win:   ["G.O.A.T!", "BAAAAAH YEAH!", "Greatest Of All Time!", "Bow to the goat!", "Mehehe!", "Untoppable!"],
    dead:  ["Baaad landing...", "I meant to do that.", "Physics betrayed me!", "MEH!!", "Respawn the goat!", "Rude."],
    start: ["RELEASE THE GOAT!", "Baaah, let's go!", "Hooves up!", "Chaos incoming!", "MEHEHE!"],
  },
  pig: {
    jump:  ["Pigs CAN fly!", "Wheee-oink!", "Ham-time!", "Boing oink!", "Airborne bacon!", "Squeee!"],
    slash: ["Oink-slash!", "Chop chop!", "Squeal!", "Take that!", "Ham slam!", "Porkchop POW!"],
    idle:  ["Oink oink zoom!", "Smells like victory!", "Mud later, speed now!", "Squee-heehee!", "Little pig, BIG speed!", "Truffle shuffle!"],
    win:   ["OINK YEAH!", "Hog the podium!", "Bacon home the win!", "Squeeee!", "Piggy power!", "Hamtastic!"],
    dead:  ["Oink... ouch.", "Hogwash!", "I'm bacon over here...", "Squeal!!", "Mud break...", "Try again-k oink!"],
    start: ["Oink! GO!", "Porkchop's ready!", "Hot ham comin' through!", "Squee-GO!", "To the trough!"],
  },
  cow: {
    jump:  ["Over the MOON!", "Moo-nar launch!", "Cow-abunga!", "MOOO up high!", "Udder liftoff!", "Holy cow!"],
    slash: ["Moo-shu THAT!", "Beef it!", "Horn warning!", "MOO-POW!", "Sliced dice!", "Well done!"],
    idle:  ["Moooove it!", "No cow-ards here!", "Milkin' this run!", "MOOO!", "Grass later. Glory now.", "Legen-dairy!"],
    win:   ["LEGEN-DAIRY!", "MOO-VELOUS!", "Grade A win!", "Cream of the crop!", "MOOOO YEAH!", "Sir Loin delivers!"],
    dead:  ["Moo-stake was made...", "I'm ground beef...", "MOO!!", "That's bull!", "Milked it too hard...", "Re-moo-match!"],
    start: ["MOOOVE OUT!", "Sir Loin, charging!", "Hooves of fury!", "Got milk? Got SPEED!", "MOO-mentum!"],
  },
};
function charLineFor(event: keyof typeof CHAR_LINES["apollo"]): string[] {
  const id = getSelectedCharacter();
  return CHAR_LINES[id]?.[event] || CHAR_LINES.apollo[event];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function getMaxLevel(): number { return getSaveValue("maxLevel"); }
function setMaxLevel(n: number) { setSaveValue("maxLevel", n); }
function getEquippedVehicle(): VehicleId { return getSaveValue("equippedVehicle") as VehicleId; }
function setEquippedVehicle(id: VehicleId) { setSaveValue("equippedVehicle", id); }
function getOwnedVehicles(): VehicleId[] { return getSaveValue("ownedVehicles") as VehicleId[]; }
function setOwnedVehicles(ids: VehicleId[]) { setSaveValue("ownedVehicles", ids); }
function getCoins(): number { return getSaveValue("totalCoins"); }
function setCoinsLS(n: number) { setSaveValue("totalCoins", Math.max(0, Math.floor(n))); }

// ── Per-level best scores ──────────────────────────────────────────────────────
function getLevelBest(levelNum: number): number {
  return getSaveValue("stats").bestLevelScores[levelNum] || 0;
}
function saveLevelBest(levelNum: number, score: number) {
  recordLevelScore(levelNum, score);
}
// Returns null (no attempt), "bronze", "silver", or "gold"
// Bronze: best >= 33% of target  Silver: best >= 67%  Gold: completed (best >= 100%)
type Medal = "bronze" | "silver" | "gold";
function getMedal(levelNum: number): Medal | null {
  const best = getLevelBest(levelNum);
  if (best === 0) return null;
  const target = getLevelDef(levelNum).target;
  if (best >= target) return "gold";
  if (best >= target * 0.67) return "silver";
  if (best >= target * 0.33) return "bronze";
  return null;
}
const MEDAL_EMOJI: Record<Medal, string> = { bronze: "🥉", silver: "🥈", gold: "🥇" };
const MEDAL_COLOR: Record<Medal, string> = { bronze: "#cd7f32", silver: "#c0c0c0", gold: "#ffd700" };

// ── Component ─────────────────────────────────────────────────────────────────
export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const charImgsRef = useRef<Record<string, HTMLImageElement>>({});
  const touchRef = useRef({ active: false, startX: 0, startY: 0, consumed: false });
  const stateRef = useRef({
    gameRunning: false,
    levelComplete: false,
    currentLevel: 1,
    levelScore: 0,
    totalScore: 0,
    bestScore: getSaveValue("bestScore"),
    time: 0,
    velocity: 0,
    playerY: 300,
    spawnTimer: 0,
    onGround: true,
    lane: 0,
    laneVisual: 0,
    laneVel: 0,
    steerX: 0,
    steerVel: 0,
    steerLeftHeld: false,
    steerRightHeld: false,
    lastObstacleLane: 0,
    jumpsUsed: 0,
    jumpHeld: false,
    coyoteTimer: 0,
    jumpBuffer: 0,
    landImpact: 0,
    sliding: false,
    slideTimer: 0,
    slideQueued: false,
    shake: 0,
    obstacles: [] as Obstacle[],
    particles: [] as Particle[],
    bloodPuddles: [] as BloodPuddle[],
    coins: [] as Coin[],
    coinSpawnTimer: 0,
    coinBalance: getCoins(),
    powerUps: [] as PowerUp[],
    powerUpSpawnTimer: 0,
    magnetTimer: 0,
    multiplierTimer: 0,
    shieldCharges: 0,
    comboCount: 0,
    comboTimer: 0,
    nearMissChain: 0,
    nearMissTimer: 0,
    comboPopup: null as { text: string; life: number; maxLife: number; color: string } | null,
    crashFlash: 0,
    dialog: null as { text: string; life: number; maxLife: number } | null,
    dialogCooldown: 200,
    platforms: [] as Platform[],
    platformTimer: 0,
    ropes: [] as RopeScroll[],
    ropeTimer: 0,
    activeSwing: null as ActiveSwing | null,
    saberSwing: 0,
    saberCooldown: 0,
    kidsMode: getKidsMode(),
    worldScroll: 0,
    boostTimer: 0,
    boostCooldown: 0,
    lastRunBonus: 0,
    paused: false,
    curSpeed: BASE_SPEED,
    // Timing telegraph for the next same-lane hazard: what to do, and how many
    // sim-frames until it reaches the rider (drives the shrinking timing ring).
    actionPrompt: null as { type: "JUMP" | "DUCK" | "SLASH"; frames: number } | null,
  });
  const sizeRef = useRef({ width: typeof window !== "undefined" ? window.innerWidth : 1280, height: typeof window !== "undefined" ? window.innerHeight : 720 });
  const dialogElRef = useRef<HTMLDivElement>(null);
  const boostFillElRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<{
    ctx: AudioContext | null; enabled: boolean;
    currentThemeId: MusicThemeId | null; transitionSeq: number;
  }>({ ctx:null, enabled:isMusicEnabled(), currentThemeId:null, transitionSeq:0 });
  // Primary game track audio element + fallback state.
  const musicElRef = useRef<HTMLAudioElement | null>(null);
  const musicFallbackSourceRef = useRef<string>("");
  const musicUsingFallbackRef = useRef(false);
  const rafRef = useRef<number>(0);

  type Screen = "start"|"playing"|"levelComplete"|"dead"|"wardrobe"|"character";
  const [screen, setScreen] = useState<Screen>("start");
  const [paused, setPaused] = useState(false);
  const [musicOn, setMusicOn] = useState(isMusicEnabled());
  const [currentLevel, setCurrentLevel] = useState(1);
  const [maxLevel, setMaxLevelState] = useState(getMaxLevel());
  const [equippedVehicle, setEquippedVehicleState] = useState<VehicleId>(getEquippedVehicle());
  const [selectedCharacter, setSelectedCharacterState] = useState<string>(getSelectedCharacter());
  const [vehicleColor, setVehicleColorState] = useState<string>(getVehicleColor());
  const [boostActive, setBoostActive] = useState(false);
  const [boostReady, setBoostReady] = useState(true);
  const boostActiveRef = useRef(false);
  const boostReadyRef = useRef(true);
  const [coinBalance, setCoinBalanceState] = useState(getCoins());
  const [ownedVehicles, setOwnedVehiclesState] = useState<VehicleId[]>(getOwnedVehicles());
  const [completedLevel, setCompletedLevel] = useState(0);
  const [unlockedVehicle, setUnlockedVehicle] = useState<VehicleDef | null>(null);
  const [levelBests, setLevelBests] = useState<number[]>(() => LEVELS.map(lv => getLevelBest(lv.num)));
  const [completedLevelPrevBest, setCompletedLevelPrevBest] = useState(0);
  const [completedLevelMedal, setCompletedLevelMedal] = useState<Medal | null>(null);
  const [saberLevel, setSaberLevelState] = useState(getSaberLevel());
  const [kidsMode, setKidsModeState] = useState(getKidsMode());

  // ── Character sprite preload — base + jump + slash frames ─────────────────
  useEffect(() => {
    const chars = ["apollo", "rocco", "santi"];
    const suffixes = ["", "_jump", "_slash"];
    chars.forEach(id => {
      suffixes.forEach(suf => {
        const img = new Image();
        // Base-relative so sprites resolve under the app's mount path (e.g.
        // /scooter/chars/… inside the beckify hub, /chars/… at the root).
        img.src = `${import.meta.env.BASE_URL}chars/${id}${suf}.png`;
        charImgsRef.current[id + suf] = img;
      });
    });
  }, []);

  // ── Audio ──────────────────────────────────────────────────────────────────
  const initAudio = () => {
    const a = audioRef.current;
    if (!a.ctx) a.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  };
  const stopMusic = () => {
    const a = audioRef.current;
    a.transitionSeq++;
    const el = musicElRef.current;
    if (el) el.pause();
  };
  // Plays the requested track source with per-theme fallback to bundled local
  // audio files. `isPlaying` selects in-run vs menu intensity, while `speedMult`
  // and `leadGain` keep later levels feeling more energetic.
  const startMusic = (themeId: MusicThemeId, isPlaying: boolean, speedMult: number = 1) => {
    const a = audioRef.current;
    if (!a.enabled) return;
    initAudio();
    const prevThemeId = a.currentThemeId;
    a.currentThemeId = themeId;
    const theme = MUSIC_THEMES[themeId];
    const prevSource = prevThemeId ? MUSIC_THEMES[prevThemeId].source : null;
    const source = theme.source;
    const fallbackSource = `${import.meta.env.BASE_URL}audio/${theme.fallbackFile}`;
    let el = musicElRef.current;
    if (!el) {
      el = new Audio();
      el.loop = true;
      musicElRef.current = el;
      musicUsingFallbackRef.current = false;
      musicFallbackSourceRef.current = fallbackSource;
      el.onerror = () => {
        if (musicUsingFallbackRef.current) return;
        musicUsingFallbackRef.current = true;
        el!.src = musicFallbackSourceRef.current || fallbackSource;
        void el!.play().catch(() => {});
      };
    }
    musicFallbackSourceRef.current = fallbackSource;
    if (prevSource !== source) {
      musicUsingFallbackRef.current = false;
      el.src = source;
    } else if (musicUsingFallbackRef.current && el.src !== fallbackSource) {
      el.src = fallbackSource;
    }
    const rate = Math.min(1.15, Math.max(0.95, 0.97 + (speedMult - 1) * 0.045));
    el.playbackRate = rate;
    el.volume = Math.min(1, (isPlaying ? 0.5 : 0.32) * theme.leadGain);
    if (el.paused) el.play().catch(() => {}); // browsers may block until a user gesture; retried on next interaction
  };
  const playJumpSound = () => {
    const a = audioRef.current; if (!a.enabled || !a.ctx) return;
    const ctx = a.ctx; const osc = ctx.createOscillator(); const gain = ctx.createGain(); const filter = ctx.createBiquadFilter();
    osc.type = "sawtooth"; osc.frequency.value = 680; filter.type = "lowpass"; filter.frequency.value = 1200;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(680, t); osc.frequency.linearRampToValueAtTime(420, t + 0.18);
    gain.gain.setValueAtTime(0.35, t); gain.gain.linearRampToValueAtTime(0.001, t + 0.22);
    osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination); osc.start(t); osc.stop(t + 0.25);
  };
  const playCrashSound = () => {
    const a = audioRef.current; if (!a.enabled || !a.ctx) return;
    const ctx = a.ctx; const t = ctx.currentTime;
    // Wet bone-crack: sharp noise burst
    const crackBuf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
    const crackData = crackBuf.getChannelData(0);
    for (let i = 0; i < crackData.length; i++) crackData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / crackData.length, 3);
    const crack = ctx.createBufferSource(); crack.buffer = crackBuf;
    const crackFilter = ctx.createBiquadFilter(); crackFilter.type = "highpass"; crackFilter.frequency.value = 1800;
    const crackGain = ctx.createGain(); crackGain.gain.setValueAtTime(2.2, t); crackGain.gain.linearRampToValueAtTime(0, t + 0.12);
    crack.connect(crackFilter); crackFilter.connect(crackGain); crackGain.connect(ctx.destination); crack.start(t);
    // Meaty splat: low-freq noise
    const splatBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const splatData = splatBuf.getChannelData(0);
    for (let i = 0; i < splatData.length; i++) splatData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / splatData.length, 1.5);
    const splat = ctx.createBufferSource(); splat.buffer = splatBuf;
    const splatFilter = ctx.createBiquadFilter(); splatFilter.type = "lowpass"; splatFilter.frequency.value = 600;
    const splatGain = ctx.createGain(); splatGain.gain.setValueAtTime(1.6, t + 0.04); splatGain.gain.linearRampToValueAtTime(0, t + 0.55);
    splat.connect(splatFilter); splatFilter.connect(splatGain); splatGain.connect(ctx.destination); splat.start(t + 0.04);
    // Thuddy sub-boom
    const boom = ctx.createOscillator(); const boomGain = ctx.createGain();
    boom.type = "sine"; boom.frequency.setValueAtTime(110, t); boom.frequency.linearRampToValueAtTime(30, t + 0.4);
    boomGain.gain.setValueAtTime(1.4, t); boomGain.gain.linearRampToValueAtTime(0, t + 0.9);
    boom.connect(boomGain); boomGain.connect(ctx.destination); boom.start(t); boom.stop(t + 0.95);
    // Agonised yelp: descending oscillator
    const yelp = ctx.createOscillator(); const yelpGain = ctx.createGain(); const yelpFilter = ctx.createBiquadFilter();
    yelp.type = "sawtooth"; yelpFilter.type = "lowpass"; yelpFilter.frequency.value = 900;
    yelp.frequency.setValueAtTime(520, t + 0.06); yelp.frequency.linearRampToValueAtTime(180, t + 0.45);
    yelpGain.gain.setValueAtTime(0.5, t + 0.06); yelpGain.gain.linearRampToValueAtTime(0, t + 0.5);
    yelp.connect(yelpFilter); yelpFilter.connect(yelpGain); yelpGain.connect(ctx.destination); yelp.start(t + 0.06); yelp.stop(t + 0.55);
  };
  const playLevelUpSound = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = "triangle"; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.4, t + i * 0.12); g.gain.linearRampToValueAtTime(0, t + i * 0.12 + 0.25);
      osc.connect(g); g.connect(ctx.destination); osc.start(t + i * 0.12); osc.stop(t + i * 0.12 + 0.3);
    });
  };
  const playCoinSound = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    [988, 1319].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = "square"; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.12, t + i * 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.12);
      osc.connect(g); g.connect(ctx.destination); osc.start(t + i * 0.06); osc.stop(t + i * 0.06 + 0.14);
    });
  };
  // Whoosh of the blade swinging through the air
  const playSaberSwingSound = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(); const g = ctx.createGain(); const f = ctx.createBiquadFilter();
    osc.type = "sawtooth"; f.type = "bandpass"; f.frequency.value = 850; f.Q.value = 7;
    osc.frequency.setValueAtTime(280, t); osc.frequency.linearRampToValueAtTime(760, t + 0.13);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.04); g.gain.linearRampToValueAtTime(0.001, t + 0.2);
    osc.connect(f); f.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.22);
  };
  // Electric zap when the blade connects with an obstacle
  const playSaberHitSound = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.13, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter(); filt.type = "bandpass"; filt.frequency.value = 2400; filt.Q.value = 1.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.85, t); g.gain.linearRampToValueAtTime(0, t + 0.13);
    src.connect(filt); filt.connect(g); g.connect(ctx.destination); src.start(t);
    // bright ping on top
    const ping = ctx.createOscillator(); const pg = ctx.createGain();
    ping.type = "triangle"; ping.frequency.setValueAtTime(1400, t); ping.frequency.exponentialRampToValueAtTime(700, t + 0.12);
    pg.gain.setValueAtTime(0.12, t); pg.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    ping.connect(pg); pg.connect(ctx.destination); ping.start(t); ping.stop(t + 0.16);
  };

  // ── Obstacle "defeat" voices ────────────────────────────────────────────────
  // Cat → meow: a vowel-ish bandpassed saw that rises then falls, with vibrato.
  const playMeow = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1100; f.Q.value = 5;
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.linearRampToValueAtTime(860, t + 0.12);
    osc.frequency.linearRampToValueAtTime(430, t + 0.38);
    const lfo = ctx.createOscillator(); const lfoG = ctx.createGain();
    lfo.frequency.value = 17; lfoG.gain.value = 24; lfo.connect(lfoG); lfoG.connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18, t + 0.05);
    g.gain.setValueAtTime(0.16, t + 0.28); g.gain.linearRampToValueAtTime(0.0001, t + 0.42);
    osc.connect(f); f.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.44); lfo.start(t); lfo.stop(t + 0.44);
  };
  // Dog → bark: two quick gruff "woofs", each a falling saw + noise transient.
  const playBark = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const woof = (t: number) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1500;
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(330, t);
      osc.frequency.exponentialRampToValueAtTime(135, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.28, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(f); f.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.18);
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const nf = ctx.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 900; nf.Q.value = 1;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.16, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      src.connect(nf); nf.connect(ng); ng.connect(ctx.destination); src.start(t);
    };
    const t0 = ctx.currentTime; woof(t0); woof(t0 + 0.2);
  };
  // Bicycle → bright bell ding.
  const playBell = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    [0, 1].forEach((idx) => {
      const tt = t + idx * 0.09;
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = "triangle"; osc.frequency.value = 2100;
      g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.16, tt + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.25);
      osc.connect(g); g.connect(ctx.destination); osc.start(tt); osc.stop(tt + 0.26);
    });
  };
  // Metal objects (mailbox / hydrant / newsbox) → inharmonic clang.
  const playClang = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    [320, 511, 743, 1100].forEach((fr) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = "square"; osc.frequency.value = fr;
      g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.32);
    });
  };
  // Stop sign / gnome → comedic wobbly boing.
  const playBoing = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(700, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.3);
    const lfo = ctx.createOscillator(); const lg = ctx.createGain();
    lfo.frequency.value = 14; lg.gain.value = 60; lfo.connect(lg); lg.connect(osc.frequency);
    g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.35); lfo.start(t); lfo.stop(t + 0.35);
  };
  // Cone → rubbery honk/squeak.
  const playHonk = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = "sawtooth"; osc.frequency.setValueAtTime(400, t);
    osc.frequency.linearRampToValueAtTime(620, t + 0.1);
    osc.frequency.linearRampToValueAtTime(300, t + 0.22);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.28);
  };
  // Trashcan → metallic clatter (noise burst + ringing partials).
  const playClatter = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.5);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t);
    [880, 1320].forEach((fr, i) => {
      const osc = ctx.createOscillator(); const og = ctx.createGain();
      osc.type = "square"; osc.frequency.value = fr;
      og.gain.setValueAtTime(0.06, t + i * 0.03); og.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(og); og.connect(ctx.destination); osc.start(t + i * 0.03); osc.stop(t + 0.22);
    });
  };
  // ── Funny kid SFX + per-character signature voices ──────────────────────────
  // ── Fart engine ──────────────────────────────────────────────────────────
  // One reusable "toot" (raspberry body + wet spray + optional squeaky tail),
  // fully parameterized, so a whole family of distinct farts can be composed
  // from it. playFart() picks a random style each press so the FART BOOST
  // rarely sounds the same twice.
  interface TootOpts {
    base: number;       // fundamental Hz
    dur: number;        // seconds
    rise?: number;      // pitch-bend peak multiplier
    fall?: number;      // pitch-bend end multiplier
    lfoStart?: number;  // sputter/flutter rate at the start
    lfoEnd?: number;    // …and at the end
    lfoDepth?: number;  // flutter depth (× base)
    gain?: number;      // body loudness
    filter?: number;    // lowpass cutoff (brightness)
    noise?: number;     // wet-spray amount
    squeak?: number;    // 0..1 chance of a squeaky finish
    wave?: OscillatorType;
  }
  const fartToot = (ctx: AudioContext, t: number, o: TootOpts) => {
    const { base, dur, rise = 1.7, fall = 0.7, lfoStart = 19, lfoEnd = 8,
      lfoDepth = 0.55, gain = 0.34, filter = 900, noise = 0.13, squeak = 0.5,
      wave = "sawtooth" } = o;
    const osc = ctx.createOscillator(); const g = ctx.createGain(); const f = ctx.createBiquadFilter();
    osc.type = wave; f.type = "lowpass"; f.frequency.value = filter;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * rise, t + dur * 0.3);
    osc.frequency.linearRampToValueAtTime(base * fall, t + dur);
    const lfo = ctx.createOscillator(); const lg = ctx.createGain();
    lfo.type = "square"; lfo.frequency.setValueAtTime(lfoStart, t); lfo.frequency.linearRampToValueAtTime(lfoEnd, t + dur);
    lg.gain.value = base * lfoDepth; lfo.connect(lg); lg.connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.03);
    g.gain.setValueAtTime(gain * 0.88, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(f); f.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02); lfo.start(t); lfo.stop(t + dur + 0.02);
    if (noise > 0) {
      const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.2);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const nf = ctx.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 340; nf.Q.value = 0.8;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(noise, t); ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(nf); nf.connect(ng); ng.connect(ctx.destination); src.start(t);
    }
    if (Math.random() < squeak) {
      const sq = ctx.createOscillator(); const sg = ctx.createGain();
      sq.type = "sawtooth"; sq.frequency.setValueAtTime(base * 3, t + dur * 0.72);
      sq.frequency.linearRampToValueAtTime(base * 6, t + dur);
      sg.gain.setValueAtTime(0.0001, t + dur * 0.72); sg.gain.linearRampToValueAtTime(0.1, t + dur * 0.8);
      sg.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.05);
      sq.connect(sg); sg.connect(ctx.destination); sq.start(t + dur * 0.72); sq.stop(t + dur + 0.06);
    }
    return dur;
  };
  // A grab-bag of fart personalities. Each returns after scheduling its toots.
  const FART_STYLES: ((ctx: AudioContext, t: number) => void)[] = [
    // classic wet sputter
    (ctx, t) => fartToot(ctx, t, { base: 70 + Math.random() * 55, dur: 0.42 + Math.random() * 0.28 }),
    // tiny high squeaker "pfft!"
    (ctx, t) => fartToot(ctx, t, { base: 220 + Math.random() * 120, dur: 0.12 + Math.random() * 0.1,
      rise: 1.3, fall: 0.5, lfoStart: 34, lfoEnd: 16, lfoDepth: 0.35, gain: 0.28, filter: 1600, noise: 0.05, squeak: 0.2 }),
    // long deep "braaaaap"
    (ctx, t) => fartToot(ctx, t, { base: 48 + Math.random() * 24, dur: 0.8 + Math.random() * 0.4,
      rise: 1.4, fall: 0.6, lfoStart: 13, lfoEnd: 6, lfoDepth: 0.7, gain: 0.4, filter: 620, noise: 0.18, squeak: 0.4 }),
    // rapid bubbly flutter
    (ctx, t) => fartToot(ctx, t, { base: 90 + Math.random() * 40, dur: 0.5 + Math.random() * 0.2,
      rise: 1.9, fall: 0.8, lfoStart: 42, lfoEnd: 20, lfoDepth: 0.6, gain: 0.32, filter: 1100, noise: 0.15, squeak: 0.5 }),
    // double toot — "poot… poot!"
    (ctx, t) => {
      const d1 = fartToot(ctx, t, { base: 95 + Math.random() * 40, dur: 0.16 + Math.random() * 0.06, rise: 1.5, fall: 0.7, gain: 0.3, squeak: 0.1 });
      fartToot(ctx, t + d1 + 0.08, { base: 70 + Math.random() * 40, dur: 0.3 + Math.random() * 0.18, gain: 0.34, squeak: 0.4 });
    },
    // rude descending "trumpet"
    (ctx, t) => fartToot(ctx, t, { base: 130 + Math.random() * 40, dur: 0.55 + Math.random() * 0.25,
      rise: 1.15, fall: 0.35, lfoStart: 22, lfoEnd: 9, lfoDepth: 0.4, gain: 0.36, filter: 1300, noise: 0.1, squeak: 0.7, wave: "square" }),
  ];
  // Wet, sputtery fart used by the FART BOOST — now randomly one of several
  // distinct styles. This is the big laugh.
  const playFart = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    FART_STYLES[Math.floor(Math.random() * FART_STYLES.length)](ctx, ctx.currentTime);
  };
  // Apollo → bright, confident "yeah!"
  const playCheer = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(); const g = ctx.createGain(); const f = ctx.createBiquadFilter();
    osc.type = "square"; f.type = "bandpass"; f.Q.value = 4;
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.linearRampToValueAtTime(640, t + 0.14);
    osc.frequency.linearRampToValueAtTime(520, t + 0.34);
    f.frequency.setValueAtTime(800, t); f.frequency.linearRampToValueAtTime(1750, t + 0.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.05);
    g.gain.setValueAtTime(0.2, t + 0.24); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(f); f.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.42);
  };
  // Rocco → toddler "hee-hee-hee-hee" giggle
  const playGiggle = () => {
    const a = audioRef.current; if (!a.enabled) return;
    initAudio(); const ctx = a.ctx; if (!ctx) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const tt = t0 + i * 0.11;
      const osc = ctx.createOscillator(); const g = ctx.createGain(); const f = ctx.createBiquadFilter();
      osc.type = "triangle"; f.type = "bandpass"; f.frequency.value = 1600; f.Q.value = 6;
      const p = 900 + i * 70;
      osc.frequency.setValueAtTime(p, tt); osc.frequency.linearRampToValueAtTime(p * 1.3, tt + 0.05);
      osc.frequency.linearRampToValueAtTime(p * 0.9, tt + 0.09);
      g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.16, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.1);
      osc.connect(f); f.connect(g); g.connect(ctx.destination); osc.start(tt); osc.stop(tt + 0.12);
    }
  };
  // Play a character's signature voice (used when a character is picked).
  const playCharacterVoice = (id: string) => {
    const v = getCharacterDef(id).voice;
    if (v === "giggle") return playGiggle();
    if (v === "bark") return playBark();
    return playCheer();
  };

  // Pick the right "defeat" voice for what the blade just sliced.
  const playObstacleSound = (type: ObstacleType) => {
    switch (type) {
      case "cat": return playMeow();
      case "dog": case "flamingo": return playBark();
      case "bicycle": case "cart": return playBell();
      case "trashcan": case "pumpkin": case "toilet": case "poop": return playClatter();
      case "stopsign":
      case "gnome": case "cactus":
      case "dino": case "undies": return playBoing();
      case "cone": case "duck": return playHonk();
      case "pinata": return playCheer();
      default: return playClang(); // mailbox, hydrant, newsbox
    }
  };

  // ── Obstacles ──────────────────────────────────────────────────────────────
  const spawnObstacle = (width: number) => {
    const st = stateRef.current;
    if (st.obstacles.length >= POOL_OBSTACLES) return;
    const pool = getLevelDef(st.currentLevel).obs;
    // Platforms hold the rider's head far above BARRIER_GAP, so an overhead
    // barrier arriving while a platform is on screen is an unavoidable death
    // trap. Never pick "barrier" while any platform is still ahead/above.
    const platformAhead = st.platforms.some(pl => pl.x + pl.w > 140);
    // Same trap logic for ramps: a ramp launch under an incoming overhead
    // barrier is an unavoidable head-bonk, so keep the two apart.
    const rampAhead = st.obstacles.some(o => o.type === "ramp" && o.x + o.obsWidth > 100);
    const pickType = (): ObstacleType => {
      for (let tries = 0; tries < 6; tries++) {
        const t = pool[Math.floor(Math.random() * pool.length)];
        if (t === "barrier" && (platformAhead || rampAhead)) continue;
        return t;
      }
      return pool.find(t => t !== "barrier") ?? pool[0];
    };

    // Weighted spawn patterns so dodging left/right is always meaningful:
    //  38% single random lane (any of -1, 0, 1)
    //  22% side-only: left or right, guarantees a clear centre gap
    //  18% opposite-to-last: forces the player to react and switch lanes
    //  22% gate: block two lanes at once and leave one random safe lane
    const r = Math.random();
    let lane: number;
    if (r < 0.38) {
      lane = Math.floor(Math.random() * 3) - 1;
    } else if (r < 0.60) {
      lane = Math.random() < 0.5 ? -1 : 1;
    } else if (r < 0.78) {
      lane = st.lastObstacleLane === 0
        ? (Math.random() < 0.5 ? -1 : 1)
        : -st.lastObstacleLane;
    } else {
      // Gate pattern: two obstacles at once, with one random safe lane.
      if (st.obstacles.length + 1 < POOL_OBSTACLES) {
        const safeLane = Math.floor(Math.random() * 3) - 1;
        const laneA = safeLane === -1 ? 0 : -1;
        const laneB = safeLane === 1 ? 0 : 1;
        const tA = pickType(); const dA = OBSTACLE_DIMS[tA];
        const tB = pickType(); const dB = OBSTACLE_DIMS[tB];
        st.obstacles.push({ x: width + 80, obsWidth: dA.w, obsHeight: dA.h, type: tA, passed: false, lane: laneA });
        pushCapped(st.obstacles, POOL_OBSTACLES, { x: width + 80, obsWidth: dB.w, obsHeight: dB.h, type: tB, passed: false, lane: laneB });
        st.lastObstacleLane = safeLane;
        return;
      }
      lane = Math.floor(Math.random() * 3) - 1;
    }
    const type = pickType();
    const dim = OBSTACLE_DIMS[type];
    st.lastObstacleLane = lane;
    st.obstacles.push({ x: width + 80, obsWidth: dim.w, obsHeight: dim.h, type, passed: false, lane });
  };

  // ── Side-to-side lane movement ───────────────────────────────────────────
  // Three lanes (-1 left, 0 center, 1 right). Switching lanes is an instant,
  // logical move (used immediately for collision) — `laneVisual` springs toward
  // it each frame for the 3D render layer's smooth animated slide.
  const moveLane = (dir: -1 | 1) => {
    const st = stateRef.current;
    if (!st.gameRunning) return;
    const next = Math.max(-1, Math.min(1, st.lane + dir));
    if (next === st.lane) return;
    st.lane = next;
    // Sideways dust kick — tactile feedback on lane switch
    const groundY = getGroundY(sizeRef.current.height);
    for (let i = 0; i < 5; i++) {
      pushCapped(st.particles, POOL_PARTICLES, {
        x: 185 + (Math.random() - 0.5) * 18,
        y: groundY + FINGER_TIP_OFFSET - 6 + Math.random() * 10,
        vx: -dir * (1.5 + Math.random() * 2.5),
        vy: -(0.4 + Math.random() * 1.2),
        life: 12 + Math.random() * 8, size: 3 + Math.random() * 3,
        color: "#cbb79a", shape: "circle",
      });
    }
  };

  // Normal-mode continuous steering: LEFT/RIGHT buttons and arrow keys hold
  // (rather than tap-shift-a-lane) — each side's flag is independent so
  // holding both at once cleanly cancels out instead of one clobbering
  // the other.
  const setSteerLeft = (held: boolean) => { stateRef.current.steerLeftHeld = held; };
  const setSteerRight = (held: boolean) => { stateRef.current.steerRightHeld = held; };

  // ── Game events ────────────────────────────────────────────────────────────
  const createCrashExplosion = (x: number, y: number, roadY: number) => {
    const st = stateRef.current;
    // Kids mode: a big silly confetti-and-stars POOF instead of gore.
    if (st.kidsMode) {
      const confettiCols = ["#ff44aa", "#ffee00", "#3dff5e", "#36b8ff", "#ff9500", "#b14bff"];
      for (let i = 0; i < 45; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 7;
        pushCapped(st.particles, POOL_PARTICLES, {
          x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 3 - Math.random()*2,
          life: 45 + Math.random()*30, size: 4 + Math.random()*5,
          color: confettiCols[Math.floor(Math.random()*confettiCols.length)],
          shape: "rect", rot: Math.random()*Math.PI*2, rotV: (Math.random()-0.5)*0.5,
        });
      }
      for (let i = 0; i < 16; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 5;
        pushCapped(st.particles, POOL_PARTICLES, {
          x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 2.5,
          life: 35 + Math.random()*20, size: 5 + Math.random()*6,
          color: Math.random() < 0.5 ? "#ffffff" : "#ffe27a", shape: "circle",
        });
      }
      return;
    }
    const bloodColors = ["#8B0000","#CC0000","#DC143C","#B22222","#FF0000","#990000"];
    const boneColors  = ["#FFFACD","#F5F5DC","#E8E8D0","#D8D0C0"];

    // Blood droplets — fly wide, arc down
    for (let i = 0; i < 55; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 8;
      pushCapped(st.particles, POOL_PARTICLES, {
        x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 2.5 - Math.random()*3,
        life: 55 + Math.random()*35, size: 4 + Math.random()*9,
        color: bloodColors[Math.floor(Math.random()*bloodColors.length)],
        shape: "circle",
      });
    }

    // Bone shards — fast, tumbling
    for (let i = 0; i < 12; i++) {
      const angle = -Math.PI/2 + (Math.random()-0.5)*Math.PI*1.4;
      const speed = 4 + Math.random() * 7;
      pushCapped(st.particles, POOL_PARTICLES, {
        x, y: y - 10 + Math.random()*20,
        vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 3,
        life: 45 + Math.random()*25, size: 5 + Math.random()*7,
        color: boneColors[Math.floor(Math.random()*boneColors.length)],
        shape: "bone", rot: Math.random()*Math.PI*2, rotV: (Math.random()-0.5)*0.4,
      });
    }

    // Skin-chunk debris
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2; const speed = 2 + Math.random()*5;
      pushCapped(st.particles, POOL_PARTICLES, { x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 2,
        life: 35+Math.random()*20, size: 8+Math.random()*10,
        color: ["#c8946f","#d4a07a","#b8804a"][Math.floor(Math.random()*3)], shape:"rect" });
    }

    // Blood puddle on the road
    pushCapped(st.bloodPuddles, POOL_PUDDLES, { x: x + (Math.random()-0.5)*60, y: roadY - 4,
      rx: 28 + Math.random()*28, ry: 8 + Math.random()*8,
      life: 420, maxLife: 420 });
    // Smaller satellite puddles
    for (let k = 0; k < 3; k++) {
      pushCapped(st.bloodPuddles, POOL_PUDDLES, { x: x + (Math.random()-0.5)*120, y: roadY - 3,
        rx: 8 + Math.random()*14, ry: 3 + Math.random()*5,
        life: 360, maxLife: 360 });
    }
  };

  const showComboPopup = (text: string, color: string = "#ffee00") => {
    stateRef.current.comboPopup = { text, life: 55, maxLife: 55, color };
  };

  const activatePowerUp = (type: PowerUpType) => {
    const st = stateRef.current;
    playCoinSound();
    if (type === "magnet") { st.magnetTimer = 480; showComboPopup("MAGNET!", "#ff44ff"); }
    else if (type === "shield") { st.shieldCharges = Math.min(1, st.shieldCharges + 1); showComboPopup("SHIELD UP!", "#44ddff"); }
    else if (type === "multiplier") { st.multiplierTimer = 480; showComboPopup("2X SCORE!", "#ffee00"); }
    st.shake = Math.max(st.shake, 5);
  };

  const crash = () => {
    const st = stateRef.current;
    if (!st.gameRunning) return;
    const canvas = canvasRef.current;
    const roadY = canvas ? canvas.height - ROAD_SURFACE_OFFSET : 400;
    st.gameRunning = false;
    st.activeSwing = null;
    st.crashFlash = 28;
    st.shake = 18;
    st.jumpHeld = false;
    showDialog(pick(charLineFor("dead")), 200);
    playCrashSound();
    createCrashExplosion(185, st.playerY + 30, roadY);
    if (st.totalScore > st.bestScore) {
      st.bestScore = Math.floor(st.totalScore);
      setSaveValue("bestScore", st.bestScore);
    }
    saveLevelBest(st.currentLevel, st.levelScore);
    setLevelBests(LEVELS.map(lv => getLevelBest(lv.num)));
    const crashRunBonus = Math.floor(st.levelScore / 100);
    st.lastRunBonus = crashRunBonus;
    if (crashRunBonus > 0) {
      st.coinBalance += crashRunBonus;
      setCoinsLS(st.coinBalance);
    }
    stopMusic();
    setCoinBalanceState(st.coinBalance);
    const seqAtCrash = audioRef.current.transitionSeq;
    setTimeout(() => {
      if (seqAtCrash === audioRef.current.transitionSeq && !stateRef.current.gameRunning && audioRef.current.enabled) {
        const lvl = getLevelDef(st.currentLevel);
        startMusic(lvl.theme, false, lvl.speedMult);
      }
    }, 600);
    incrementStat("totalDeaths");
    const unlocked = checkAchievements();
    setScreen("dead");
  };

  const levelComplete = () => {
    const st = stateRef.current;
    if (!st.gameRunning || st.levelComplete) return;
    st.gameRunning = false;
    st.levelComplete = true;
    const lvlCompleteBonus = Math.floor(st.levelScore / 100);
    st.lastRunBonus = lvlCompleteBonus;
    if (lvlCompleteBonus > 0) {
      st.coinBalance += lvlCompleteBonus;
      setCoinsLS(st.coinBalance);
    }
    showDialog(pick(charLineFor("win")), 180);
    playLevelUpSound();
    stopMusic();
    setCoinBalanceState(st.coinBalance);
    const lvl = st.currentLevel;
    const seqAtComplete = audioRef.current.transitionSeq;
    setTimeout(() => {
      if (seqAtComplete === audioRef.current.transitionSeq && !stateRef.current.gameRunning && audioRef.current.enabled) {
        const lvlDef = getLevelDef(lvl);
        startMusic(lvlDef.theme, false, lvlDef.speedMult);
      }
    }, 600);
    const newMax = Math.max(getMaxLevel(), lvl + 1);
    setMaxLevel(newMax); setMaxLevelState(newMax);
    // Save per-level best before reading previous best for the complete screen
    const prevBest = getLevelBest(lvl);
    setCompletedLevelPrevBest(prevBest);
    saveLevelBest(lvl, st.levelScore);
    setLevelBests(LEVELS.map(lv => getLevelBest(lv.num)));
    setCompletedLevelMedal(getMedal(lvl));
    // Check for vehicle unlock at next level
    const nextUnlock = VEHICLES.find(v => v.cost == null && v.unlockLevel === lvl + 1);
    setUnlockedVehicle(nextUnlock || null);
    setCompletedLevel(lvl);
    setCurrentLevel(lvl);
    setTimeout(() => setScreen("levelComplete"), 300);
    const _ach = checkAchievements(); (void _ach);
  };

  const showDialog = (text: string, frames = 150) => {
    stateRef.current.dialog = { text, life: frames, maxLife: frames };
  };

  const spawnDust = (count: number, spread: number) => {
    const st = stateRef.current;
    for (let i = 0; i < count; i++) {
      pushCapped(st.particles, POOL_PARTICLES, {
        x: 170 + Math.random() * 30, y: st.playerY + FINGER_TIP_OFFSET - 4,
        vx: (Math.random() - 0.5) * spread, vy: -1.5 - Math.random() * 2.5,
        life: 20 + Math.random() * 12, size: 4 + Math.random() * 5,
        color: "#cbb79a", shape: "circle",
      });
    }
  };

  const doJump = (isDouble: boolean) => {
    const st = stateRef.current;
    st.jumpsUsed += 1;
    st.velocity = isDouble ? JUMP_FORCE * 0.9 : JUMP_FORCE;
    if (isDouble) incrementStat("totalDoubleJumps");
    incrementStat("totalJumps");
    st.onGround = false;
    st.coyoteTimer = 0;
    st.landImpact = 0;
    playJumpSound();
    spawnDust(isDouble ? 6 : 9, 6);
    if (Math.random() < 0.22) showDialog(pick(charLineFor("jump")), 70);
  };

  const jump = () => {
    initAudio();
    const st = stateRef.current;
    if (!st.gameRunning) return;
    // A jump always cancels an active/queued slide (you can hop out of a duck).
    st.sliding = false; st.slideTimer = 0; st.slideQueued = false;
    // Release from rope swing — player can bail early
    if (st.activeSwing) {
      const sw = st.activeSwing;
      const launchV = sw.angVel < 0
        ? Math.max(sw.angVel * sw.length * -0.38 - 8, -20)
        : -10;
      st.velocity = launchV;
      st.onGround = false;
      st.jumpsUsed = 0;
      st.activeSwing = null;
      st.coyoteTimer = 0;
      playJumpSound();
      spawnDust(8, 10);
      return;
    }
    st.jumpHeld = true;
    if (st.onGround || st.coyoteTimer > 0) {
      doJump(false);
    } else if (st.jumpsUsed < 2) {
      doJump(true);
    } else {
      st.jumpBuffer = JUMP_BUFFER_FRAMES; // remember it; fires the instant we land
    }
  };

  const releaseJump = () => { stateRef.current.jumpHeld = false; };

  // ── Slide / duck ─────────────────────────────────────────────────────────
  // Swipe down (or ArrowDown/S). On the ground: duck for SLIDE_FRAMES so the
  // hurtbox head drops below an overhead barrier. In the air: dive to the
  // ground fast and auto-duck the instant we land (slideQueued).
  const slide = () => {
    initAudio();
    const st = stateRef.current;
    if (!st.gameRunning || st.activeSwing) return;
    if (st.onGround || st.coyoteTimer > 0) {
      st.sliding = true;
      st.slideTimer = SLIDE_FRAMES;
      st.slideQueued = false;
      spawnDust(6, 8);
    } else {
      st.slideQueued = true;
      st.velocity = MAX_FALL; // fast dive toward the ground
    }
  };

  // ── Lightsaber slash ───────────────────────────────────────────────────────
  const slash = () => {
    initAudio();
    const st = stateRef.current;
    if (!st.gameRunning || st.activeSwing) return;
    if (st.saberSwing > 0 || st.saberCooldown > 0) return;
    st.saberSwing = SABER_SWING_FRAMES;
    st.saberCooldown = st.kidsMode ? Math.floor(SLASH_COOLDOWN * 0.7) : SLASH_COOLDOWN;
    playSaberSwingSound();
  };

  // ── FART BOOST! ─────────────────────────────────────────────────────────────
  // 2.5s speed burst (BOOST_MULT) trailing green gas, then a cooldown before it
  // can fire again. Speed + gas are handled in the game loop; this only arms it.
  const fartBoost = () => {
    initAudio();
    const st = stateRef.current;
    if (!st.gameRunning) return;
    if (st.boostTimer > 0 || st.boostCooldown > 0) return;
    st.boostTimer = BOOST_FRAMES;
    st.boostCooldown = BOOST_COOLDOWN;
    playFart();
  };

  // Destroy an obstacle the blade connects with, showering coloured sparks.
  const sliceObstacle = (o: Obstacle, roadY: number) => {
    const st = stateRef.current;
    const saber = getSaberDef(getSaberLevel());
    const cxo = o.x + o.obsWidth / 2;
    const cyo = roadY - o.obsHeight / 2;
    st.shake = Math.max(st.shake, 6);
    for (let i = 0; i < 26; i++) {
      const ang = Math.random() * Math.PI * 2; const sp = 2 + Math.random() * 7;
      pushCapped(st.particles, POOL_PARTICLES, { x: cxo, y: cyo, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2,
        life: 22 + Math.random() * 18, size: 3 + Math.random() * 5,
        color: Math.random() < 0.5 ? saber.color : saber.glow, shape: "circle" });
    }
    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2; const sp = 3 + Math.random() * 6;
      pushCapped(st.particles, POOL_PARTICLES, { x: cxo, y: cyo, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1.5,
        life: 14 + Math.random() * 10, size: 2 + Math.random() * 3, color: "#ffffff",
        shape: "rect", rot: Math.random() * 6, rotV: (Math.random() - 0.5) * 0.5 });
    }
    // Silly-obstacle payoffs: piñatas burst into bonus coins + confetti,
    // poop splats brown goo and grosses the runner out.
    if (o.type === "pinata") {
      st.coinBalance += 5;
      const confettiCols = ["#ff44aa", "#ffee00", "#3dff5e", "#36b8ff", "#ff9500", "#b14bff"];
      for (let i = 0; i < 30; i++) {
        const ang = Math.random() * Math.PI * 2; const sp = 2 + Math.random() * 8;
        pushCapped(st.particles, POOL_PARTICLES, { x: cxo, y: cyo, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 3,
          life: 35 + Math.random() * 25, size: 3 + Math.random() * 4,
          color: confettiCols[Math.floor(Math.random() * confettiCols.length)],
          shape: "rect", rot: Math.random() * 6, rotV: (Math.random() - 0.5) * 0.6 });
      }
      showComboPopup("PIÑATA! +5 ★", "#ff44aa");
    } else if (o.type === "poop") {
      for (let i = 0; i < 20; i++) {
        const ang = Math.random() * Math.PI * 2; const sp = 1.5 + Math.random() * 5;
        pushCapped(st.particles, POOL_PARTICLES, { x: cxo, y: cyo, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2,
          life: 28 + Math.random() * 16, size: 4 + Math.random() * 6,
          color: Math.random() < 0.7 ? "#8a5a2b" : "#6b4420", shape: "circle" });
      }
      showDialog("EWWW!! GROSS!!", 70);
    }
    // Slicing is skilled play: it pays score (counts toward the level target
    // and medals), plus coins — doubled while the turbo is burning.
    st.levelScore += 10; st.totalScore += 10;
    st.coinBalance += (st.multiplierTimer > 0 ? 2 : 1) * (st.boostTimer > 0 ? 2 : 1);
    incrementStat("totalObstaclesSliced"); incrementStat("totalCoinsCollected");
    const _ach4 = checkAchievements(); (void _ach4);
    setCoinsLS(st.coinBalance);
    st.comboTimer = 100;
    st.comboCount++;
    if (st.comboCount >= 3 && st.comboCount % 3 === 0) {
      showComboPopup(`${st.comboCount}x COMBO!`, "#ff8800");
      st.coinBalance += 1;
      setCoinsLS(st.coinBalance);
    }
    if (Math.random() < 0.6) showDialog(pick(charLineFor("slash")), 60);
    playSaberHitSound();
    playObstacleSound(o.type);
  };

  const startLevel = (levelNum: number) => {
    initAudio();
    const canvas = canvasRef.current; if (!canvas) return;
    const st = stateRef.current;
    const groundY = getGroundY(canvas.height);
    st.gameRunning = true;
    st.levelComplete = false;
    st.currentLevel = levelNum;
    st.levelScore = 0;
    st.obstacles = [];
    st.particles = [];
    st.bloodPuddles = [];
    st.coins = [];
    st.coinSpawnTimer = 0;
    st.powerUps = [];
    st.powerUpSpawnTimer = 0;
    st.magnetTimer = 0;
    st.multiplierTimer = 0;
    st.shieldCharges = 0;
    st.comboCount = 0;
    st.comboTimer = 0;
    st.nearMissChain = 0;
    st.nearMissTimer = 0;
    st.comboPopup = null;
    st.platforms = [];
    st.platformTimer = 0;
    st.ropes = [];
    st.ropeTimer = 0;
    st.activeSwing = null;
    st.saberSwing = 0;
    st.saberCooldown = 0;
    st.boostTimer = 0;
    st.boostCooldown = 0;
    boostActiveRef.current = false; boostReadyRef.current = true;
    setBoostActive(false); setBoostReady(true);
    st.kidsMode = getKidsMode();
    st.crashFlash = 0;
    st.playerY = groundY;
    st.velocity = 0;
    st.onGround = true;
    st.jumpsUsed = 0;
    st.jumpHeld = false;
    st.coyoteTimer = 0;
    st.jumpBuffer = 0;
    st.landImpact = 0;
    st.sliding = false;
    st.slideTimer = 0;
    st.slideQueued = false;
    st.shake = 0;
    st.spawnTimer = 0;
    st.time = 0;
    st.lane = 0;
    st.laneVisual = 0;
    st.laneVel = 0;
    st.steerX = 0;
    st.steerVel = 0;
    st.steerLeftHeld = false;
    st.steerRightHeld = false;
    st.lastObstacleLane = 0;
    st.dialog = { text: LEVEL_STORY[levelNum] || pick(charLineFor("start")), life: 200, maxLife: 200 };
    st.dialogCooldown = 320;
    setCurrentLevel(levelNum);
    setScreen("playing");
    incrementStat("totalRuns");
    stopMusic();
    if (audioRef.current.enabled) {
      const lvlDef = getLevelDef(levelNum);
      setTimeout(() => startMusic(lvlDef.theme, true, lvlDef.speedMult), 80);
    }
  };

  // ── Main game loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      canvas.width = window.innerWidth; canvas.height = window.innerHeight;
      sizeRef.current.width = canvas.width; sizeRef.current.height = canvas.height;
    };
    resize();
    window.addEventListener("resize", resize);

    // ── Bloom test shortcut (?bloomtest=<1-8>) ─────────────────────────────
    // Opens `/?bloomtest=8` (or any level 1-8) in a real GPU-equipped browser
    // to jump straight into Night theme without unlocking levels first.
    // This lets reviewers immediately verify bloom acceptance criteria:
    //   level 8 = Night / Overdrive Midnight (strongest bloom, intensity 1.15)
    //   level 5 = Highway (weakest bloom, intensity 0.5 — good for comparison)
    // The param is NOT stripped automatically; remove it from the URL bar
    // when done testing (or use history.replaceState if needed). It only
    // bypasses the level-lock check; nothing else changes in gameplay.
    const bloomTestLevel = Number(new URLSearchParams(window.location.search).get("bloomtest"));
    const isBloomTest = bloomTestLevel >= 1 && bloomTestLevel <= 8;
    if (isBloomTest) {
      setTimeout(() => startLevel(bloomTestLevel), 80);
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        if (e.repeat) return;
        const st = stateRef.current;
        if (st.gameRunning) { if (st.paused) resumeGame(); else pauseGame(); }
        return;
      }
      if (stateRef.current.paused) return; // swallow gameplay keys while paused
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        if (e.repeat) return; // ignore OS key-repeat so holding doesn't burn the double jump
        const st = stateRef.current;
        if (!st.gameRunning && !st.levelComplete && st.totalScore > 0) {
          startLevel(st.currentLevel); // quick restart from the GAME OVER screen
        } else {
          jump();
        }
      } else if (e.code === "ArrowDown" || e.code === "KeyS") {
        e.preventDefault();
        if (e.repeat) return;
        slide();
      } else if (e.code === "KeyF" || e.code === "KeyJ"
                 || e.code === "ShiftLeft" || e.code === "ShiftRight") {
        e.preventDefault();
        if (e.repeat) return;
        slash();
      } else if (e.code === "ArrowLeft" || e.code === "KeyA") {
        e.preventDefault();
        if (stateRef.current.kidsMode) { if (!e.repeat) moveLane(-1); }
        else setSteerLeft(true);
      } else if (e.code === "ArrowRight" || e.code === "KeyD") {
        e.preventDefault();
        if (stateRef.current.kidsMode) { if (!e.repeat) moveLane(1); }
        else setSteerRight(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); releaseJump(); }
      if (e.code === "ArrowLeft" || e.code === "KeyA") setSteerLeft(false);
      if (e.code === "ArrowRight" || e.code === "KeyD") setSteerRight(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);

    // Fixed-timestep accumulator (Unity FixedUpdate pattern): the sim always
    // advances at exactly 60 steps/sec regardless of display refresh rate.
    // Without this, 120Hz iPhones (ProMotion) run the whole game at 2× speed
    // and throttled 30fps devices at half speed.
    let simLast = performance.now();
    let simAcc = 0;

    const loop = () => {
      const st = stateRef.current;
      const width = canvas.width; const height = canvas.height;
      const groundY = getGroundY(height);
      const roadY = height - ROAD_SURFACE_OFFSET;
      const lvlDef = getLevelDef(st.currentLevel);
      const theme = lvlDef.theme;

      const stepSim = () => {
      if (st.gameRunning && !st.paused) {
        st.time++;
        if (st.time % 60 === 0) incrementStat("playTimeSeconds");
        // Turbo pays: +50% score rate while boosting, so the speed burst
        // finishes the level faster instead of just raising crash risk.
        const scoreGain = st.boostTimer > 0 ? 0.9 : 0.6;
        st.levelScore += scoreGain;
        st.totalScore += scoreGain;

        // Check level completion
        if (st.levelScore >= lvlDef.target) {
          levelComplete();
        }

        // Saber swing / cooldown timers
        if (st.saberSwing > 0) st.saberSwing--;
        if (st.saberCooldown > 0) st.saberCooldown--;

        // Kids mode: spring-based lane visual — accelerates toward the target
        // lane then overshoots slightly for a "weighted" feel. Normal mode:
        // continuous Mario-Kart-style steering — hold a direction to
        // accelerate sideways, release and momentum decays, no lane-snap.
        // Every hit-test below reads `st.steerX`, so kids mode mirrors its
        // discrete `lane` into it each frame and gets identical collisions
        // to before; normal mode drives it freely.
        if (st.kidsMode) {
          st.laneVel += (st.lane - st.laneVisual) * 0.22;
          st.laneVel *= 0.74;
          st.laneVisual += st.laneVel;
          st.laneVisual = Math.max(-STEER_CLAMP, Math.min(STEER_CLAMP, st.laneVisual));
          st.steerX = st.lane;
        } else {
          if (st.steerLeftHeld) st.steerVel -= STEER_ACCEL;
          if (st.steerRightHeld) st.steerVel += STEER_ACCEL;
          st.steerVel *= STEER_FRICTION;
          st.steerVel = Math.max(-STEER_MAX_VEL, Math.min(STEER_MAX_VEL, st.steerVel));
          st.steerX += st.steerVel;
          if (st.steerX < -STEER_CLAMP) { st.steerX = -STEER_CLAMP; st.steerVel = 0; }
          if (st.steerX > STEER_CLAMP) { st.steerX = STEER_CLAMP; st.steerVel = 0; }
          st.laneVisual = st.steerX;
          st.laneVel = st.steerVel;
        }

        // Physics — a near-symmetric parabolic arc, like a real thrown object.
        // The old arcade tricks (heavy 1.55× fall gravity + an artificial apex
        // hang) made jumps feel snappy-then-floaty; with the hazard-glow
        // telegraph carrying the timing job, the arc itself can be honest.
        // A whisper of fall bias (1.12×) keeps landings from feeling mushy,
        // and releasing the button early still shortens the hop.
        let g = GRAVITY * ((lvlDef as { gravityMult?: number }).gravityMult ?? 1);
        if (st.velocity < 0 && !st.jumpHeld) g *= LOW_JUMP_GRAVITY_MULT;
        else if (st.velocity > 0) g *= 1.12;
        if (st.kidsMode) g *= 0.82;   // easy mode: floatier, more forgiving jumps
        st.velocity += g;
        if (st.velocity > MAX_FALL) st.velocity = MAX_FALL;
        st.playerY += st.velocity;

        const wasAir = !st.onGround;
        if (st.playerY >= groundY) {
          if (wasAir && st.velocity > 7) {
            st.landImpact = 10;
            st.shake = Math.max(st.shake, 4);
            spawnDust(7, 9);
          }
          st.playerY = groundY; st.velocity = 0; st.onGround = true;
          st.jumpsUsed = 0; st.coyoteTimer = COYOTE_FRAMES;
          if (st.slideQueued) { st.sliding = true; st.slideTimer = SLIDE_FRAMES; st.slideQueued = false; spawnDust(6, 8); }
        } else {
          st.onGround = false;
          if (st.coyoteTimer > 0) st.coyoteTimer--;
        }
        if (st.playerY < 30) { st.playerY = 30; st.velocity = 1; }

        // Jump buffer — fire a remembered jump the instant we touch down
        if (st.jumpBuffer > 0) {
          st.jumpBuffer--;
          if (st.onGround) { doJump(false); st.jumpBuffer = 0; }
        }
        if (st.landImpact > 0) st.landImpact--;
        // Slide/duck countdown — end the ducked pose after SLIDE_FRAMES, but
        // never stand up while still under an overhead barrier (at kids-mode
        // speeds one slide is shorter than the barrier crossing time, which
        // used to be an unavoidable death — auto-hold the duck until clear).
        if (st.sliding) {
          st.slideTimer--;
          if (st.slideTimer <= 0) {
            const underBarrier = st.obstacles.some(o =>
              o.type === "barrier" && Math.abs(o.lane - st.steerX) < LANE_HIT_RADIUS &&
              o.x < 202 + 14 && o.x + o.obsWidth > 168 - 14);
            if (underBarrier) st.slideTimer = 1;
            else { st.sliding = false; st.slideTimer = 0; }
          }
        }

        // Dialog — periodic quirky one-liners while running
        if (st.dialog && st.dialog.life > 0) st.dialog.life--;
        st.dialogCooldown--;
        if (st.dialogCooldown <= 0 && (!st.dialog || st.dialog.life <= 0)) {
          showDialog(Math.random() < 0.6 ? pick(charLineFor("idle")) : pick(RUN_QUIPS), 130);
          st.dialogCooldown = 240 + Math.floor(Math.random() * 200);
        }
        if (st.shake > 0) { st.shake *= 0.86; if (st.shake < 0.4) st.shake = 0; }

        // Spawn
        const kidsSpeedMult = st.kidsMode ? KIDS_SPEED_MULT : 1;
        st.spawnTimer++;
        const spawnRate = Math.max(lvlDef.minSpawn, 220 - Math.floor(st.levelScore / lvlDef.ramp))
          * (st.kidsMode ? KIDS_SPAWN_MULT : 1);
        if (st.spawnTimer > spawnRate) { spawnObstacle(width); st.spawnTimer = 0; }

        // Spawn collectible coins — single coin or a short row, at a few heights
        st.coinSpawnTimer++;
        if (st.coinSpawnTimer > 90 + Math.random() * 70) {
          st.coinSpawnTimer = 0;
          const heights = [roadY - 46, roadY - 120, roadY - 196];
          const baseY = heights[Math.floor(Math.random() * heights.length)];
          const n = 1 + Math.floor(Math.random() * 3);
          for (let k = 0; k < n; k++) {
            pushCapped(st.coins, POOL_COINS, { x: width + 40 + k * 40, y: baseY, phase: Math.random() * Math.PI * 2 });
          }
        }

        // Obstacles + collision
        const fingerLeft = 168; const fingerRight = 202;
        const fingerCenter = (fingerLeft + fingerRight) * 0.5;
        const fingerTipY = st.playerY + FINGER_TIP_OFFSET - 8;
        if (st.boostTimer > 0) st.boostTimer--;
        if (st.boostCooldown > 0) st.boostCooldown--;
        const boostMult = st.boostTimer > 0 ? BOOST_MULT : 1;
        // Reflect boost state to the on-screen button (only re-renders on change).
        const boostActiveNow = st.boostTimer > 0;
        const boostReadyNow = st.boostCooldown === 0;
        if (boostActiveNow !== boostActiveRef.current) { boostActiveRef.current = boostActiveNow; setBoostActive(boostActiveNow); }
        if (boostReadyNow !== boostReadyRef.current) { boostReadyRef.current = boostReadyNow; setBoostReady(boostReadyNow); }
        // Speed = level base + score ramp (ramp alone capped — Runner-2 maxSpeed
        // pattern, but level base speeds stay intact), then kids/boost multipliers.
        const speed = (BASE_SPEED * lvlDef.speedMult + Math.min(st.levelScore * 0.0014, SCORE_RAMP_CAP)) * kidsSpeedMult * boostMult;
        st.curSpeed = speed;
        st.worldScroll += speed; // visual-only: drives 3D background/road scroll, no gameplay effect
        // Fart-boost green gas trail — puffs out behind the runner while boosting.
        // Uses shape "gas" (not "circle") + upward vy so it floats and never gets
        // pinned by the road floor-clamp (which only freezes "circle" droplets).
        if (st.boostTimer > 0) {
          // Butt height: the rider's rear faces the camera, so the plume must
          // erupt from THERE — not from the road under the vehicle.
          const gasBaseY = st.playerY + FINGER_TIP_OFFSET - 58;
          // Particle x maps to 3D world x via (x - 185) * 0.006 (ParticlePool in
          // Scene3D.tsx), while the rider itself moves via laneVisual * 0.85 —
          // a much bigger swing. Without this, the plume stayed pinned near
          // centre while the rider swerved off to the side lanes. 141.67 =
          // 0.85 / 0.006, so the two mappings agree and the trail rides
          // exactly behind the butt through every lane change.
          const gasBaseX = 185 + st.laneVisual * 141.67;
          for (let g = 0; g < 3; g++) {
            pushCapped(st.particles, POOL_PARTICLES, {
              // Negative vx maps to +z in the 3D scene — the plume streams
              // BACK past the camera (exhaust behind the scooter), which
              // doubles as a speed cue as the puffs whip by.
              x: gasBaseX + (Math.random() - 0.5) * 7, y: gasBaseY + Math.random() * 8,
              vx: -(1.6 + Math.random() * 2.4), vy: -(0.2 + Math.random() * 0.7),
              life: 26 + Math.random() * 12, size: 6 + Math.random() * 6,
              color: BOOST_GAS_COLORS[Math.floor(Math.random() * BOOST_GAS_COLORS.length)],
              shape: "gas",
            });
          }
        }
        const saberReach = getSaberDef(getSaberLevel()).reach;
        let didCrash = false;
        for (let i = st.obstacles.length - 1; i >= 0; i--) {
          const o = st.obstacles[i];
          o.x -= speed;
          // Saber slice — during an active swing, vaporise obstacles within blade reach.
          // Horizontal: obstacle within the blade's forward sweep. Vertical: the finger
          // must be low enough that the swung blade can connect with the obstacle's body
          // (prevents slicing ground obstacles while soaring high above them).
          const obsTopSlice = roadY - o.obsHeight;
          const vReach = saberReach * 0.6;
          const fingerHigh = fingerTipY - vReach;
          // Jump ramp — a friendly obstacle: roll into it on the ground and it
          // kicks you into a monster launch (higher than a max hold-jump).
          if (o.type === "ramp") {
            const xOverlapR = fingerRight - 4 > o.x && fingerLeft + 4 < o.x + o.obsWidth;
            if (xOverlapR && Math.abs(o.lane - st.steerX) < LANE_HIT_RADIUS && st.onGround && st.velocity >= 0) {
              st.velocity = JUMP_FORCE * 1.5;
              st.onGround = false;
              st.jumpsUsed = 0; // ramp air still allows the double-jump
              st.shake = Math.max(st.shake, 4);
              playJumpSound();
              spawnDust(12, 8);
              showComboPopup("RAMP LAUNCH!", "#ffb066");
              if (Math.random() < 0.4) showDialog(pick(charLineFor("jump")), 70);
            }
            if (!o.passed && o.x + o.obsWidth < fingerLeft) o.passed = true;
            if (o.x < -o.obsWidth - 40) st.obstacles.splice(i, 1);
            continue; // never a crash, never sliceable
          }
          if (st.saberSwing > 0 && !didCrash && o.type !== "barrier" && Math.abs(o.lane - st.steerX) < LANE_HIT_RADIUS
              && o.x + o.obsWidth >= fingerLeft - 6 && o.x <= fingerRight + saberReach
              && fingerHigh <= roadY && fingerTipY + vReach >= obsTopSlice) {
            sliceObstacle(o, roadY);
            st.obstacles.splice(i, 1);
            continue;
          }
          if (!didCrash && Math.abs(o.lane - st.steerX) < LANE_HIT_RADIUS) {
            // Slightly tighter hitbox than the visual — avoids cheap corner-clip
            // deaths while keeping collisions fair and predictable.
            const xOverlap = fingerRight - 4 > o.x && fingerLeft + 4 < o.x + o.obsWidth;
            let hit: boolean;
            if (o.type === "barrier") {
              // Overhead beam: crash if the head pokes above the gap ceiling
              // (standing or jumping into it); sliding drops the head below.
              const headY = st.sliding ? st.playerY + SLIDE_DUCK : st.playerY;
              hit = xOverlap && headY < roadY - BARRIER_GAP;
            } else {
              // 88% of visual height to forgive very top-edge grazes
              hit = xOverlap && fingerTipY > roadY - o.obsHeight * OBSTACLE_HIT_HEIGHT_FACTOR;
            }
            if (hit) {
              if (st.shieldCharges > 0) {
                st.shieldCharges--;
                st.shake = Math.max(st.shake, 10);
                showComboPopup("SHIELD BROKEN!", "#44ddff");
                for (let s = 0; s < 14; s++) {
                  const a = Math.random() * Math.PI * 2; const sp = 2 + Math.random() * 5;
                  pushCapped(st.particles, POOL_PARTICLES, { x: o.x + o.obsWidth / 2, y: roadY - o.obsHeight / 2,
                    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, life: 20 + Math.random() * 14,
                    size: 3 + Math.random() * 4, color: "#44ddff", shape: "circle" });
                }
                playSaberHitSound();
                st.obstacles.splice(i, 1);
                continue;
              }
              crash(); didCrash = true;
            }
          }
          if (!o.passed && o.x + o.obsWidth * OBSTACLE_PASS_PROGRESS < fingerLeft) {
            if (o.type !== "barrier") {
              const isWithinHorizontalThreshold =
                Math.abs(o.x + o.obsWidth * OBSTACLE_CENTER_FACTOR - fingerCenter) < NEAR_MISS_X_THRESHOLD;
              const laneDelta = Math.abs(o.lane - st.steerX);
              const clearance = roadY - o.obsHeight * OBSTACLE_HIT_HEIGHT_FACTOR - fingerTipY;
              const isNearMissJump = laneDelta < LANE_HIT_RADIUS
                && clearance >= NEAR_MISS_MIN_CLEARANCE
                && clearance <= NEAR_MISS_MAX_CLEARANCE;
              // Cleared it by steering into an adjacent lane rather than jumping.
              const isNearMissDodge = laneDelta >= LANE_HIT_RADIUS && laneDelta < NEAR_MISS_ADJACENT_LANE + 0.5;
              if (isWithinHorizontalThreshold && (isNearMissJump || isNearMissDodge)) {
                st.nearMissTimer = NEAR_MISS_CHAIN_WINDOW;
                st.nearMissChain = Math.min(NEAR_MISS_MAX_CHAIN, st.nearMissChain + 1);
                const nearMissBonus = NEAR_MISS_BASE_BONUS + st.nearMissChain * NEAR_MISS_CHAIN_BONUS;
                st.levelScore += nearMissBonus;
                st.totalScore += nearMissBonus;
                if (st.nearMissChain >= 2) {
                  st.coinBalance += 1;
                  setCoinsLS(st.coinBalance);
                }
                showComboPopup(`NEAR MISS +${nearMissBonus}`, "#7df9ff");
                if (Math.random() < NEAR_MISS_DIALOG_CHANCE && (!st.dialog || st.dialog.life <= 0)) {
                  showDialog("Whoa, close one!", NEAR_MISS_DIALOG_FRAMES);
                }
              }
            }
            o.passed = true;
          }
          if (o.x < -150) st.obstacles.splice(i, 1);
        }

        // ── Timing telegraph ──────────────────────────────────────────────────
        // Find the nearest same-lane hazard still ahead and, based on how many
        // frames until it reaches the rider, flash JUMP / DUCK / SLASH so it's
        // obvious *when* to act. Suppressed once that action is already underway.
        st.actionPrompt = null;
        {
          const px = 185; // rider collision centre (matches fingerLeft/fingerRight)
          let best: Obstacle | null = null; let bestDist = Infinity;
          for (const o of st.obstacles) {
            if (Math.abs(o.lane - st.steerX) >= LANE_HIT_RADIUS || o.type === "ramp") continue; // ramps are friendly — no warning
            const dist = o.x + o.obsWidth * 0.5 - px;
            if (dist < -12) continue;              // already passed the rider
            if (dist < bestDist) { bestDist = dist; best = o; }
          }
          if (best) {
            const frames = bestDist / Math.max(0.5, st.curSpeed);
            if (frames < 52) {
              const type: "JUMP" | "DUCK" | "SLASH" =
                best.type === "barrier" ? "DUCK" : best.type === "pinata" ? "SLASH" : "JUMP";
              const acting =
                (type === "JUMP" && !st.onGround) ||
                (type === "DUCK" && st.sliding) ||
                (type === "SLASH" && st.saberSwing > 0);
              if (!acting) st.actionPrompt = { type, frames };
            }
          }
        }

        // Coins — move, collect on overlap with the finger
        const coinTop = st.playerY - 18;
        const coinBottom = st.playerY + FINGER_TIP_OFFSET;
        for (let i = st.coins.length - 1; i >= 0; i--) {
          const c = st.coins[i];
          if (st.magnetTimer > 0) {
            const dx = 185 - c.x; const dy = (st.playerY + 30) - c.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 280 && dist > 1) { c.x += (dx / dist) * 15; c.y += (dy / dist) * 15; }
          } else {
            // Soft baseline magnet — nearby coins ease toward the rider even
            // without the powerup (Runner-2 trigger-lerp pattern). Small radius
            // so it forgives near-misses without trivialising coin lines.
            const dx = 185 - c.x; const dy = (st.playerY + 30) - c.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 85 && dist > 1) { c.x += (dx / dist) * 5.5; c.y += (dy / dist) * 5.5; }
          }
          c.x -= speed;
          if (c.x + COIN_R > 156 && c.x - COIN_R < 214 && c.y + COIN_R > coinTop && c.y - COIN_R < coinBottom) {
            st.levelScore += 5; st.totalScore += 5; // coins count toward the level target
            st.coinBalance += (st.multiplierTimer > 0 ? 2 : 1) * (st.boostTimer > 0 ? 2 : 1);
            setCoinsLS(st.coinBalance);
            playCoinSound();
            for (let s = 0; s < 8; s++) {
              const a = Math.random() * Math.PI * 2; const sp = 2 + Math.random() * 3;
              pushCapped(st.particles, POOL_PARTICLES, { x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2,
                life: 22 + Math.random() * 12, size: 3 + Math.random() * 4, color: "#ffe27a", shape: "circle" });
            }
            st.coins.splice(i, 1);
            continue;
          }
          if (c.x < -40) st.coins.splice(i, 1);
        }

        // Power-ups — spawn, move, collect on overlap with the finger
        st.powerUpSpawnTimer++;
        if (st.powerUpSpawnTimer > 560 + Math.random() * 420) {
          st.powerUpSpawnTimer = 0;
          const types: PowerUpType[] = ["magnet", "shield", "multiplier"];
          const type = types[Math.floor(Math.random() * types.length)];
          const heights = [roadY - 70, roadY - 150];
          const py = heights[Math.floor(Math.random() * heights.length)];
          pushCapped(st.powerUps, POOL_POWERUPS, { x: width + 60, y: py, type, phase: Math.random() * Math.PI * 2 });
        }
        for (let i = st.powerUps.length - 1; i >= 0; i--) {
          const p = st.powerUps[i];
          p.x -= speed;
          if (p.x + 20 > 150 && p.x - 20 < 220 && p.y + 20 > coinTop - 10 && p.y - 20 < coinBottom + 10) {
            activatePowerUp(p.type);
            st.powerUps.splice(i, 1);
            continue;
          }
          if (p.x < -60) st.powerUps.splice(i, 1);
        }
        if (st.magnetTimer > 0) st.magnetTimer--;
        if (st.multiplierTimer > 0) st.multiplierTimer--;
        if (st.nearMissTimer > 0) {
          st.nearMissTimer--;
          if (st.nearMissTimer === 0) st.nearMissChain = 0;
        }
        if (st.comboTimer > 0) { st.comboTimer--; if (st.comboTimer === 0) st.comboCount = 0; }
        if (st.comboPopup && st.comboPopup.life > 0) st.comboPopup.life--;

        // ── Active rope swing ───────────────────────────────────────────────────
        if (st.activeSwing) {
          const sw = st.activeSwing;
          sw.swingFrames++;
          sw.angVel += -0.065 * Math.sin(sw.angle);
          sw.angVel *= 0.989;
          sw.angle += sw.angVel;
          st.playerY = sw.anchorY + Math.cos(sw.angle) * sw.length - FINGER_TIP_OFFSET;
          st.velocity = 0;
          st.onGround = false;
          // Auto-release when rope passes back through vertical (swinging right after going left)
          if (sw.swingFrames > 30 && sw.angle > -0.12 && sw.angVel > 0.025) {
            st.velocity = Math.max(-(sw.angVel * sw.length * 0.38 + 10), -20);
            st.onGround = false;
            st.jumpsUsed = 0;
            st.activeSwing = null;
            spawnDust(12, 14);
            if (Math.random() < 0.7) showDialog(pick(charLineFor("jump")), 70);
          }
        }

        // ── Scrolling ropes: move, detect grab ──────────────────────────────────
        for (let i = st.ropes.length - 1; i >= 0; i--) {
          const rope = st.ropes[i];
          rope.x -= speed;
          // Only grab while falling — a rope must never hijack an upward jump
          // (velocity=0 mid-obstacle used to convert a clean jump into a death).
          if (!st.activeSwing && !st.onGround && st.velocity > 0) {
            const footY = st.playerY + FINGER_TIP_OFFSET;
            const inH = rope.x > 152 && rope.x < 218;
            const inV = st.playerY < rope.anchorY + rope.length && footY > rope.anchorY + 8;
            if (inH && inV) {
              st.activeSwing = { anchorX: rope.x, anchorY: rope.anchorY, length: rope.length, angle: 0, angVel: -0.08, swingFrames: 0 };
              st.velocity = 0;
              st.ropes.splice(i, 1);
              showDialog("Wheee!", 80);
              playJumpSound();
              continue;
            }
          }
          if (rope.x < -80) st.ropes.splice(i, 1);
        }
        st.ropeTimer++;
        if (st.ropeTimer > 720 + Math.floor(Math.random() * 400)) {
          st.ropeTimer = 0;
          pushCapped(st.ropes, POOL_ROPES, { x: width + 90, anchorY: 70 + Math.floor(Math.random() * 90), length: 210 + Math.floor(Math.random() * 100) });
        }

        // ── Platforms: scroll + collision + spawn ───────────────────────────────
        for (let i = st.platforms.length - 1; i >= 0; i--) {
          const plat = st.platforms[i];
          plat.x -= speed;
          if (plat.x + plat.w < -60) { st.platforms.splice(i, 1); continue; }
          if (!st.activeSwing && !didCrash) {
            const footY = st.playerY + FINGER_TIP_OFFSET;
            if (fingerRight > plat.x && fingerLeft < plat.x + plat.w
                && st.velocity >= 0 && footY >= plat.y && footY <= plat.y + 32) {
              st.playerY = plat.y - FINGER_TIP_OFFSET;
              st.velocity = 0;
              st.onGround = true;
              st.jumpsUsed = 0;
              st.coyoteTimer = COYOTE_FRAMES;
            }
          }
        }
        st.platformTimer++;
        // More frequent raised platforms → more elevation changes and jump-up
        // sections. Lower floor + wider decks keep them fair to land on.
        if (st.platformTimer > 320 + Math.floor(Math.random() * 150)) {
          st.platformTimer = 0;
          pushCapped(st.platforms, POOL_PLATFORMS, { x: width + 60, y: roadY - 108 - Math.floor(Math.random() * 96), w: 120 + Math.floor(Math.random() * 120) });
        }

        // Particles
        for (let i = st.particles.length - 1; i >= 0; i--) {
          const p = st.particles[i];
          p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.life--;
          if (p.rot !== undefined && p.rotV !== undefined) p.rot += p.rotV;
          // Blood droplets freeze on the road surface
          if (p.shape === "circle" && p.y >= roadY - 6) { p.y = roadY - 6; p.vy = 0; p.vx *= 0.7; }
          if (p.life <= 0) st.particles.splice(i, 1);
        }
        // Blood puddles — scroll with the world, slow fade
        const scrollSpeed = (BASE_SPEED * lvlDef.speedMult + Math.min(st.levelScore * 0.001, SCORE_RAMP_CAP)) * boostMult;
        for (let i = st.bloodPuddles.length - 1; i >= 0; i--) {
          const bp = st.bloodPuddles[i];
          bp.x -= scrollSpeed;
          bp.life--;
          if (bp.life <= 0 || bp.x < -200) st.bloodPuddles.splice(i, 1);
        }
        // Crash flash decay
        if (st.crashFlash > 0) st.crashFlash--;
      } else {
        st.time++;
        if (st.saberSwing > 0) st.saberSwing--;
        if (st.saberCooldown > 0) st.saberCooldown--;
        if (st.crashFlash > 0) st.crashFlash--;
        if (st.dialog && st.dialog.life > 0) st.dialog.life--;
        if (st.shake > 0) { st.shake *= 0.86; if (st.shake < 0.4) st.shake = 0; }
        // Particles keep animating post-crash (gore + dust settle)
        for (let i = st.particles.length - 1; i >= 0; i--) {
          const p = st.particles[i];
          p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.life--;
          if (p.rot !== undefined && p.rotV !== undefined) p.rot += p.rotV;
          if (p.shape === "circle" && p.y >= roadY - 6) { p.y = roadY - 6; p.vy = 0; p.vx *= 0.7; }
          if (p.life <= 0) st.particles.splice(i, 1);
        }
        // Scroll puddles even when not running (post-crash)
        const scrollSpeed2 = BASE_SPEED * getLevelDef(st.currentLevel).speedMult;
        for (let i = st.bloodPuddles.length - 1; i >= 0; i--) {
          const bp = st.bloodPuddles[i];
          bp.x -= scrollSpeed2 * 0.2;
          bp.life--;
          if (bp.life <= 0 || bp.x < -200) st.bloodPuddles.splice(i, 1);
        }
        if (!st.gameRunning) st.playerY = getGroundY(height);
      }
      }; // end stepSim

      // Drive the sim: run 0..N fixed steps depending on real elapsed time.
      // Clamp elapsed to 100ms so a backgrounded tab doesn't cause a
      // catch-up spiral when the player returns.
      const nowMs = performance.now();
      simAcc += Math.min(nowMs - simLast, 100);
      simLast = nowMs;
      while (simAcc >= SIM_STEP_MS) { stepSim(); simAcc -= SIM_STEP_MS; }

      // ── Draw (HUD only — the game world is now rendered by <Scene3D/> in true 3D) ─
      ctx.clearRect(0, 0, width, height);

      // ── Vehicle + rider — 2D HUD canvas for non-Vespa vehicles. When the
      // Vespa is equipped the avatar is the true-3D scooter+rider in Scene3D
      // (real shadows, scene lighting/AO, exact obstacle-lane tracking), so
      // the 2D rider must stay off to avoid a doubled avatar.
      // ── Rider/vehicle ── fully 3D now: every vehicle body + posed rider is
      // rendered by <PlayerVehicle/> in Scene3D (real shadows, scene lighting,
      // true lane tracking). The old 2D canvas rider is gone.

      // Turbo recharge fill on the fart-boost button — imperative DOM update
      // (fills bottom-up while the cooldown ticks; hidden once ready/boosting)
      if (boostFillElRef.current) {
        const el = boostFillElRef.current;
        if (st.boostTimer <= 0 && st.boostCooldown > 0) {
          const pct = 1 - st.boostCooldown / BOOST_COOLDOWN;
          el.style.opacity = "1";
          el.style.height = `${Math.round(pct * 100)}%`;
        } else {
          el.style.opacity = "0";
          el.style.height = "0%";
        }
      }

      // Dialog speech bubble banner — imperative DOM update, no React re-render
      if (dialogElRef.current) {
        const d = st.dialog;
        if (d && d.life > 0) {
          const fadeIn = Math.min(1, (d.maxLife - d.life) / 8);
          const fadeOut = Math.min(1, d.life / 20);
          dialogElRef.current.textContent = d.text;
          dialogElRef.current.style.opacity = String(Math.min(fadeIn, fadeOut));
        } else {
          dialogElRef.current.style.opacity = "0";
        }
      }

      // HUD — retro arcade style
      const AF = "'Press Start 2P', 'Courier New', monospace";
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";

      // Score (6-digit zero-padded) — dark stroke + softer glow keeps the digits
      // readable against the pale Ghibli sky (previous 22px cyan bloom smeared
      // into unreadable green mush over the daylight backdrop).
      ctx.font = `bold 44px ${AF}`;
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,20,0.85)";
      // x=72 clears the 44px pause button pinned at top-left
      ctx.strokeText(String(Math.floor(st.levelScore)).padStart(6, "0"), 72, 68);
      ctx.shadowColor = "#00ffff"; ctx.shadowBlur = 8;
      ctx.fillStyle = "#00ffff";
      ctx.fillText(String(Math.floor(st.levelScore)).padStart(6, "0"), 72, 68);
      ctx.shadowBlur = 0;

      // Best score — same treatment, smaller footprint
      ctx.font = `10px ${AF}`;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,20,0.85)";
      ctx.strokeText("BEST " + st.bestScore, 22, 90);
      ctx.shadowColor = "#ff00ff"; ctx.shadowBlur = 5;
      ctx.fillStyle = "#ff00ff";
      ctx.fillText("BEST " + st.bestScore, 22, 90);
      ctx.shadowBlur = 0;

      // Coin counter (top-right) — shows progress toward the next saber unlock
      const nextSaber = getNextUnlockableSaber();
      const coinText = nextSaber
        ? "\u2605 " + st.coinBalance + " / " + nextSaber.cost
        : "\u2605 " + st.coinBalance;
      ctx.textAlign = "right";
      ctx.shadowColor = "#ffee00"; ctx.shadowBlur = 16;
      ctx.fillStyle = "#ffee00"; ctx.font = `11px ${AF}`;
      ctx.fillText(coinText, width - 20, 90);
      ctx.shadowBlur = 0; ctx.textAlign = "left";

      // Level pill — chrome-edged for the Overdrive HUD refresh
      const lvlText = `LV${st.currentLevel}`;
      ctx.font = `10px ${AF}`;
      const lvlW = ctx.measureText(lvlText).width + 22;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.strokeStyle = "#e6e6f0"; ctx.lineWidth = 2;
      ctx.shadowColor = "#00ffcc"; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.roundRect(20, 102, lvlW, 22, 3); ctx.fill(); ctx.stroke();
      ctx.shadowColor = "#00ffcc"; ctx.shadowBlur = 12;
      ctx.fillStyle = "#00ffcc"; ctx.textAlign = "center";
      ctx.fillText(lvlText, 20 + lvlW / 2, 118);
      ctx.shadowBlur = 0; ctx.textAlign = "left";

      // Progress bar — neon
      const progress = Math.min(1, st.levelScore / lvlDef.target);
      const barW = 180; const barX = 20; const barY = 132;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.strokeStyle = "rgba(0,150,100,0.4)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(barX, barY, barW, 7, 2); ctx.fill(); ctx.stroke();
      if (progress > 0) {
        const bg = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        bg.addColorStop(0, "#00ffcc"); bg.addColorStop(0.5, "#00ff88"); bg.addColorStop(1, "#44ff00");
        ctx.shadowColor = "#00ffcc"; ctx.shadowBlur = 10;
        ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(barX, barY, barW * progress, 7, 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Active power-up status pills (below the progress bar)
      if (st.gameRunning) {
        let pillY = 152;
        const drawStatusPill = (label: string, color: string, glow: string) => {
          ctx.font = `9px ${AF}`;
          const w = ctx.measureText(label).width + 18;
          ctx.fillStyle = "rgba(0,0,0,0.75)";
          ctx.strokeStyle = color; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.roundRect(barX, pillY, w, 18, 3); ctx.fill(); ctx.stroke();
          ctx.shadowColor = glow; ctx.shadowBlur = 8;
          ctx.fillStyle = color; ctx.textAlign = "left";
          ctx.fillText(label, barX + 9, pillY + 13);
          ctx.shadowBlur = 0;
          pillY += 24;
        };
        if (st.magnetTimer > 0) drawStatusPill(`MAGNET ${Math.ceil(st.magnetTimer / 60)}s`, "#ff44ff", "rgba(255,68,255,0.8)");
        if (st.multiplierTimer > 0) drawStatusPill(`2X SCORE ${Math.ceil(st.multiplierTimer / 60)}s`, "#ffee00", "rgba(255,238,0,0.8)");
        if (st.shieldCharges > 0) drawStatusPill("SHIELD READY", "#44ddff", "rgba(68,221,255,0.8)");
      }

      // Combo / power-up pickup popup — floats up and fades near the top of the play area
      if (st.comboPopup && st.comboPopup.life > 0) {
        const cp = st.comboPopup;
        const t = 1 - cp.life / cp.maxLife;
        const alpha = Math.min(1, cp.life / 18);
        const popY = height * 0.32 - t * 40;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.shadowColor = cp.color; ctx.shadowBlur = 18;
        ctx.fillStyle = cp.color; ctx.font = `bold 20px ${AF}`;
        ctx.fillText(cp.text, width / 2, popY);
        ctx.shadowBlur = 0;
        ctx.restore();
        ctx.textAlign = "left";
      }

      // ── Action telegraph — shrinking ring + label above the rider tells you
      // exactly WHEN to act. Act when the moving ring closes onto the fixed
      // target ring. Colour-coded: green JUMP, cyan SLIDE, magenta SLASH.
      if (st.gameRunning && st.actionPrompt) {
        const ap = st.actionPrompt;
        const ideal = ap.type === "JUMP" ? 15 : ap.type === "DUCK" ? 9 : 12; // frames of lead the action needs
        const WINDOW = 52;
        const color = ap.type === "JUMP" ? "#5dff8f" : ap.type === "DUCK" ? "#39d8ff" : "#ff6ad5";
        const label = ap.type === "JUMP" ? "JUMP" : ap.type === "DUCK" ? "SLIDE" : "SLASH";
        // Sit above the 2D rider, tracking its lane (same lane spacing the
        // rider uses). Anchored to the ground line so it doesn't bob on jumps.
        const lanePixels = Math.min(width * 0.17, 165);
        const px = width / 2 + st.laneVisual * lanePixels;
        const py = getGroundY(height) + 90 - 198;
        const TARGET_R = 22;
        // Ring shrinks from WINDOW→ideal, meeting the target ring at the moment
        // to act; keeps tightening a touch past that so late presses still read.
        const prog = Math.max(0, Math.min(1, (ap.frames - ideal) / (WINDOW - ideal)));
        const ringR = TARGET_R + prog * 40;
        const inWindow = ap.frames <= ideal + 7; // the "GO" beat
        const pulse = inWindow ? 1 + Math.sin(st.time * 0.6) * 0.09 : 1;
        ctx.save();
        ctx.translate(px, py);
        // fixed target ring
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, TARGET_R, 0, Math.PI * 2); ctx.stroke();
        // moving timing ring — closes onto the target ring at the moment to act
        ctx.globalAlpha = 0.4 + 0.55 * (1 - prog);
        ctx.lineWidth = inWindow ? 5 : 3;
        ctx.shadowColor = color; ctx.shadowBlur = inWindow ? 16 : 6;
        ctx.beginPath(); ctx.arc(0, 0, ringR, 0, Math.PI * 2); ctx.stroke();
        // Icon drawn as canvas shapes (retro font lacks arrow/sword glyphs):
        // up-chevron for JUMP, down-chevron for SLIDE, an X for SLASH.
        ctx.globalAlpha = inWindow ? 1 : 0.6;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineCap = "round";
        const s = 9 * pulse;
        if (ap.type === "SLASH") {
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(-s, -s); ctx.lineTo(s, s);
          ctx.moveTo(s, -s); ctx.lineTo(-s, s);
          ctx.stroke();
        } else {
          const dir = ap.type === "DUCK" ? 1 : -1; // point down for slide, up for jump
          ctx.beginPath();
          ctx.moveTo(0, dir * s);
          ctx.lineTo(-s, dir * -s * 0.6);
          ctx.lineTo(s, dir * -s * 0.6);
          ctx.closePath();
          ctx.fill();
        }
        // label below
        ctx.shadowBlur = inWindow ? 12 : 4;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `bold ${Math.round(12 * pulse)}px ${AF}`;
        ctx.fillText(label, 0, TARGET_R + 18);
        ctx.restore();
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      }

      // Game over panel — GAME OVER arcade style
      if (!st.gameRunning && !st.levelComplete && st.totalScore > 0) {
        const deadPanelH = 296 + (st.lastRunBonus > 0 ? 28 : 0);
        ctx.fillStyle = "rgba(0,0,0,0.88)";
        ctx.strokeStyle = "#ff0044"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(width/2-220, height/2-148, 440, deadPanelH, 4); ctx.fill();
        ctx.shadowColor = "#ff0044"; ctx.shadowBlur = 32; ctx.stroke(); ctx.shadowBlur = 0;
        ctx.shadowColor = "#ff0044"; ctx.shadowBlur = 26;
        ctx.fillStyle = "#ff0044"; ctx.textAlign = "center";
        ctx.font = `24px ${AF}`; ctx.fillText("GAME OVER", width/2, height/2 - 86);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#00ffcc"; ctx.font = `10px ${AF}`;
        ctx.fillText(`LEVEL ${st.currentLevel}`, width/2, height/2 - 48);
        ctx.fillStyle = "#ffffff"; ctx.font = `10px ${AF}`;
        ctx.fillText(`${Math.floor(st.levelScore)} / ${lvlDef.target} m`, width/2, height/2 - 24);
        ctx.fillStyle = "#555555"; ctx.font = `9px ${AF}`;
        ctx.fillText(`TOTAL: ${Math.floor(st.totalScore)} m`, width/2, height/2 + 6);
        if (st.lastRunBonus > 0) {
          ctx.shadowColor = "#4eff91"; ctx.shadowBlur = 10;
          ctx.fillStyle = "#4eff91"; ctx.font = `9px ${AF}`;
          ctx.fillText(`+${st.lastRunBonus} \u2605 RUN BONUS`, width/2, height/2 + 32);
          ctx.shadowBlur = 0;
        }
        const bonusOff = st.lastRunBonus > 0 ? 28 : 0;
        if (Math.floor(st.totalScore) >= st.bestScore && st.totalScore > 5) {
          ctx.shadowColor = "#ffee00"; ctx.shadowBlur = 16;
          ctx.fillStyle = "#ffee00"; ctx.font = `10px ${AF}`;
          ctx.fillText("\u2605 NEW RECORD \u2605", width/2, height/2 + 46 + bonusOff);
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = "#444444"; ctx.font = `8px ${AF}`;
        ctx.fillText("PRESS SPACE TO RETRY", width/2, height/2 + 106 + bonusOff);
        ctx.textAlign = "left";
      }

      // Red crash flash
      if (st.crashFlash > 0) {
        const flashAlpha = (st.crashFlash / 28) * 0.55;
        ctx.fillStyle = `rgba(180,0,0,${flashAlpha})`;
        ctx.fillRect(0, 0, width, height);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    // Guard: skip start-menu music if bloomtest already launched a run
    // (the run's own startLevel() call queues level music at +80ms, so this
    // 650ms timeout would otherwise overwrite it with the menu track).
    setTimeout(() => { if (audioRef.current.enabled && !isBloomTest) startMusic("start", false); }, 650);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      stopMusic();
    };
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCanvasClick = () => {
    const st = stateRef.current;
    if (st.gameRunning) { jump(); }
    else if (!st.levelComplete && st.totalScore > 0) {
      // Retry current level
      startLevel(st.currentLevel);
    }
  };
  // ── Touch gestures ─────────────────────────────────────────────────────────
  // Commit-on-threshold so a swipe never also fires a tap-jump: pointerdown
  // only records the origin; dragging past SWIPE_THRESHOLD on the dominant axis
  // commits swipe up=jump (held for variable height), down=slide, left/right=
  // lane; a release under the threshold counts as a tap (jump / retry).
  const onCanvasPointerDown = (e: ReactPointerEvent) => {
    const t = touchRef.current;
    t.active = true; t.startX = e.clientX; t.startY = e.clientY; t.consumed = false;
  };
  const onCanvasPointerMove = (e: ReactPointerEvent) => {
    const t = touchRef.current;
    if (!t.active || t.consumed) return;
    const dx = e.clientX - t.startX; const dy = e.clientY - t.startY;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;
    t.consumed = true;
    if (Math.abs(dx) > Math.abs(dy)) {
      const direction = dx > 0 ? 1 : -1;
      if (stateRef.current.kidsMode) moveLane(direction);
      // Normal mode: a swipe is a quick steering flick — punchier than a
      // held button, decays via the same per-frame friction afterward.
      else stateRef.current.steerVel = direction * STEER_MAX_VEL * 1.4;
    }
    else if (dy < 0) { if (stateRef.current.gameRunning) jump(); }
    else slide();
  };
  const onCanvasPointerUp = () => {
    const t = touchRef.current;
    const wasConsumed = t.consumed;
    t.active = false; t.consumed = true;
    releaseJump();
    if (!wasConsumed) handleCanvasClick(); // pure tap
  };
  const onCanvasPointerCancel = () => {
    touchRef.current.active = false; touchRef.current.consumed = true;
    releaseJump();
  };
  const handleToggleMusic = () => {
    const newVal = !audioRef.current.enabled;
    audioRef.current.enabled = newVal; setMusicOn(newVal); toggleMusic();
    if (newVal) {
      const st = stateRef.current;
      const lvlDef = getLevelDef(st.currentLevel);
      const themeId: MusicThemeId = st.gameRunning ? lvlDef.theme : (screen === "start" || screen === "wardrobe" ? "start" : lvlDef.theme);
      startMusic(themeId, st.gameRunning, lvlDef.speedMult);
    } else stopMusic();
  };
  const goToMenu = () => {
    stopMusic();
    stateRef.current.paused = false; setPaused(false);
    if (audioRef.current.enabled) startMusic("start", false);
    setScreen("start");
  };
  const pauseGame = () => {
    if (!stateRef.current.gameRunning || stateRef.current.paused) return;
    stateRef.current.paused = true; setPaused(true);
  };
  const resumeGame = () => {
    stateRef.current.paused = false; setPaused(false);
  };
  const exitToMenu = () => {
    // Abandon the current run and return to the main menu.
    stateRef.current.gameRunning = false;
    goToMenu();
  };
  const handleEquipVehicle = (id: VehicleId) => {
    setEquippedVehicle(id); setEquippedVehicleState(id);
  };
  const handleBuyVehicle = (v: VehicleDef) => {
    const cost = v.cost ?? 0;
    if (getCoins() < cost || getOwnedVehicles().includes(v.id)) return;
    const newBal = getCoins() - cost;
    setCoinsLS(newBal); setCoinBalanceState(newBal);
    stateRef.current.coinBalance = newBal;
    const owned = getOwnedVehicles();
    owned.push(v.id); setOwnedVehicles(owned); setOwnedVehiclesState([...owned]);
    // Auto-equip the freshly bought ride
    setEquippedVehicle(v.id); setEquippedVehicleState(v.id);
    const _ach2 = checkAchievements(); (void _ach2);
  };
  const handleBuySaber = (tier: number) => {
    if (!isSaberOwned(tier) && buySaber(tier)) {
      setCoinBalanceState(getCoins());
      setSaberLevelState(getSaberLevel());
      stateRef.current.coinBalance = getCoins();
      const _ach = checkAchievements(); (void _ach);
    }
  };
  const handleEquipSaber = (tier: number) => {
    if (equipSaber(tier)) setSaberLevelState(getSaberLevel());
  };
  const handleToggleKids = () => {
    const v = !getKidsMode();
    setKidsModeLS(v); setKidsModeState(v); stateRef.current.kidsMode = v;
  };
  const handleSetVehicleColor = (c: string) => {
    setVehicleColorLS(c); setVehicleColorState(c);
  };
  const openWardrobe = () => {
    setCoinBalanceState(getCoins());
    setOwnedVehiclesState(getOwnedVehicles());
    setSaberLevelState(getSaberLevel());
    setScreen("wardrobe");
  };
  const openCharacterSelect = () => {
    setSelectedCharacterState(getSelectedCharacter());
    setScreen("character");
  };
  const handlePickCharacter = (id: string) => {
    setSelectedCharacterLS(id); setSelectedCharacterState(id);
    initAudio(); playCharacterVoice(id);
  };

  // ── Shared button style helpers ────────────────────────────────────────────
  const btnPress = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = "translateY(3px)";
    e.currentTarget.style.filter = "brightness(0.9)";
  };
  const btnRelease = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = "";
    e.currentTarget.style.filter = "";
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const font = "'Courier New', monospace";
  const retroFont = "'Press Start 2P', monospace";
  const overlay: React.CSSProperties = {
    position:"absolute", inset:0, display:"flex", flexDirection:"column",
    alignItems:"center", justifyContent:"center", zIndex:10, fontFamily:font,
  };

  const currentTheme = getLevelDef(currentLevel).theme as unknown as Theme3D;
  const currentChar = getCharacterDef(selectedCharacter);
  const currentSaber = getSaberDef(saberLevel);

  return (
    <div style={{ position:"fixed", inset:0, background:"#000008", touchAction:"none", boxShadow:`inset 0 0 90px ${currentChar.saberColor}2a` }}>
      <Scene3DBoundary>
        <Suspense fallback={null}>
          <Scene3D
            stateRef={stateRef as unknown as React.MutableRefObject<GameSceneState>}
            sizeRef={sizeRef}
            theme={currentTheme}
            saber={{ color: currentChar.saberColor, glow: currentChar.saberGlow, reach: currentSaber.reach }}
            skin={{ backHand: currentChar.backHand, finger: currentChar.finger, knuckle: currentChar.knuckle, nail: currentChar.nail }}
            accent={currentChar.saberGlow}
            vehicle={equippedVehicle}
            charModel={currentChar.model}
            vehicleColor={vehicleColor || undefined}
            hill={getLevelDef(currentLevel).hill ?? 0}
          />
        </Suspense>
      </Scene3DBoundary>
      <canvas ref={canvasRef} style={{ display:"block", position:"absolute", inset:0, zIndex:2, touchAction:"none" }}
        onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp} onPointerLeave={onCanvasPointerCancel} onPointerCancel={onCanvasPointerCancel} />

      {/* Mobile control buttons for lane movement - always visible during gameplay */}
      {screen === "playing" && (
        <div style={{
          position: "fixed",
          bottom: "80px",
          left: "12px",
          right: "12px",
          display: "flex",
          gap: "10px",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 7,
          pointerEvents: "auto",
        }}>
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              if (!stateRef.current.gameRunning) return;
              if (stateRef.current.kidsMode) moveLane(-1); else setSteerLeft(true);
            }}
            onPointerUp={(e) => { e.preventDefault(); setSteerLeft(false); }}
            onPointerLeave={() => setSteerLeft(false)}
            onPointerCancel={() => setSteerLeft(false)}
            style={{
              flex: 1,
              maxWidth: "140px",
              padding: "14px 16px",
              background: "rgba(255, 60, 60, 1)",
              border: "3px solid #ff2020",
              color: "white",
              fontSize: "16px",
              fontWeight: "bold",
              borderRadius: "10px",
              boxShadow: "0 6px 16px rgba(255, 0, 0, 0.6)",
              userSelect: "none",
              WebkitUserSelect: "none" as any,
              WebkitTouchCallout: "none" as any,
              opacity: 1,
            }}
          >
            ◀ LEFT
          </button>
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              if (!stateRef.current.gameRunning) return;
              if (stateRef.current.kidsMode) moveLane(1); else setSteerRight(true);
            }}
            onPointerUp={(e) => { e.preventDefault(); setSteerRight(false); }}
            onPointerLeave={() => setSteerRight(false)}
            onPointerCancel={() => setSteerRight(false)}
            style={{
              flex: 1,
              maxWidth: "140px",
              padding: "14px 16px",
              background: "rgba(60, 60, 255, 1)",
              border: "3px solid #2020ff",
              color: "white",
              fontSize: "16px",
              fontWeight: "bold",
              borderRadius: "10px",
              boxShadow: "0 6px 16px rgba(0, 0, 255, 0.6)",
              userSelect: "none",
              WebkitUserSelect: "none" as any,
              WebkitTouchCallout: "none" as any,
              opacity: 1,
            }}
          >
            RIGHT ▶
          </button>
        </div>
      )}

      <div ref={dialogElRef} style={{
        position:"absolute", top:"18%", left:"50%", transform:"translateX(-50%)", zIndex:6,
        fontFamily:"'Press Start 2P', 'Courier New', monospace", fontSize:"0.62rem", color:"#00ffcc",
        textShadow:"0 0 8px #00ffcc", background:"rgba(0,0,18,0.75)", border:"2px solid #00ffcc",
        borderRadius:4, padding:"8px 16px", maxWidth:"70vw", textAlign:"center", opacity:0,
        transition:"opacity 0.15s", pointerEvents:"none",
      }} />
      <div className="arcade-vignette" />
      <div className="arcade-scanlines" />

      {/* ── Start screen ── */}
      {screen === "start" && (
        <div style={{ ...overlay, background:"rgba(0,0,0,0.82)" }}>
          <div className="arcade-neon-pulse" style={{ fontFamily:retroFont, fontSize:"1.4rem", color:"#ffee00", marginBottom:8, letterSpacing:"0.04em", textAlign:"center", textShadow:"0 0 12px #ffee00, 0 0 30px #ff8800" }}>
            🛵 BOOTY BUTT SCOOTER
          </div>
          <p style={{ fontSize:"0.58rem", fontFamily:retroFont, margin:"8px auto 4px", maxWidth:500, lineHeight:2.5, color:"#00ffcc", textShadow:"0 0 8px #00ffcc", textAlign:"center" }}>
            {STORY_INTRO}
          </p>
          <p style={{ fontSize:"0.54rem", fontFamily:retroFont, margin:"2px 0 0", color:"#ff88ff", lineHeight:2.5, letterSpacing:"0.03em", textShadow:"0 0 8px #ff88ff", textAlign:"center" }}>
            SWIPE ↑ JUMP · ↓ SLIDE · ← → SWITCH LANES · TAP = JUMP
          </p>
          <p style={{ fontSize:"0.54rem", fontFamily:retroFont, margin:"2px 0 0", color:"#ff5555", lineHeight:2.5, letterSpacing:"0.03em", textShadow:"0 0 8px #ff5555", textAlign:"center" }}>
            ⚔ SLASH BUTTON / F TO SWING THE LIGHTSABER
          </p>
          <p style={{ fontSize:"0.52rem", fontFamily:retroFont, margin:"0 0 4px", color:"#555", lineHeight:2.5, textAlign:"center" }}>
            {VEHICLES.filter(v=>isVehicleUnlocked(v, ownedVehicles, maxLevel)).map(v=>v.emoji).join(" ")||"🛵"} rides unlocked · collect ★ coins
          </p>
          <div style={{ display:"flex", gap:16, marginTop:20, flexWrap:"wrap", justifyContent:"center" }}>
            {/* Primary path: START routes through character select so first-time
                players actually see Apollo/Rocco/Santi and their taglines
                before jumping into gameplay. */}
            <button onClick={openCharacterSelect} className="retro-btn retro-btn-chrome"
              style={{ padding:"14px 30px", fontSize:"0.78rem", fontFamily:retroFont,
                background:"transparent", color:"#ff4444",
                border:"3px solid #ff4444",
                boxShadow:"0 0 14px #ff4444, inset 0 0 14px rgba(255,68,68,0.08)",
                cursor:"pointer", letterSpacing:"0.05em", lineHeight:1.8 }}>
              ▶ START
            </button>
            {/* Quick-play with the last selected runner */}
            <button onClick={() => startLevel(1)} className="retro-btn"
              style={{ padding:"14px 22px", fontSize:"0.78rem", fontFamily:retroFont,
                background:"transparent", color:"#3dff5e",
                border:"3px solid #3dff5e",
                boxShadow:"0 0 14px #3dff5e, inset 0 0 14px rgba(61,255,94,0.08)",
                cursor:"pointer", letterSpacing:"0.05em", lineHeight:1.8 }}>
              QUICK PLAY
            </button>
            <button onClick={openWardrobe} className="retro-btn"
              style={{ padding:"14px 22px", fontSize:"0.78rem", fontFamily:retroFont,
                background:"transparent", color:"#aa44ff",
                border:"3px solid #aa44ff",
                boxShadow:"0 0 14px #aa44ff, inset 0 0 14px rgba(170,68,255,0.08)",
                cursor:"pointer", letterSpacing:"0.05em", lineHeight:1.8 }}>
              WARDROBE
            </button>
          </div>
          {/* Endless mode */}
          {isEndlessUnlocked() && (
            <button onClick={() => startLevel(9)} className="retro-btn"
              style={{ marginTop:12, padding:"10px 20px", fontSize:"0.62rem", fontFamily:retroFont,
                background:"rgba(255,68,68,0.10)", color:"#ff4444",
                border:"3px solid #ff4444",
                boxShadow:"0 0 14px rgba(255,68,68,0.35)",
                cursor:"pointer", letterSpacing:"0.05em", lineHeight:1.8 }}>
              ∞ ENDLESS MODE
            </button>
          )}
          {/* Easy / kids mode toggle */}
          <button onClick={handleToggleKids} className="retro-btn"
            style={{ marginTop:14, padding:"10px 20px", fontSize:"0.62rem", fontFamily:retroFont,
              background: kidsMode ? "rgba(0,255,136,0.12)" : "transparent",
              color: kidsMode ? "#00ff88" : "#00aa66",
              border:`3px solid ${kidsMode ? "#00ff88" : "#00aa66"}`,
              boxShadow: kidsMode ? "0 0 14px rgba(0,255,136,0.4)" : "0 0 8px rgba(0,170,102,0.25)",
              cursor:"pointer", letterSpacing:"0.05em", lineHeight:1.8 }}>
            🧒 KIDS EASY MODE: {kidsMode ? "ON" : "OFF"}
          </button>
          {kidsMode ? (
            <p style={{ fontSize:"0.5rem", fontFamily:retroFont, margin:"8px 0 0", color:"#00ff88aa", lineHeight:2.2, textAlign:"center" }}>
              SLOWER · MORE SPACE · FLOATIER JUMPS · FASTER SABER<br />
              TAP LEFT/RIGHT TO HOP LANES
            </p>
          ) : (
            <p style={{ fontSize:"0.5rem", fontFamily:retroFont, margin:"8px 0 0", color:"#00aaff99", lineHeight:2.2, textAlign:"center" }}>
              HOLD LEFT/RIGHT TO STEER — KART-STYLE FREE POSITIONING
            </p>
          )}
          {/* Level select */}
          <div style={{ marginTop:18, display:"flex", gap:7, flexWrap:"wrap", justifyContent:"center", maxWidth:600 }}>
            {LEVELS.map((lv, idx) => {
              const unlocked = lv.num <= getMaxLevel();
              const best = levelBests[idx];
              const medal = getMedal(lv.num);
              const neonBorder = medal === "gold" ? "#ffd700" : medal === "silver" ? "#c0c0c0" : medal === "bronze" ? "#cd7f32" : unlocked ? "#00aaff" : "#333";
              return (
                <button key={lv.num}
                  onClick={() => unlocked && startLevel(lv.num)}
                  className={unlocked ? "retro-btn" : undefined}
                  style={{ padding:"7px 11px", fontSize:"0.52rem", fontFamily:retroFont,
                    background:"rgba(0,0,0,0.65)",
                    color: unlocked ? "#fff" : "#444",
                    border: `2px solid ${neonBorder}`,
                    boxShadow: unlocked ? `0 0 7px ${neonBorder}` : "none",
                    cursor: unlocked ? "pointer" : "default",
                    display:"flex", flexDirection:"column", alignItems:"center", gap:2, minWidth:96, lineHeight:2 }}>
                  <span>{unlocked ? `${lv.num}. ${lv.name}` : `🔒 LV${lv.num}`}</span>
                  {unlocked && (
                    <span style={{ fontSize:"0.48rem", color: medal ? MEDAL_COLOR[medal] : "#00ffcc" }}>
                      {medal ? MEDAL_EMOJI[medal] : "–"} {best > 0 ? `${best}/${lv.target}` : "no run"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Wardrobe screen ── */}
      {screen === "wardrobe" && (
        <Suspense fallback={null}>
          <WardrobeScreen
            coinBalance={coinBalance}
            equippedVehicle={equippedVehicle}
            ownedVehicles={ownedVehicles}
            maxLevel={maxLevel}
            saberLevel={saberLevel}
            musicOn={musicOn}
            vehicleColor={vehicleColor}
            onSetVehicleColor={handleSetVehicleColor}
            onEquipSaber={handleEquipSaber}
            onEquipVehicle={handleEquipVehicle}
            onBuyVehicle={handleBuyVehicle}
            onBuySaber={handleBuySaber}
            onToggleMusic={handleToggleMusic}
            onToggleKids={handleToggleKids}
            onClose={() => setScreen("start")}
          />
        </Suspense>
      )}

      {/* ── Character select screen ── */}
      {screen === "character" && (
        <Suspense fallback={null}>
          <CharacterSelectScreen
            selectedId={selectedCharacter}
            onPick={handlePickCharacter}
            onStart={() => startLevel(1)}
            onClose={() => setScreen("start")}
          />
        </Suspense>
      )}

      {/* ── Level Complete screen ── */}
      {screen === "levelComplete" && (
        <div style={{ ...overlay, background:"rgba(0,0,0,0.84)" }}>
          <div style={{ background:"rgba(0,0,20,0.96)", border:"3px solid #00ffcc", boxShadow:"0 0 40px rgba(0,255,204,0.22), 0 0 80px rgba(0,255,204,0.07)",
            borderRadius:4, padding:"30px 38px", maxWidth:480, width:"90%", textAlign:"center" }}>
            <div style={{ fontSize:"2.4rem", marginBottom:6 }}>🎉</div>
            <h2 style={{ fontSize:"0.85rem", color:"#00ffcc", margin:"0 0 4px 0", fontFamily:retroFont, textShadow:"0 0 14px #00ffcc", letterSpacing:"0.06em" }}>STAGE CLEAR!</h2>
            <p style={{ fontSize:"0.58rem", color:"#ff88ff", margin:"0 0 8px 0", fontFamily:retroFont, textShadow:"0 0 8px #ff88ff", lineHeight:2.2 }}>
              {getLevelDef(completedLevel).name}
            </p>
            <p style={{ fontSize:"0.62rem", color:"#666", fontStyle:"italic", margin:"0 0 14px 0", lineHeight:1.8, fontFamily:font }}>
              {completedLevel < LEVELS.length
                ? (LEVEL_STORY[completedLevel + 1] || "The road rolls on…")
                : "Lefty & Middy made it home — knuckles weary, nails chipped, hearts full."}
            </p>
            <div style={{ background:"rgba(0,255,204,0.05)", border:"1px solid #00ffcc33", borderRadius:3, padding:"10px 16px", marginBottom:12 }}>
              <div style={{ fontSize:"0.52rem", color:"#00ffcc77", fontFamily:retroFont, lineHeight:2.2 }}>DISTANCE</div>
              <div style={{ fontSize:"1.3rem", fontWeight:"bold", color:"#fff", fontFamily:retroFont }}>{Math.floor(stateRef.current.levelScore)} m</div>
            </div>
            {completedLevelMedal && (
              <div style={{ background:`rgba(${completedLevelMedal==="gold"?"255,238,0":completedLevelMedal==="silver"?"192,192,192":"205,127,50"},0.08)`,
                border:`2px solid ${MEDAL_COLOR[completedLevelMedal]}`,
                boxShadow:`0 0 12px ${MEDAL_COLOR[completedLevelMedal]}44`,
                borderRadius:3, padding:"10px 16px", marginBottom:12 }}>
                <div style={{ fontSize:"1.9rem", lineHeight:1 }}>{MEDAL_EMOJI[completedLevelMedal]}</div>
                <div style={{ fontSize:"0.6rem", fontFamily:retroFont, color: MEDAL_COLOR[completedLevelMedal], marginTop:4, textShadow:`0 0 8px ${MEDAL_COLOR[completedLevelMedal]}`, lineHeight:2.2 }}>
                  {completedLevelMedal.toUpperCase()} MEDAL
                </div>
                {completedLevelPrevBest === 0 ? (
                  <div style={{ fontSize:"0.58rem", color:"#666", fontFamily:font }}>First clear!</div>
                ) : completedLevelPrevBest < getLevelDef(completedLevel).target ? (
                  <div style={{ fontSize:"0.58rem", color:"#00ffcc", fontFamily:font }}>Previous: {completedLevelPrevBest} → 🥇 now!</div>
                ) : (
                  <div style={{ fontSize:"0.58rem", color:"#666", fontFamily:font }}>Best: {getLevelBest(completedLevel)} m</div>
                )}
              </div>
            )}
            {unlockedVehicle && (
              <div style={{ background:"rgba(170,68,255,0.10)", border:"2px solid #aa44ff", boxShadow:"0 0 14px rgba(170,68,255,0.28)", borderRadius:3, padding:"10px 16px", marginBottom:16 }}>
                <div style={{ fontSize:"0.58rem", color:"#cc88ff", fontFamily:retroFont, lineHeight:2.2 }}>NEW RIDE UNLOCKED!</div>
                <div style={{ fontSize:"1.8rem" }}>{unlockedVehicle.emoji}</div>
                <div style={{ fontSize:"0.62rem", fontFamily:retroFont, color:"#fff", lineHeight:2.2 }}>{unlockedVehicle.name}</div>
                <button onClick={() => handleEquipVehicle(unlockedVehicle.id)} className="retro-btn"
                  style={{ marginTop:6, padding:"6px 16px", fontSize:"0.58rem", fontFamily:retroFont,
                    background:"rgba(170,68,255,0.18)", color:"#cc88ff", border:"2px solid #aa44ff",
                    boxShadow:"0 0 8px rgba(170,68,255,0.28)", cursor:"pointer", lineHeight:2 }}>
                  EQUIP IT
                </button>
              </div>
            )}
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              {completedLevel < LEVELS.length && (
                <button onClick={() => startLevel(completedLevel + 1)} className="retro-btn"
                  style={{ padding:"13px 26px", fontSize:"0.72rem", fontFamily:retroFont,
                    background:"rgba(0,200,80,0.12)", color:"#00ff88", border:"3px solid #00ff88",
                    boxShadow:"0 0 16px rgba(0,255,136,0.32)", cursor:"pointer", letterSpacing:"0.04em", lineHeight:1.8 }}>
                  LV {completedLevel + 1} →
                </button>
              )}
              {completedLevel >= LEVELS.length && (
                <button onClick={() => startLevel(completedLevel + 1)} className="retro-btn"
                  style={{ padding:"13px 26px", fontSize:"0.72rem", fontFamily:retroFont,
                    background:"rgba(255,238,0,0.12)", color:"#ffee00", border:"3px solid #ffee00",
                    boxShadow:"0 0 16px rgba(255,238,0,0.32)", cursor:"pointer", letterSpacing:"0.04em", lineHeight:1.8 }}>
                  ★ KEEP GOING
                </button>
              )}
              <button onClick={goToMenu} className="retro-btn"
                style={{ padding:"13px 16px", fontSize:"0.68rem", fontFamily:retroFont,
                  background:"transparent", color:"#444", border:"2px solid #333", cursor:"pointer", lineHeight:1.8 }}>
                MENU
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── On-screen SLASH button (during play) ── */}
      {screen === "playing" && (() => {
        const s = { color: currentChar.saberColor, glow: currentChar.saberGlow };
        return (
          <button
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); slash(); }}
            className="retro-btn"
            style={{ position:"absolute", bottom:24, right:24, zIndex:25,
              width:96, height:96, borderRadius:"50%",
              fontSize:"0.6rem", fontFamily:retroFont, touchAction:"none",
              background:`radial-gradient(circle at 50% 40%, ${s.color}33, rgba(0,0,0,0.85))`,
              color:"#fff", border:`3px solid ${s.color}`,
              boxShadow:`0 0 18px ${s.glow}, inset 0 0 16px ${s.color}55`,
              cursor:"pointer", letterSpacing:"0.04em", lineHeight:1.7,
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4 }}>
            <span style={{ fontSize:"1.4rem", lineHeight:1 }}>⚔</span>
            SLASH
          </button>
        );
      })()}

      {/* ── On-screen FART BOOST button (during play) ── */}
      {screen === "playing" && (
        <button
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); fartBoost(); }}
          className="retro-btn"
          disabled={!boostReady && !boostActive}
          style={{ position:"absolute", bottom:24, left:24, zIndex:25,
            width:96, height:96, borderRadius:"50%",
            fontSize:"0.5rem", fontFamily:retroFont, touchAction:"none",
            background: boostActive
              ? "radial-gradient(circle at 50% 40%, rgba(124,252,0,0.4), rgba(0,0,0,0.85))"
              : boostReady
                ? "radial-gradient(circle at 50% 40%, rgba(61,255,94,0.22), rgba(0,0,0,0.85))"
                : "radial-gradient(circle at 50% 40%, rgba(51,51,51,0.25), rgba(0,0,0,0.9))",
            color:"#fff",
            border:`3px solid ${boostActive ? "#7CFC00" : boostReady ? "#3dff5e" : "#333"}`,
            boxShadow: boostActive ? "0 0 22px #7CFC00" : boostReady ? "0 0 16px #3dff5e" : "none",
            opacity: (boostReady || boostActive) ? 1 : 0.5,
            cursor: boostReady ? "pointer" : "default", letterSpacing:"0.02em", lineHeight:1.5,
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3,
            overflow:"hidden" }}>
          {/* Recharge fill — rises bottom-up while the turbo recharges */}
          <div ref={boostFillElRef} style={{
            position:"absolute", left:0, right:0, bottom:0, height:"0%", opacity:0,
            background:"rgba(61,255,94,0.28)", pointerEvents:"none",
            transition:"height 120ms linear" }} />
          <span style={{ fontSize:"1.5rem", lineHeight:1, position:"relative" }}>💨</span>
          <span style={{ position:"relative" }}>{boostActive ? "BOOST!" : boostReady ? "FART" : "···"}</span>
        </button>
      )}

      {/* ── Pause button (during play) ── */}
      {screen === "playing" && !paused && (
        <button onClick={pauseGame} className="retro-btn" aria-label="Pause"
          style={{ position:"absolute", top:18, left:18, zIndex:26,
            width:44, height:44, borderRadius:8, fontSize:"0.7rem", fontFamily:retroFont,
            background:"rgba(0,0,0,0.8)", color:"#00ffcc", border:"2px solid #00ffcc",
            boxShadow:"0 0 10px rgba(0,255,204,0.35)", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", touchAction:"none" }}>
          II
        </button>
      )}

      {/* ── Pause overlay ── */}
      {screen === "playing" && paused && (
        <div style={{ position:"absolute", inset:0, zIndex:40,
          background:"rgba(0,0,10,0.82)", backdropFilter:"blur(2px)",
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:18 }}>
          <div style={{ fontSize:"1.1rem", color:"#00ffcc", fontFamily:retroFont,
            textShadow:"0 0 16px #00ffcc", letterSpacing:"0.08em" }}>PAUSED</div>
          <button onClick={resumeGame} className="retro-btn"
            style={{ padding:"14px 34px", fontSize:"0.8rem", fontFamily:retroFont,
              background:"rgba(0,200,80,0.14)", color:"#00ff88", border:"3px solid #00ff88",
              boxShadow:"0 0 16px rgba(0,255,136,0.32)", cursor:"pointer", letterSpacing:"0.04em", lineHeight:1.8 }}>
            ▶ RESUME
          </button>
          <button onClick={handleToggleMusic} className="retro-btn"
            style={{ padding:"10px 24px", fontSize:"0.6rem", fontFamily:retroFont,
              background:"rgba(0,0,0,0.8)", color: musicOn ? "#ffee00" : "#666",
              border:`2px solid ${musicOn ? "#ffee00" : "#444"}`, cursor:"pointer", lineHeight:2 }}>
            ♪ MUSIC {musicOn ? "ON" : "OFF"}
          </button>
          <button onClick={exitToMenu} className="retro-btn"
            style={{ padding:"12px 26px", fontSize:"0.7rem", fontFamily:retroFont,
              background:"transparent", color:"#ff6688", border:"2px solid #ff4466",
              boxShadow:"0 0 12px rgba(255,68,102,0.25)", cursor:"pointer", letterSpacing:"0.04em", lineHeight:1.8 }}>
            EXIT TO MENU
          </button>
          <div style={{ fontSize:"0.44rem", color:"#556", fontFamily:retroFont, marginTop:6 }}>
            EXITING ENDS THIS RUN
          </div>
        </div>
      )}

      {/* ── Music toggle ── */}
      <button onClick={handleToggleMusic} className="retro-btn"
        style={{ position:"absolute", top:18, right:18, zIndex:20,
          padding:"8px 14px", fontSize:"0.52rem", fontFamily:retroFont,
          background:"rgba(0,0,0,0.8)", color: musicOn ? "#ffee00" : "#444",
          border:`2px solid ${musicOn ? "#ffee00" : "#333"}`,
          boxShadow: musicOn ? "0 0 10px rgba(255,238,0,0.38)" : "none",
          cursor:"pointer", letterSpacing:"0.05em", lineHeight:2 }}>
        ♪ {musicOn ? "ON" : "OFF"}
      </button>
    </div>
  );
}
