import { useEffect, useRef, useState } from "react";
import './arcade.css';

// ── Types ─────────────────────────────────────────────────────────────────────
type ObstacleType = "mailbox"|"hydrant"|"stopsign"|"trashcan"|"dog"|"cat"|"bicycle"|"gnome"|"cone"|"newsbox";
type Theme = "suburb"|"city"|"highway"|"mountain"|"night";
type HatId = "none"|"tophat"|"cap"|"crown"|"cowboy"|"viking"|"beanie"|"party"|"wizard"|"propeller"|"halo";

interface Obstacle { x: number; obsWidth: number; obsHeight: number; type: ObstacleType; passed: boolean; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number; color: string; shape?: "rect"|"circle"|"bone"; rot?: number; rotV?: number; }
interface BloodPuddle { x: number; y: number; rx: number; ry: number; life: number; maxLife: number; }
interface Coin { x: number; y: number; phase: number; }
interface Platform { x: number; y: number; w: number; }
interface RopeScroll { x: number; anchorY: number; length: number; }
interface ActiveSwing { anchorX: number; anchorY: number; length: number; angle: number; angVel: number; swingFrames: number; }

// ── Constants ─────────────────────────────────────────────────────────────────
const GRAVITY = 0.72;
const JUMP_FORCE = -18.5;
const LOW_JUMP_GRAVITY_MULT = 2.6;   // extra gravity when jump released early → variable jump height
const FALL_GRAVITY_MULT = 1.3;       // snappier descent for better game feel
const MAX_FALL = 24;
const COYOTE_FRAMES = 7;             // grace frames to still jump after leaving the ground
const JUMP_BUFFER_FRAMES = 8;        // remember a jump pressed just before landing
const BASE_SPEED = 2.0;
const FINGER_TIP_OFFSET = 90;
const ROAD_SURFACE_OFFSET = 108;
const COIN_R = 13;
const SABER_SWING_FRAMES = 16;  // active frames of a saber swing (can slice during these)
const SLASH_COOLDOWN = 24;      // frames before the next swing is allowed
const KIDS_SPEED_MULT = 0.62;   // easy mode: gentler scroll speed
const KIDS_SPAWN_MULT = 1.5;    // easy mode: more breathing room between obstacles

function getGroundY(h: number) { return h - ROAD_SURFACE_OFFSET - FINGER_TIP_OFFSET - 8; }

// ── Level definitions ─────────────────────────────────────────────────────────
// Obstacle dimensions, grouped by jump difficulty (height = how much air you need).
//   low:  cat 42, dog 46, cone 56            — easy hops
//   mid:  hydrant 58, newsbox 60, gnome 62, trashcan 66
//   tall: mailbox 68, bicycle 68, stopsign 88 — need a committed hold-jump
// A full hold-jump clears ~228px, so even the stopsign stays fair.
const OBSTACLE_DIMS: Record<ObstacleType, { w: number; h: number }> = {
  cat:      { w:28, h:42 },
  dog:      { w:44, h:46 },
  cone:     { w:32, h:56 },
  hydrant:  { w:34, h:58 },
  newsbox:  { w:36, h:60 },
  gnome:    { w:30, h:62 },
  trashcan: { w:36, h:66 },
  mailbox:  { w:36, h:68 },
  bicycle:  { w:46, h:68 },
  stopsign: { w:22, h:88 },
};

// Per-level obstacle pools. Repeated entries bias the random pick, so the mix
// escalates: early levels are short, friendly hops; later levels lean tall and
// dense, with the stopsign showing up more often as the finale approaches.
const LEVELS = [
  { num:1, name:"Neighborhood Cruise",  target:500,  theme:"suburb"   as Theme, speedMult:1.0,  minSpawn:135, ramp:6.0,
    obs:["cat","dog","cone","cat","dog"] as ObstacleType[] },
  { num:2, name:"Shopping District",    target:600,  theme:"suburb"   as Theme, speedMult:1.2,  minSpawn:122, ramp:6.0,
    obs:["cat","dog","cone","hydrant","trashcan","cone"] as ObstacleType[] },
  { num:3, name:"Downtown",             target:650,  theme:"city"     as Theme, speedMult:1.45, minSpawn:110, ramp:5.6,
    obs:["dog","cone","hydrant","newsbox","gnome","trashcan"] as ObstacleType[] },
  { num:4, name:"City Center",          target:700,  theme:"city"     as Theme, speedMult:1.75, minSpawn:100, ramp:5.2,
    obs:["cone","hydrant","newsbox","gnome","trashcan","mailbox"] as ObstacleType[] },
  { num:5, name:"Highway On-Ramp",      target:750,  theme:"highway"  as Theme, speedMult:2.1,  minSpawn:90,  ramp:4.8,
    obs:["hydrant","newsbox","gnome","trashcan","mailbox","bicycle"] as ObstacleType[] },
  { num:6, name:"Open Highway",         target:800,  theme:"highway"  as Theme, speedMult:2.5,  minSpawn:80,  ramp:4.4,
    obs:["newsbox","gnome","trashcan","mailbox","bicycle","stopsign"] as ObstacleType[] },
  { num:7, name:"Mountain Pass",        target:900,  theme:"mountain" as Theme, speedMult:3.0,  minSpawn:70,  ramp:4.0,
    obs:["gnome","trashcan","mailbox","bicycle","stopsign","stopsign"] as ObstacleType[] },
  { num:8, name:"Night Drive",          target:1000, theme:"night"    as Theme, speedMult:3.6,  minSpawn:62,  ramp:3.6,
    obs:["trashcan","mailbox","bicycle","stopsign","bicycle","stopsign","stopsign"] as ObstacleType[] },
];
function getLevelDef(num: number) { return LEVELS[Math.min(num - 1, LEVELS.length - 1)]; }

// ── Hat catalogue ─────────────────────────────────────────────────────────────
const HATS: { id: HatId; name: string; emoji: string; unlockLevel: number; cost?: number }[] = [
  { id:"none",   name:"Bare Knuckle",  emoji:"🤚", unlockLevel:0 },
  { id:"tophat", name:"Top Hat",       emoji:"🎩", unlockLevel:2 },
  { id:"cap",    name:"Baseball Cap",  emoji:"🧢", unlockLevel:3 },
  { id:"crown",  name:"Gold Crown",    emoji:"👑", unlockLevel:5 },
  { id:"cowboy", name:"Cowboy Hat",    emoji:"🤠", unlockLevel:6 },
  { id:"viking", name:"Viking Helmet", emoji:"⚔️",  unlockLevel:8 },
  // Coin-purchasable outfits (unlockLevel:0, gated on coin purchase)
  { id:"beanie",    name:"Cozy Beanie",   emoji:"🧶", unlockLevel:0, cost:25 },
  { id:"party",     name:"Party Hat",     emoji:"🎉", unlockLevel:0, cost:50 },
  { id:"wizard",    name:"Wizard Hat",    emoji:"🧙", unlockLevel:0, cost:90 },
  { id:"propeller", name:"Propeller Cap", emoji:"🚁", unlockLevel:0, cost:140 },
  { id:"halo",      name:"Angel Halo",    emoji:"😇", unlockLevel:0, cost:200 },
];

// ── Lightsaber tiers ──────────────────────────────────────────────────────────
// The fingers wield a saber to slice obstacles mid-run. Tier 1 (red) is always
// owned; higher tiers cost coins, glow a new colour, and reach a little further.
type Saber = { tier: number; name: string; color: string; glow: string; reach: number; cost: number };
const SABERS: Saber[] = [
  { tier:1, name:"Red Saber",    color:"#ff2b2b", glow:"#ff6b6b", reach:120, cost:0   },
  { tier:2, name:"Orange Saber", color:"#ff9500", glow:"#ffbe5c", reach:135, cost:60  },
  { tier:3, name:"Green Saber",  color:"#34ff5e", glow:"#86ff9e", reach:150, cost:130 },
  { tier:4, name:"Blue Saber",   color:"#36b8ff", glow:"#8fd9ff", reach:165, cost:230 },
  { tier:5, name:"Purple Saber", color:"#b14bff", glow:"#d49bff", reach:185, cost:380 },
];
function getSaberDef(tier: number): Saber { return SABERS[Math.min(SABERS.length, Math.max(1, tier)) - 1]; }
function getSaberLevel(): number {
  const raw = parseInt(localStorage.getItem("fingerRunnerSaber") || "1", 10);
  const tier = Number.isFinite(raw) ? raw : 1;
  return Math.min(SABERS.length, Math.max(1, tier));
}
function setSaberLevelLS(n: number) { localStorage.setItem("fingerRunnerSaber", String(n)); }

// ── Kids / easy mode ──────────────────────────────────────────────────────────
function getKidsMode(): boolean { return localStorage.getItem("fingerRunnerKids") === "1"; }
function setKidsModeLS(on: boolean) { localStorage.setItem("fingerRunnerKids", on ? "1" : "0"); }

// ── Storyline & dialog ────────────────────────────────────────────────────────
const STORY_INTRO =
  "Trapped in a boring sedan on the world's longest road trip, two restless fingers — Lefty & Middy — spot a cracked-open window and make a break for it. Eight wild stretches of road stand between them and freedom.";

const LEVEL_STORY: Record<number, string> = {
  1: "Day one of freedom — the open suburb awaits!",
  2: "So many shoppers, so many feet to dodge…",
  3: "Downtown! Keep it together, knuckles.",
  4: "Rush hour. Everyone's in a hurry but us!",
  5: "Merging onto the highway — hold onto your nails!",
  6: "Pedal to the metal… er, finger to the asphalt!",
  7: "Mountain air! Don't look down, Middy.",
  8: "One last sprint under the stars. Almost home!",
};

const RUN_QUIPS = [
  "Wheee!", "Freedom tastes like asphalt!", "Can't catch us!", "Run, Middy, run!",
  "My nails look fabulous today.", "Is it leg day? It's always leg day.",
  "We were BORN to run!", "Two fingers, one dream.", "Don't look back!",
  "This is the way.", "Knuckle down!", "Living on the edge!", "So bouncy!",
];
const JUMP_QUIPS = ["Hup!", "Boing!", "Up we go!", "Weeee!", "Air time!", "Springy!"];
const CRASH_QUIPS = [
  "Should've moisturized.", "Finger down! I repeat, finger down!",
  "Well, that'll leave a callus.", "Ow. OW. OWWW.", "Tell my thumb I love it…",
  "That's gonna need a band-aid.", "I regret everything.", "Cramp! It was a cramp!",
];
const SLICE_QUIPS = ["Sliced!", "Hi-yah!", "Vzzm!", "Chop chop!", "Take that!", "Zap!", "Force is strong!"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function getMaxLevel(): number { return parseInt(localStorage.getItem("fingerRunnerMaxLevel") || "1"); }
function setMaxLevel(n: number) { localStorage.setItem("fingerRunnerMaxLevel", String(n)); }
function getEquippedHat(): HatId { return (localStorage.getItem("fingerRunnerHat") || "none") as HatId; }
function setEquippedHat(id: HatId) { localStorage.setItem("fingerRunnerHat", id); }
function getCoins(): number { return parseInt(localStorage.getItem("fingerRunnerCoins") || "0"); }
function setCoinsLS(n: number) { localStorage.setItem("fingerRunnerCoins", String(Math.max(0, Math.floor(n)))); }

// ── Per-level best scores ──────────────────────────────────────────────────────
function getLevelBest(levelNum: number): number {
  return parseInt(localStorage.getItem(`fingerRunnerBest_${levelNum}`) || "0");
}
function saveLevelBest(levelNum: number, score: number) {
  const prev = getLevelBest(levelNum);
  if (score > prev) localStorage.setItem(`fingerRunnerBest_${levelNum}`, String(Math.floor(score)));
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
function getOwnedOutfits(): HatId[] {
  try { const v = JSON.parse(localStorage.getItem("fingerRunnerOutfits") || "[]"); return Array.isArray(v) ? (v as HatId[]) : []; }
  catch { return []; }
}
function setOwnedOutfits(ids: HatId[]) { localStorage.setItem("fingerRunnerOutfits", JSON.stringify(ids)); }
// A hat is available if it's a level unlock the player has reached, or a coin
// outfit they've purchased. Coin outfits use unlockLevel:0 + a cost.
function isHatUnlocked(hat: { id: HatId; unlockLevel: number; cost?: number }, owned: HatId[]): boolean {
  if (hat.cost == null) return hat.unlockLevel <= getMaxLevel();
  return owned.includes(hat.id);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    gameRunning: false,
    levelComplete: false,
    currentLevel: 1,
    levelScore: 0,
    totalScore: 0,
    bestScore: parseInt(localStorage.getItem("fingerRunnerBest") || "0"),
    time: 0,
    velocity: 0,
    playerY: 300,
    spawnTimer: 0,
    onGround: true,
    jumpsUsed: 0,
    jumpHeld: false,
    coyoteTimer: 0,
    jumpBuffer: 0,
    landImpact: 0,
    shake: 0,
    obstacles: [] as Obstacle[],
    particles: [] as Particle[],
    bloodPuddles: [] as BloodPuddle[],
    coins: [] as Coin[],
    coinSpawnTimer: 0,
    coinBalance: getCoins(),
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
  });
  const audioRef = useRef<{
    ctx: AudioContext | null; enabled: boolean;
    interval: ReturnType<typeof setInterval> | null;
    melodyOsc: OscillatorNode | null; bassOsc: OscillatorNode | null; kickOsc: OscillatorNode | null; step: number;
  }>({ ctx:null, enabled:true, interval:null, melodyOsc:null, bassOsc:null, kickOsc:null, step:0 });
  const rafRef = useRef<number>(0);

  type Screen = "start"|"playing"|"levelComplete"|"dead"|"wardrobe";
  const [screen, setScreen] = useState<Screen>("start");
  const [musicOn, setMusicOn] = useState(true);
  const [currentLevel, setCurrentLevel] = useState(1);
  const [maxLevel, setMaxLevelState] = useState(getMaxLevel());
  const [equippedHat, setEquippedHatState] = useState<HatId>(getEquippedHat());
  const [coinBalance, setCoinBalanceState] = useState(getCoins());
  const [ownedOutfits, setOwnedState] = useState<HatId[]>(getOwnedOutfits());
  const [completedLevel, setCompletedLevel] = useState(0);
  const [unlockedHat, setUnlockedHat] = useState<typeof HATS[0] | null>(null);
  const [levelBests, setLevelBests] = useState<number[]>(() => LEVELS.map(lv => getLevelBest(lv.num)));
  const [completedLevelPrevBest, setCompletedLevelPrevBest] = useState(0);
  const [completedLevelMedal, setCompletedLevelMedal] = useState<Medal | null>(null);
  const [saberLevel, setSaberLevelState] = useState(getSaberLevel());
  const [kidsMode, setKidsModeState] = useState(getKidsMode());

  // ── Audio ──────────────────────────────────────────────────────────────────
  const initAudio = () => {
    const a = audioRef.current;
    if (!a.ctx) a.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  };
  const stopMusic = () => {
    const a = audioRef.current;
    if (a.interval) { clearInterval(a.interval); a.interval = null; }
    try { if (a.melodyOsc) { a.melodyOsc.stop(); a.melodyOsc = null; } } catch {}
    try { if (a.bassOsc) { a.bassOsc.stop(); a.bassOsc = null; } } catch {}
    try { if (a.kickOsc) { a.kickOsc.stop(); a.kickOsc = null; } } catch {}
  };
  const startMusic = (isPlaying: boolean) => {
    const a = audioRef.current;
    if (!a.enabled) return;
    initAudio();
    if (a.interval) return;
    a.step = 0;
    a.interval = setInterval(() => {
      const ctx = a.ctx; if (!ctx) return;
      const running = stateRef.current.gameRunning;
      const t = ctx.currentTime;
      const baseNote = 220;
      const melodyNotes = [0, 4, 7, 12, 7, 4, 0, 2, 5, 9, 5, 2];
      const note = baseNote * Math.pow(2, melodyNotes[a.step % melodyNotes.length] / 12);
      try { if (a.melodyOsc) a.melodyOsc.stop(); } catch {}
      a.melodyOsc = ctx.createOscillator();
      const mGain = ctx.createGain(); const mFilter = ctx.createBiquadFilter();
      a.melodyOsc.type = "sawtooth"; a.melodyOsc.frequency.value = note;
      mFilter.type = "lowpass"; mFilter.frequency.value = 1800;
      const vol = running ? 0.18 : 0.09; const envTime = running ? 0.38 : 0.55;
      mGain.gain.value = vol; mGain.gain.setValueAtTime(vol, t); mGain.gain.linearRampToValueAtTime(0.001, t + envTime);
      a.melodyOsc.connect(mFilter); mFilter.connect(mGain); mGain.connect(ctx.destination);
      a.melodyOsc.start(t); a.melodyOsc.stop(t + envTime + 0.05);
      if (a.step % 2 === 0) {
        try { if (a.bassOsc) a.bassOsc.stop(); } catch {}
        a.bassOsc = ctx.createOscillator(); const bGain = ctx.createGain();
        a.bassOsc.type = "sine"; a.bassOsc.frequency.value = baseNote / 2;
        bGain.gain.value = running ? 0.55 : 0.3; bGain.gain.linearRampToValueAtTime(0.001, t + 0.65);
        a.bassOsc.connect(bGain); bGain.connect(ctx.destination); a.bassOsc.start(t); a.bassOsc.stop(t + 0.7);
      }
      if (a.step % 4 === 0) {
        try { if (a.kickOsc) a.kickOsc.stop(); } catch {}
        a.kickOsc = ctx.createOscillator(); const kGain = ctx.createGain(); const kFilter = ctx.createBiquadFilter();
        a.kickOsc.type = "sine"; a.kickOsc.frequency.value = 95;
        kFilter.type = "lowpass"; kFilter.frequency.value = 450;
        kGain.gain.value = 1.1; kGain.gain.linearRampToValueAtTime(0.001, t + 0.45);
        a.kickOsc.frequency.setValueAtTime(95, t); a.kickOsc.frequency.linearRampToValueAtTime(42, t + 0.25);
        a.kickOsc.connect(kFilter); kFilter.connect(kGain); kGain.connect(ctx.destination);
        a.kickOsc.start(t); a.kickOsc.stop(t + 0.5);
      }
      a.step++;
    }, isPlaying ? 185 : 280);
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

  // ── Obstacles ──────────────────────────────────────────────────────────────
  const spawnObstacle = (width: number) => {
    const pool = getLevelDef(stateRef.current.currentLevel).obs;
    const type = pool[Math.floor(Math.random() * pool.length)];
    const dim = OBSTACLE_DIMS[type];
    stateRef.current.obstacles.push({ x: width + 80, obsWidth: dim.w, obsHeight: dim.h, type, passed: false });
  };

  // ── Game events ────────────────────────────────────────────────────────────
  const createCrashExplosion = (x: number, y: number, roadY: number) => {
    const st = stateRef.current;
    const bloodColors = ["#8B0000","#CC0000","#DC143C","#B22222","#FF0000","#990000"];
    const boneColors  = ["#FFFACD","#F5F5DC","#E8E8D0","#D8D0C0"];

    // Blood droplets — fly wide, arc down
    for (let i = 0; i < 55; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 8;
      st.particles.push({
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
      st.particles.push({
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
      st.particles.push({ x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 2,
        life: 35+Math.random()*20, size: 8+Math.random()*10,
        color: ["#c8946f","#d4a07a","#b8804a"][Math.floor(Math.random()*3)], shape:"rect" });
    }

    // Blood puddle on the road
    st.bloodPuddles.push({ x: x + (Math.random()-0.5)*60, y: roadY - 4,
      rx: 28 + Math.random()*28, ry: 8 + Math.random()*8,
      life: 420, maxLife: 420 });
    // Smaller satellite puddles
    for (let k = 0; k < 3; k++) {
      st.bloodPuddles.push({ x: x + (Math.random()-0.5)*120, y: roadY - 3,
        rx: 8 + Math.random()*14, ry: 3 + Math.random()*5,
        life: 360, maxLife: 360 });
    }
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
    showDialog(pick(CRASH_QUIPS), 200);
    playCrashSound();
    createCrashExplosion(185, st.playerY + 30, roadY);
    if (st.totalScore > st.bestScore) {
      st.bestScore = Math.floor(st.totalScore);
      localStorage.setItem("fingerRunnerBest", String(st.bestScore));
    }
    saveLevelBest(st.currentLevel, st.levelScore);
    setLevelBests(LEVELS.map(lv => getLevelBest(lv.num)));
    stopMusic();
    setCoinBalanceState(st.coinBalance);
    setTimeout(() => { if (!stateRef.current.gameRunning && audioRef.current.enabled) startMusic(false); }, 600);
    setScreen("dead");
  };

  const levelComplete = () => {
    const st = stateRef.current;
    if (!st.gameRunning || st.levelComplete) return;
    st.gameRunning = false;
    st.levelComplete = true;
    playLevelUpSound();
    stopMusic();
    setCoinBalanceState(st.coinBalance);
    const lvl = st.currentLevel;
    const newMax = Math.max(getMaxLevel(), lvl + 1);
    setMaxLevel(newMax); setMaxLevelState(newMax);
    // Save per-level best before reading previous best for the complete screen
    const prevBest = getLevelBest(lvl);
    setCompletedLevelPrevBest(prevBest);
    saveLevelBest(lvl, st.levelScore);
    setLevelBests(LEVELS.map(lv => getLevelBest(lv.num)));
    setCompletedLevelMedal(getMedal(lvl));
    // Check for hat unlock at next level
    const nextUnlock = HATS.find(h => h.unlockLevel === lvl + 1);
    setUnlockedHat(nextUnlock || null);
    setCompletedLevel(lvl);
    setCurrentLevel(lvl);
    setTimeout(() => setScreen("levelComplete"), 300);
  };

  const showDialog = (text: string, frames = 150) => {
    stateRef.current.dialog = { text, life: frames, maxLife: frames };
  };

  const spawnDust = (count: number, spread: number) => {
    const st = stateRef.current;
    for (let i = 0; i < count; i++) {
      st.particles.push({
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
    st.onGround = false;
    st.coyoteTimer = 0;
    st.landImpact = 0;
    playJumpSound();
    spawnDust(isDouble ? 6 : 9, 6);
    if (Math.random() < 0.18) showDialog(pick(JUMP_QUIPS), 70);
  };

  const jump = () => {
    initAudio();
    const st = stateRef.current;
    if (!st.gameRunning) return;
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

  // Destroy an obstacle the blade connects with, showering coloured sparks.
  const sliceObstacle = (o: Obstacle, roadY: number) => {
    const st = stateRef.current;
    const saber = getSaberDef(getSaberLevel());
    const cxo = o.x + o.obsWidth / 2;
    const cyo = roadY - o.obsHeight / 2;
    st.shake = Math.max(st.shake, 6);
    for (let i = 0; i < 26; i++) {
      const ang = Math.random() * Math.PI * 2; const sp = 2 + Math.random() * 7;
      st.particles.push({ x: cxo, y: cyo, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2,
        life: 22 + Math.random() * 18, size: 3 + Math.random() * 5,
        color: Math.random() < 0.5 ? saber.color : saber.glow, shape: "circle" });
    }
    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2; const sp = 3 + Math.random() * 6;
      st.particles.push({ x: cxo, y: cyo, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1.5,
        life: 14 + Math.random() * 10, size: 2 + Math.random() * 3, color: "#ffffff",
        shape: "rect", rot: Math.random() * 6, rotV: (Math.random() - 0.5) * 0.5 });
    }
    st.coinBalance += 1;
    setCoinsLS(st.coinBalance);
    if (Math.random() < 0.5) showDialog(pick(SLICE_QUIPS), 60);
    playSaberHitSound();
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
    st.platforms = [];
    st.platformTimer = 0;
    st.ropes = [];
    st.ropeTimer = 0;
    st.activeSwing = null;
    st.saberSwing = 0;
    st.saberCooldown = 0;
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
    st.shake = 0;
    st.spawnTimer = 0;
    st.time = 0;
    st.dialog = { text: LEVEL_STORY[levelNum] || pick(RUN_QUIPS), life: 200, maxLife: 200 };
    st.dialogCooldown = 320;
    setCurrentLevel(levelNum);
    setScreen("playing");
    stopMusic();
    if (audioRef.current.enabled) setTimeout(() => startMusic(true), 80);
  };

  // ── Background themes ──────────────────────────────────────────────────────
  const drawBackground = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, theme: Theme) => {
    const roadTop = height - ROAD_SURFACE_OFFSET;
    const horizY  = Math.round(height * 0.60);
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;

    if (theme === "suburb") {
      // SYNTHWAVE SUNSET — deep purple sky, retro striped sun, neon grid, palm silhouettes
      const g = ctx.createLinearGradient(0, 0, 0, horizY);
      g.addColorStop(0, "#000018"); g.addColorStop(0.40, "#200040");
      g.addColorStop(0.75, "#6a0058"); g.addColorStop(1, "#bb2060");
      ctx.fillStyle = g; ctx.fillRect(0, 0, width, horizY);
      ctx.fillStyle = "#0a0016"; ctx.fillRect(0, horizY, width, roadTop - horizY);
      for (let s = 0; s < 60; s++) {
        const sx = ((s * 213 + time * 0.10) % (width + 60) + width + 60) % (width + 60) - 30;
        const sy = (s * 127) % (horizY * 0.55);
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 0.025 + s * 0.9);
        ctx.fillStyle = s % 3 === 0 ? "#ff80ff" : s % 3 === 1 ? "#80ffff" : "#ffff80";
        ctx.fillRect(Math.round(sx), Math.round(sy), s % 5 === 0 ? 2 : 1, s % 5 === 0 ? 2 : 1);
      }
      ctx.globalAlpha = 1;
      const hg = ctx.createRadialGradient(width / 2, horizY, 0, width / 2, horizY, width * 0.55);
      hg.addColorStop(0, "rgba(255,100,40,0.65)"); hg.addColorStop(0.25, "rgba(255,40,120,0.35)"); hg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = hg; ctx.fillRect(0, horizY - 80, width, 160);
      ctx.save();
      ctx.beginPath(); ctx.arc(width / 2, horizY, 78, Math.PI, 0); ctx.closePath(); ctx.clip();
      const sg = ctx.createLinearGradient(0, horizY - 78, 0, horizY);
      sg.addColorStop(0, "#ffee44"); sg.addColorStop(0.55, "#ff8800"); sg.addColorStop(1, "#ff3300");
      ctx.fillStyle = sg; ctx.fillRect(width / 2 - 78, horizY - 78, 156, 78);
      ctx.fillStyle = "#0a0016";
      [0.22, 0.38, 0.51, 0.61, 0.69, 0.76, 0.82, 0.87].forEach(f => {
        ctx.fillRect(width / 2 - 78, horizY - 78 * (1 - f), 156, 3.5);
      });
      ctx.restore();
      const gBot = roadTop + 4;
      for (let gi = 0; gi <= 7; gi++) {
        const t = gi / 7; const gy = horizY + (gBot - horizY) * (t * t);
        ctx.strokeStyle = `rgba(255,0,200,${0.12 + t * 0.42})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke();
      }
      for (let v = -7; v <= 7; v++) {
        const gxB = width / 2 + v * (width / 5.5);
        ctx.strokeStyle = "rgba(255,0,200,0.26)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(width / 2, horizY + 4); ctx.lineTo(gxB, gBot); ctx.stroke();
      }
      const drawPalm = (px: number, ph: number) => {
        ctx.fillStyle = "#0a0018"; ctx.fillRect(px - 5, horizY - ph, 10, ph);
        ([ [-40,-20],[-30,-35],[-15,-15],[30,-28],[22,-38],[10,-18] ] as [number,number][]).forEach(([dx,dy]) => {
          ctx.beginPath(); ctx.moveTo(px, horizY - ph);
          ctx.quadraticCurveTo(px + dx * 0.5, horizY - ph + dy * 0.4, px + dx, horizY - ph + dy);
          ctx.strokeStyle = "#0a0018"; ctx.lineWidth = 8; ctx.lineCap = "round"; ctx.stroke();
        });
      };
      drawPalm(55, 75); drawPalm(175, 65); drawPalm(width - 70, 80); drawPalm(width - 190, 70);

    } else if (theme === "city") {
      // NEON CITY — near-black sky, neon-outlined buildings with glowing windows
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, "#000010"); g.addColorStop(0.6, "#030328"); g.addColorStop(1, "#0a003a");
      ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
      for (let s = 0; s < 40; s++) {
        const sx = ((s * 317 + time * 0.07) % (width + 40) + width + 40) % (width + 40) - 20;
        const sy = (s * 97) % (horizY * 0.38);
        ctx.globalAlpha = 0.4 + 0.6 * Math.sin(time * 0.02 + s);
        ctx.fillStyle = ["#00ffff","#ff00ff","#ffff00"][s % 3];
        ctx.fillRect(Math.round(sx), Math.round(sy), 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
      const ng1 = ctx.createRadialGradient(width * 0.28, horizY, 0, width * 0.28, horizY, 200);
      ng1.addColorStop(0, "rgba(0,180,255,0.14)"); ng1.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ng1; ctx.fillRect(0, horizY - 80, width, 160);
      const ng2 = ctx.createRadialGradient(width * 0.74, horizY, 0, width * 0.74, horizY, 160);
      ng2.addColorStop(0, "rgba(255,0,200,0.12)"); ng2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ng2; ctx.fillRect(0, horizY - 80, width, 160);
      const nCols = ["#00ffcc","#ff00aa","#ffee00","#00aaff","#ff6622","#aa44ff"];
      [[0.02,130,48],[0.11,95,35],[0.18,85,52],[0.26,115,32],[0.34,80,44],[0.43,90,38],
       [0.51,110,30],[0.59,80,46],[0.66,88,54],[0.73,100,28],[0.81,75,40],[0.88,95,36],[0.94,80,42]
      ].forEach(([bxf,bh,bw], i) => {
        const bx = bxf * width; const by2 = horizY - bh; const nc = nCols[i % nCols.length];
        ctx.fillStyle = "#020215"; ctx.fillRect(bx, by2, bw, bh);
        ctx.shadowColor = nc; ctx.shadowBlur = 8; ctx.strokeStyle = nc; ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.65 + 0.35 * Math.sin(time * 0.025 + i * 0.7);
        ctx.strokeRect(bx, by2, bw, bh); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        ctx.fillStyle = nc; ctx.globalAlpha = 0.5;
        for (let wx = 4; wx < bw - 5; wx += 10) {
          for (let wy = 7; wy < bh - 9; wy += 14) {
            if ((i + wx * 3 + wy) % 4 !== 0) ctx.fillRect(bx + wx, by2 + wy, 5, 7);
          }
        }
        ctx.globalAlpha = 1;
      });

    } else if (theme === "highway") {
      // OUTRUN HIGHWAY — purple-to-orange sky, retro striped sun, cyan perspective grid
      const g = ctx.createLinearGradient(0, 0, 0, horizY);
      g.addColorStop(0, "#000018"); g.addColorStop(0.28, "#380055");
      g.addColorStop(0.60, "#cc3300"); g.addColorStop(0.85, "#ffaa00"); g.addColorStop(1, "#ffdd44");
      ctx.fillStyle = g; ctx.fillRect(0, 0, width, horizY);
      ctx.fillStyle = "#080612"; ctx.fillRect(0, horizY, width, height - horizY);
      ctx.save();
      ctx.beginPath(); ctx.arc(width / 2, horizY, 90, Math.PI, 0); ctx.closePath(); ctx.clip();
      const sg2 = ctx.createLinearGradient(0, horizY - 90, 0, horizY);
      sg2.addColorStop(0, "#ffff88"); sg2.addColorStop(0.5, "#ffaa00"); sg2.addColorStop(1, "#ff4400");
      ctx.fillStyle = sg2; ctx.fillRect(width / 2 - 90, horizY - 90, 180, 90);
      ctx.fillStyle = "#000018";
      [0.18, 0.34, 0.48, 0.60, 0.70, 0.78, 0.85, 0.91].forEach(f => {
        ctx.fillRect(width / 2 - 90, horizY - 90 * (1 - f), 180, 4);
      });
      ctx.restore();
      for (let gi = 0; gi <= 5; gi++) {
        const t = gi / 5; const gy = horizY + (roadTop - horizY + 10) * (t * t);
        ctx.strokeStyle = `rgba(0,220,255,${0.12 + t * 0.32})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke();
      }
      for (let v = -6; v <= 6; v++) {
        const gxB = width / 2 + v * (width / 5.5);
        ctx.strokeStyle = "rgba(0,220,255,0.18)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(width / 2, horizY - 5); ctx.lineTo(gxB, roadTop + 8); ctx.stroke();
      }

    } else if (theme === "mountain") {
      // PIXEL PEAKS — teal starfield, stepped blocky mountains, neon snow, pixel pines
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, "#000820"); g.addColorStop(0.55, "#061838"); g.addColorStop(1, "#081c28");
      ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
      for (let s = 0; s < 80; s++) {
        const sx = (s * 167 + 11) % width; const sy = (s * 113) % (horizY * 0.70);
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 0.022 + s * 0.65);
        ctx.fillStyle = s % 5 === 0 ? "#00ffaa" : s % 5 === 1 ? "#ff88ff" : s % 5 === 2 ? "#ffee00" : "#aaffff";
        ctx.fillRect(Math.floor(sx), Math.floor(sy), s % 6 === 0 ? 2 : 1, s % 6 === 0 ? 2 : 1);
      }
      ctx.globalAlpha = 1;
      ctx.shadowColor = "#44ffcc"; ctx.shadowBlur = 24;
      ctx.fillStyle = "#bbfff0"; ctx.beginPath(); ctx.arc(width * 0.83, horizY * 0.28, 26, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = "#061838";
      ctx.beginPath(); ctx.arc(width * 0.83 + 9, horizY * 0.28 - 5, 20, 0, Math.PI * 2); ctx.fill();
      const pixMtn = (mx: number, mh: number, col: string) => {
        ctx.fillStyle = col;
        for (let py = 0; py < mh; py += 4) {
          const w2 = mh * 0.9 * (1 - (py / mh) * (py / mh)) + 4;
          ctx.fillRect(Math.round(mx - w2), horizY - mh + py, Math.round(w2 * 2), 4);
        }
      };
      pixMtn(width*0.08,120,"#0c2c46"); pixMtn(width*0.26,165,"#0a2440");
      pixMtn(width*0.44,200,"#0c2c46"); pixMtn(width*0.62,175,"#0a2440");
      pixMtn(width*0.80,148,"#0c2c46"); pixMtn(width*0.96,188,"#0a2440");
      ctx.fillStyle = "#aaffee";
      ([[0.08,120],[0.26,165],[0.44,200],[0.62,175],[0.80,148],[0.96,188]] as [number,number][]).forEach(([mxf,mh]) => {
        ctx.fillRect(mxf*width-10, horizY-mh, 20, 12); ctx.fillRect(mxf*width-15, horizY-mh+10, 30, 6);
      });
      ctx.fillStyle = "#041c30";
      [0.05,0.09,0.16,0.21,0.48,0.53,0.59,0.65,0.77,0.83,0.89,0.94].forEach(tx => {
        const px = tx * width; const th = 40 + Math.abs(Math.sin(tx * 17)) * 18;
        ctx.fillRect(px-3, horizY-th-4, 6, th+4); ctx.fillRect(px-9, horizY-th, 18, 12);
        ctx.fillRect(px-13, horizY-th+10, 26, 12); ctx.fillRect(px-17, horizY-th+20, 34, 10);
      });

    } else {
      // DEEP SPACE (night) — black sky, colorful pixel stars, nebula, neon city outlines
      ctx.fillStyle = "#000008"; ctx.fillRect(0, 0, width, height);
      for (let s = 0; s < 100; s++) {
        const sx = ((s * 193 + time * 0.14) % (width + 60) + width + 60) % (width + 60) - 30;
        const sy = (s * 137) % (horizY * 0.72);
        ctx.globalAlpha = 0.45 + 0.55 * Math.sin(time * 0.022 + s);
        ctx.fillStyle = ["#00ffff","#ff00ff","#ffff44","#ff8844","#88ffaa","#ffffff"][s % 6];
        const ss = s % 8 === 0 ? 3 : s % 4 === 0 ? 2 : 1;
        ctx.fillRect(Math.round(sx), Math.round(sy), ss, ss);
      }
      ctx.globalAlpha = 1;
      const neb1 = ctx.createRadialGradient(width*0.22, horizY*0.4, 0, width*0.22, horizY*0.4, 130);
      neb1.addColorStop(0, "rgba(0,100,255,0.09)"); neb1.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = neb1; ctx.fillRect(0, 0, width, horizY);
      const neb2 = ctx.createRadialGradient(width*0.72, horizY*0.52, 0, width*0.72, horizY*0.52, 110);
      neb2.addColorStop(0, "rgba(160,0,255,0.08)"); neb2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = neb2; ctx.fillRect(0, 0, width, horizY);
      const nc2 = ["#00ffff","#ff00ff","#ffee00","#ff4422","#00ff88"];
      [[0.05,90,40],[0.12,140,30],[0.18,80,50],[0.24,120,35],[0.32,100,42],
       [0.38,160,25],[0.44,70,55],[0.52,130,38],[0.58,90,44],
       [0.64,150,28],[0.70,110,48],[0.78,80,52],[0.85,140,32],[0.92,100,40]
      ].forEach(([bxf,bh,bw], i) => {
        const bx = bxf * width; const by2 = horizY - bh; const nc = nc2[i % nc2.length];
        ctx.fillStyle = "#000010"; ctx.fillRect(bx, by2, bw, bh);
        ctx.shadowColor = nc; ctx.shadowBlur = 10; ctx.strokeStyle = nc; ctx.lineWidth = 1;
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(time * 0.035 + i);
        ctx.strokeRect(bx, by2, bw, bh); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        ctx.fillStyle = nc; ctx.globalAlpha = 0.45 + 0.3 * Math.sin(time * 0.028 + i * 1.5);
        for (let wx = 3; wx < bw - 4; wx += 9) {
          for (let wy = 6; wy < bh - 8; wy += 13) {
            if ((i * 3 + wx + wy) % 4 !== 0) ctx.fillRect(bx + wx, by2 + wy, 4, 6);
          }
        }
        ctx.globalAlpha = 1;
      });
    }

    // ── Shared neon road (all themes) ────────────────────────────────────────
    const neonAccent = theme === "city"     ? "#00ffcc"
      : theme === "night"    ? "#00ffff"
      : theme === "mountain" ? "#44ffcc"
      : "#ff00cc";
    ctx.fillStyle = theme === "city" || theme === "night" ? "#04041a" : "#0a0018";
    ctx.fillRect(0, roadTop, width, 18);
    ctx.fillStyle = "#060610";
    ctx.fillRect(0, height - 90, width, 90);
    ctx.shadowColor = neonAccent; ctx.shadowBlur = 14;
    ctx.strokeStyle = neonAccent; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(0, roadTop); ctx.lineTo(width, roadTop); ctx.stroke();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.shadowColor = neonAccent; ctx.shadowBlur = 8;
    ctx.strokeStyle = neonAccent; ctx.lineWidth = 2; ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.moveTo(0, height - 4); ctx.lineTo(width, height - 4); ctx.stroke();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    const dashClr = theme === "night" ? "#00ffff" : theme === "city" ? "#00ccff" : "#ff44ff";
    ctx.shadowColor = dashClr; ctx.shadowBlur = 10; ctx.strokeStyle = dashClr; ctx.lineWidth = 3;
    ctx.globalAlpha = 0.7;
    for (let i = -1; i < 8; i++) {
      const xPos = ((time * 4.5) % (width + 180)) + i * (width / 5.5) - 90;
      ctx.beginPath(); ctx.moveTo(xPos, height - 50); ctx.lineTo(xPos + 55, height - 50); ctx.stroke();
    }
    ctx.globalAlpha = 0.45;
    for (let i = -1; i < 8; i++) {
      const xPos = ((time * 4.5) % (width + 180)) + i * (width / 5.5) - 90;
      ctx.beginPath(); ctx.moveTo(xPos, height - 24); ctx.lineTo(xPos + 55, height - 24); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  };

  // ── Obstacle drawings ──────────────────────────────────────────────────────
  const drawObstacle = (ctx: CanvasRenderingContext2D, o: Obstacle, height: number) => {
    const roadY = height - ROAD_SURFACE_OFFSET;
    const gx = o.x + o.obsWidth / 2;
    const by = roadY;
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";

    if (o.type === "mailbox") {
      ctx.fillStyle = "#8B5E3C"; ctx.fillRect(gx - 5, by - o.obsHeight, 10, o.obsHeight);
      ctx.fillStyle = "#b0b8c5"; ctx.beginPath(); ctx.roundRect(gx - 20, by - o.obsHeight, 42, 32, 4); ctx.fill();
      ctx.fillStyle = "#c8d0db"; ctx.beginPath(); ctx.ellipse(gx + 1, by - o.obsHeight + 2, 21, 12, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#888"; ctx.fillRect(gx - 14, by - o.obsHeight + 18, 28, 4);
      ctx.fillStyle = "#e53935"; ctx.fillRect(gx + 18, by - o.obsHeight + 5, 4, 18); ctx.fillRect(gx + 18, by - o.obsHeight + 5, 14, 10);
      ctx.fillStyle = "#555"; ctx.font = "bold 9px Arial"; ctx.textAlign = "center"; ctx.fillText("42", gx, by - o.obsHeight + 30);

    } else if (o.type === "hydrant") {
      const hy = by - o.obsHeight;
      ctx.fillStyle = "#c62828"; ctx.beginPath(); ctx.ellipse(gx, by - 6, 22, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e53935"; ctx.beginPath(); ctx.roundRect(gx - 16, hy + 14, 32, o.obsHeight - 20, 6); ctx.fill();
      ctx.fillStyle = "#ff5252"; ctx.beginPath(); ctx.ellipse(gx, hy + 16, 16, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffd600"; ctx.beginPath(); ctx.ellipse(gx, hy + 6, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c62828"; ctx.fillRect(gx - 24, by - 38, 10, 12); ctx.fillRect(gx + 14, by - 38, 10, 12);
      ctx.fillStyle = "#ffd600"; ctx.beginPath(); ctx.arc(gx - 19, by - 32, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(gx + 19, by - 32, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.beginPath(); ctx.ellipse(gx - 5, hy + 20, 5, 10, -0.3, 0, Math.PI * 2); ctx.fill();

    } else if (o.type === "stopsign") {
      ctx.fillStyle = "#888"; ctx.fillRect(gx - 4, by - o.obsHeight, 8, o.obsHeight);
      ctx.fillStyle = "#aaa"; ctx.fillRect(gx - 3, by - o.obsHeight, 4, o.obsHeight);
      const sr = 22; const sy = by - o.obsHeight + sr + 4;
      ctx.fillStyle = "#cc0000"; ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = (i*Math.PI)/4-Math.PI/8; const px=gx+sr*Math.cos(a); const py=sy+sr*Math.sin(a); i===0?ctx.moveTo(px,py):ctx.lineTo(px,py); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px Arial"; ctx.textAlign = "center"; ctx.fillText("STOP", gx, sy + 4);

    } else if (o.type === "trashcan") {
      const tw = 40; const th = o.obsHeight;
      ctx.fillStyle = "#78909c";
      ctx.beginPath(); ctx.moveTo(gx-tw/2+4,by-th+14); ctx.lineTo(gx+tw/2-4,by-th+14); ctx.lineTo(gx+tw/2+2,by); ctx.lineTo(gx-tw/2-2,by); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#546e7a"; ctx.beginPath(); ctx.roundRect(gx-tw/2-4,by-th+4,tw+8,14,4); ctx.fill();
      ctx.fillStyle = "#78909c"; ctx.fillRect(gx-8,by-th,16,6);
      ctx.strokeStyle = "#546e7a"; ctx.lineWidth = 2;
      for (let r=1;r<=3;r++){const ry=by-th+14+r*((th-14)/4);ctx.beginPath();ctx.moveTo(gx-tw/2+2,ry);ctx.lineTo(gx+tw/2-2,ry);ctx.stroke();}
      ctx.fillStyle="rgba(255,255,255,0.18)"; ctx.fillRect(gx-tw/2+6,by-th+18,8,th-20);

    } else if (o.type === "dog") {
      const dy = by - o.obsHeight;
      ctx.fillStyle="#c4954a"; ctx.beginPath(); ctx.ellipse(gx-5,dy+22,32,18,0.1,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#d4a55a"; ctx.beginPath(); ctx.ellipse(gx+28,dy+14,18,16,-0.2,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#b07030"; ctx.beginPath(); ctx.ellipse(gx+34,dy+18,8,14,0.6,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#c4954a"; ctx.beginPath(); ctx.ellipse(gx+44,dy+20,10,8,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#333"; ctx.beginPath(); ctx.ellipse(gx+53,dy+17,4,3,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#222"; ctx.beginPath(); ctx.arc(gx+36,dy+10,3,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(gx+37,dy+9,1.2,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle="#b07030"; ctx.lineWidth=6; ctx.beginPath(); ctx.arc(gx-36,dy+12,14,0.2,Math.PI*1.4); ctx.stroke();
      ctx.fillStyle="#b07030";
      [gx-18,gx-5,gx+8,gx+20].forEach(lx=>{ctx.fillRect(lx-4,dy+34,8,16);});
      ctx.fillStyle="#c4954a";
      [gx-18,gx-5,gx+8,gx+20].forEach(lx=>{ctx.beginPath();ctx.ellipse(lx,dy+50,6,4,0,0,Math.PI*2);ctx.fill();});

    } else if (o.type === "cat") {
      const cy2 = by - o.obsHeight;
      ctx.fillStyle="#888"; ctx.beginPath(); ctx.ellipse(gx,cy2+22,16,18,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#999"; ctx.beginPath(); ctx.arc(gx,cy2+6,14,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#999";
      ctx.beginPath();ctx.moveTo(gx-10,cy2);ctx.lineTo(gx-16,cy2-12);ctx.lineTo(gx-2,cy2-4);ctx.fill();
      ctx.beginPath();ctx.moveTo(gx+10,cy2);ctx.lineTo(gx+16,cy2-12);ctx.lineTo(gx+2,cy2-4);ctx.fill();
      ctx.fillStyle="#f48fb1";
      ctx.beginPath();ctx.moveTo(gx-9,cy2-1);ctx.lineTo(gx-13,cy2-9);ctx.lineTo(gx-3,cy2-4);ctx.fill();
      ctx.beginPath();ctx.moveTo(gx+9,cy2-1);ctx.lineTo(gx+13,cy2-9);ctx.lineTo(gx+3,cy2-4);ctx.fill();
      ctx.fillStyle="#4caf50";
      ctx.beginPath();ctx.ellipse(gx-5,cy2+5,4,3,-0.3,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.ellipse(gx+5,cy2+5,4,3,0.3,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#111";
      ctx.beginPath();ctx.ellipse(gx-5,cy2+5,2,3,0,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.ellipse(gx+5,cy2+5,2,3,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#f48fb1";ctx.beginPath();ctx.arc(gx,cy2+10,2,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="#bbb";ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(gx-3,cy2+10);ctx.lineTo(gx-14,cy2+9);ctx.stroke();
      ctx.beginPath();ctx.moveTo(gx+3,cy2+10);ctx.lineTo(gx+14,cy2+9);ctx.stroke();
      ctx.strokeStyle="#888";ctx.lineWidth=5;
      ctx.beginPath();ctx.moveTo(gx+14,cy2+28);ctx.quadraticCurveTo(gx+30,cy2+36,gx+22,cy2+44);ctx.stroke();

    } else if (o.type === "bicycle") {
      const bby=by-12; const wr=30; const lx=o.x+wr+4; const rx=o.x+o.obsWidth-wr-4; const axleY=bby-wr;
      [lx,rx].forEach(wx=>{
        ctx.strokeStyle="#222";ctx.lineWidth=6;ctx.beginPath();ctx.arc(wx,axleY,wr,0,Math.PI*2);ctx.stroke();
        ctx.strokeStyle="#999";ctx.lineWidth=2;ctx.beginPath();ctx.arc(wx,axleY,wr-4,0,Math.PI*2);ctx.stroke();
        ctx.strokeStyle="#aaa";ctx.lineWidth=1.5;
        for(let sp=0;sp<6;sp++){const a=(sp*Math.PI)/3;ctx.beginPath();ctx.moveTo(wx,axleY);ctx.lineTo(wx+(wr-5)*Math.cos(a),axleY+(wr-5)*Math.sin(a));ctx.stroke();}
        ctx.fillStyle="#888";ctx.beginPath();ctx.arc(wx,axleY,5,0,Math.PI*2);ctx.fill();
      });
      ctx.strokeStyle="#e53935";ctx.lineWidth=5;
      ctx.beginPath();ctx.moveTo(lx,axleY);ctx.lineTo(gx-2,axleY-wr+6);ctx.lineTo(rx,axleY);ctx.stroke();
      ctx.beginPath();ctx.moveTo(gx-2,axleY-wr+6);ctx.lineTo(rx,axleY);ctx.stroke();
      ctx.strokeStyle="#888";ctx.lineWidth=4;
      ctx.beginPath();ctx.moveTo(rx,axleY);ctx.lineTo(rx-2,axleY-18);ctx.stroke();
      ctx.beginPath();ctx.moveTo(rx-8,axleY-18);ctx.lineTo(rx+8,axleY-18);ctx.stroke();
      ctx.fillStyle="#333";ctx.beginPath();ctx.roundRect(gx-18,axleY-wr+2,32,8,4);ctx.fill();

    } else if (o.type === "gnome") {
      const gy=by-o.obsHeight;
      ctx.fillStyle="#1565c0";ctx.fillRect(gx-12,gy+42,9,24);ctx.fillRect(gx+3,gy+42,9,24);
      ctx.fillStyle="#4e342e";ctx.beginPath();ctx.ellipse(gx-8,by-4,10,6,0,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.ellipse(gx+8,by-4,10,6,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#c62828";
      ctx.beginPath();ctx.moveTo(gx-16,gy+44);ctx.quadraticCurveTo(gx-18,gy+22,gx,gy+18);ctx.quadraticCurveTo(gx+18,gy+22,gx+16,gy+44);ctx.closePath();ctx.fill();
      ctx.fillStyle="#4e342e";ctx.fillRect(gx-14,gy+38,28,6);
      ctx.fillStyle="#ffd600";ctx.beginPath();ctx.roundRect(gx-5,gy+37,10,8,2);ctx.fill();
      ctx.fillStyle="#ffcc80";ctx.beginPath();ctx.arc(gx,gy+14,13,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#fff";
      ctx.beginPath();ctx.moveTo(gx-10,gy+18);ctx.quadraticCurveTo(gx,gy+28,gx+10,gy+18);ctx.quadraticCurveTo(gx,gy+34,gx-10,gy+18);ctx.fill();
      ctx.fillStyle="#333";ctx.beginPath();ctx.arc(gx-4,gy+12,2,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(gx+4,gy+12,2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#c62828";ctx.beginPath();ctx.moveTo(gx,gy-4);ctx.lineTo(gx-13,gy+4);ctx.lineTo(gx+13,gy+4);ctx.closePath();ctx.fill();
      ctx.fillStyle="#fff";ctx.beginPath();ctx.ellipse(gx,gy+4,15,5,0,0,Math.PI*2);ctx.fill();

    } else if (o.type === "cone") {
      ctx.fillStyle="rgba(0,0,0,0.15)";ctx.beginPath();ctx.ellipse(gx,by-3,22,6,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#f57c00";ctx.beginPath();ctx.moveTo(gx,by-o.obsHeight);ctx.lineTo(gx-22,by-5);ctx.lineTo(gx+22,by-5);ctx.closePath();ctx.fill();
      ctx.fillStyle="#fff";
      for(let s=0;s<2;s++){const sy2=by-o.obsHeight+(o.obsHeight*0.4)+s*(o.obsHeight*0.22);const sw=5+s*10;ctx.beginPath();ctx.moveTo(gx-sw,sy2);ctx.lineTo(gx+sw,sy2);ctx.lineTo(gx+sw+4,sy2+10);ctx.lineTo(gx-sw-4,sy2+10);ctx.closePath();ctx.fill();}
      ctx.fillStyle="#e65100";ctx.beginPath();ctx.roundRect(gx-24,by-8,48,8,2);ctx.fill();

    } else if (o.type === "newsbox") {
      const nw=46;const nh=o.obsHeight;
      ctx.fillStyle="#555";ctx.fillRect(gx-14,by-20,6,20);ctx.fillRect(gx+8,by-20,6,20);
      ctx.fillStyle="#1976d2";ctx.beginPath();ctx.roundRect(gx-nw/2,by-nh,nw,nh-14,5);ctx.fill();
      ctx.fillStyle="#bbdefb";ctx.beginPath();ctx.roundRect(gx-nw/2+4,by-nh+4,nw-8,nh-28,3);ctx.fill();
      ctx.fillStyle="#fff";ctx.beginPath();ctx.roundRect(gx-nw/2+6,by-nh+7,nw-12,nh-34,2);ctx.fill();
      ctx.fillStyle="#333";ctx.font="bold 8px Arial";ctx.textAlign="center";ctx.fillText("NEWS",gx,by-nh+16);
      ctx.fillStyle="#666";ctx.font="6px Arial";ctx.fillText("DAILY",gx,by-nh+24);
      ctx.fillStyle="#0d47a1";ctx.fillRect(gx-nw/2+6,by-nh+nh-22,nw-12,6);
      ctx.fillStyle="#1565c0";ctx.fillRect(gx-4,by-nh+nh-22,8,6);
    }
    ctx.restore();
  };

  // ── Hat drawing (local coords — called inside palm's save/rotate context) ──
  const drawHat = (ctx: CanvasRenderingContext2D, hatId: HatId) => {
    if (hatId === "none") return;
    ctx.save();
    if (hatId === "tophat") {
      // Brim
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath(); ctx.roundRect(-22, -30, 44, 7, 2); ctx.fill();
      // Crown
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.roundRect(-14, -30 - 34, 28, 34, 3); ctx.fill();
      // Band
      ctx.fillStyle = "#2ecc71";
      ctx.fillRect(-13, -30 - 12, 26, 7);
      // Shine
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath(); ctx.roundRect(-10, -30 - 32, 6, 30, 2); ctx.fill();

    } else if (hatId === "cap") {
      // Dome
      ctx.fillStyle = "#e74c3c";
      ctx.beginPath(); ctx.ellipse(0, -27, 21, 15, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-21, -27, 42, 8, [0,0,4,4]); ctx.fill();
      // Bill
      ctx.fillStyle = "#c0392b";
      ctx.beginPath(); ctx.ellipse(20, -24, 16, 6, 0.25, 0, Math.PI*2); ctx.fill();
      // Stitching line
      ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-18, -36); ctx.lineTo(0, -42); ctx.lineTo(18, -36); ctx.stroke();
      // Button
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, -42, 3, 0, Math.PI*2); ctx.fill();

    } else if (hatId === "crown") {
      // Crown body
      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.moveTo(-18, -26); ctx.lineTo(-18, -46); ctx.lineTo(-9, -37);
      ctx.lineTo(0, -51);   ctx.lineTo(9, -37);
      ctx.lineTo(18, -46);  ctx.lineTo(18, -26); ctx.closePath(); ctx.fill();
      // Outline
      ctx.strokeStyle = "#e6ac00"; ctx.lineWidth = 1.5; ctx.stroke();
      // Base band
      ctx.fillStyle = "#e6ac00";
      ctx.fillRect(-18, -30, 36, 6);
      // Gems
      ctx.fillStyle = "#e74c3c"; ctx.beginPath(); ctx.arc(0, -40, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#3498db"; ctx.beginPath(); ctx.arc(-12, -29, 3, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(12, -29, 3, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.beginPath(); ctx.arc(-0.5, -41.5, 1.5, 0, Math.PI*2); ctx.fill();

    } else if (hatId === "cowboy") {
      // Dome
      ctx.fillStyle = "#8B6914";
      ctx.beginPath(); ctx.ellipse(0, -30, 18, 16, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-18, -30, 36, 8, [0,0,4,4]); ctx.fill();
      // Wide brim
      ctx.fillStyle = "#7A5C0E";
      ctx.beginPath(); ctx.ellipse(0, -28, 32, 9, 0, 0, Math.PI*2); ctx.fill();
      // Brim curl up on sides
      ctx.fillStyle = "#8B6914";
      ctx.beginPath(); ctx.ellipse(-26, -26, 7, 5, -0.4, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(26, -26, 7, 5, 0.4, 0, Math.PI*2); ctx.fill();
      // Band
      ctx.fillStyle = "#8B0000"; ctx.fillRect(-17, -34, 34, 6);
      // Belt buckle
      ctx.fillStyle = "#ffd700"; ctx.beginPath(); ctx.roundRect(-4, -35, 8, 8, 1); ctx.fill();

    } else if (hatId === "viking") {
      // Helmet dome
      ctx.fillStyle = "#888";
      ctx.beginPath(); ctx.ellipse(0, -30, 20, 17, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#777"; ctx.beginPath(); ctx.roundRect(-20, -30, 40, 8, [0,0,4,4]); ctx.fill();
      // Nose guard
      ctx.fillStyle = "#777"; ctx.fillRect(-3, -30, 6, 14);
      // Rivets
      ctx.fillStyle = "#aaa";
      [-12, 0, 12].forEach(rx => { ctx.beginPath(); ctx.arc(rx, -32, 2.5, 0, Math.PI*2); ctx.fill(); });
      // Horns
      ctx.fillStyle = "#f0e8d0";
      ctx.beginPath(); ctx.moveTo(-19, -36); ctx.quadraticCurveTo(-36, -52, -28, -66); ctx.quadraticCurveTo(-20, -50, -12, -38); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(19, -36); ctx.quadraticCurveTo(36, -52, 28, -66); ctx.quadraticCurveTo(20, -50, 12, -38); ctx.closePath(); ctx.fill();
      // Horn tips
      ctx.fillStyle = "#d4c0a0";
      ctx.beginPath(); ctx.ellipse(-28, -66, 4, 3, 0.3, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(28, -66, 4, 3, -0.3, 0, Math.PI*2); ctx.fill();

    } else if (hatId === "beanie") {
      // Knit dome
      ctx.fillStyle = "#e8567a";
      ctx.beginPath(); ctx.ellipse(0, -26, 21, 16, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-21, -27, 42, 7, [0,0,3,3]); ctx.fill();
      // Folded brim
      ctx.fillStyle = "#c93f63"; ctx.beginPath(); ctx.roundRect(-23, -29, 46, 10, 5); ctx.fill();
      // Knit lines
      ctx.strokeStyle = "rgba(255,255,255,0.20)"; ctx.lineWidth = 1.5;
      for (let kx = -14; kx <= 14; kx += 7) { ctx.beginPath(); ctx.moveTo(kx, -27); ctx.lineTo(kx, -41); ctx.stroke(); }
      // Pom-pom
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, -45, 6, 0, Math.PI*2); ctx.fill();

    } else if (hatId === "party") {
      // Cone
      ctx.fillStyle = "#ff5ea8";
      ctx.beginPath(); ctx.moveTo(-16, -26); ctx.lineTo(0, -66); ctx.lineTo(16, -26); ctx.closePath(); ctx.fill();
      // Zigzag stripes
      ctx.strokeStyle = "#ffd700"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-12, -34); ctx.lineTo(12, -34); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-9, -44); ctx.lineTo(9, -44); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, -54); ctx.lineTo(6, -54); ctx.stroke();
      // Dots
      ctx.fillStyle = "#fff";
      [[-6,-30],[5,-40],[-2,-50]].forEach(([dx,dy]) => { ctx.beginPath(); ctx.arc(dx, dy, 2, 0, Math.PI*2); ctx.fill(); });
      // Pom-pom top
      ctx.fillStyle = "#4ee0ff"; ctx.beginPath(); ctx.arc(0, -66, 5, 0, Math.PI*2); ctx.fill();

    } else if (hatId === "wizard") {
      // Brim
      ctx.fillStyle = "#3b2a73"; ctx.beginPath(); ctx.ellipse(0, -26, 27, 8, 0, 0, Math.PI*2); ctx.fill();
      // Curved cone
      ctx.fillStyle = "#4b3699";
      ctx.beginPath(); ctx.moveTo(-18, -28); ctx.quadraticCurveTo(-6, -56, 4, -72);
      ctx.quadraticCurveTo(12, -52, 18, -28); ctx.closePath(); ctx.fill();
      // Band
      ctx.fillStyle = "#ffd700"; ctx.fillRect(-17, -33, 35, 5);
      // Stars (small diamonds)
      ctx.fillStyle = "#ffe066";
      [[-4,-42,3],[6,-54,2.4],[-8,-50,2]].forEach(([sx,sy,sr]) => {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.PI/4);
        ctx.fillRect(-sr, -sr, sr*2, sr*2); ctx.restore();
      });

    } else if (hatId === "propeller") {
      // Dome
      ctx.fillStyle = "#2d98da";
      ctx.beginPath(); ctx.ellipse(0, -27, 20, 15, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-20, -27, 40, 7, [0,0,3,3]); ctx.fill();
      // Colored panels
      ctx.fillStyle = "#f7b731"; ctx.beginPath(); ctx.moveTo(0, -42); ctx.lineTo(-20, -23); ctx.lineTo(-7, -23); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#eb3b5a"; ctx.beginPath(); ctx.moveTo(0, -42); ctx.lineTo(20, -23); ctx.lineTo(7, -23); ctx.closePath(); ctx.fill();
      // Propeller blades
      ctx.save(); ctx.translate(0, -46);
      ctx.fillStyle = "#eb3b5a"; ctx.beginPath(); ctx.ellipse(-13, 0, 13, 4, 0.25, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#20bf6b"; ctx.beginPath(); ctx.ellipse(13, 0, 13, 4, -0.25, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#f7b731"; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI*2); ctx.fill();
      ctx.restore();

    } else if (hatId === "halo") {
      // Glowing floating ring
      ctx.save();
      ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 5;
      ctx.shadowColor = "rgba(255,224,102,0.9)"; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.ellipse(0, -46, 16, 6, 0, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };

  // ── Collectible coin ───────────────────────────────────────────────────────
  const drawCoin = (ctx: CanvasRenderingContext2D, c: Coin, time: number) => {
    const bob = Math.sin(time * 0.12 + c.phase) * 3;
    // Spinning illusion — width oscillates to fake a flipping coin
    const w = COIN_R * Math.abs(Math.cos(time * 0.09 + c.phase)) + 3;
    ctx.save();
    ctx.translate(c.x, c.y + bob);
    ctx.shadowColor = "rgba(255,200,40,0.85)"; ctx.shadowBlur = 12;
    ctx.fillStyle = "#e0a700";
    ctx.beginPath(); ctx.ellipse(0, 0, w, COIN_R, 0, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffcf33";
    ctx.beginPath(); ctx.ellipse(0, 0, Math.max(1.5, w - 2.5), COIN_R - 2.5, 0, 0, Math.PI*2); ctx.fill();
    if (w > COIN_R * 0.6) {
      ctx.fillStyle = "#c98a00"; ctx.font = "bold 15px Arial";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("★", 0, 1);
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    }
    ctx.restore();
  };

  // ── Character drawing ──────────────────────────────────────────────────────
  // Skin / nail palette (shared across body + legs)
  const SKIN    = "#f2b079";
  const SKIN_D  = "#d88a4e";
  const SKIN_DD = "#b86c34";
  const SKIN_HI = "#ffd6a8";
  const NAIL    = "#fdeee2";
  const NAIL_D  = "#e6c2a8";

  // A single anatomically-readable finger used as a leg: proximal + distal
  // phalanges, a bulging knuckle joint with a crease, a fingertip pad and nail.
  const drawFingerLeg = (
    ctx: CanvasRenderingContext2D, hipX: number, hipY: number, swing: number, front: boolean,
  ) => {
    const seg1 = 30, seg2 = 30;
    const kneeX = hipX + Math.sin(swing) * seg1;
    const kneeY = hipY + Math.cos(swing) * seg1;
    const bend  = swing * 0.5 + (swing > 0 ? 0.34 : -0.12);
    const tipX  = kneeX + Math.sin(bend) * seg2;
    const tipY  = kneeY + Math.cos(bend) * seg2;
    const sk  = front ? SKIN : SKIN_D;
    const skd = front ? SKIN_D : SKIN_DD;

    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // proximal phalange (fat upper segment)
    ctx.strokeStyle = skd; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
    ctx.strokeStyle = sk;  ctx.lineWidth = 17; ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
    // knuckle joint bulge
    ctx.fillStyle = skd; ctx.beginPath(); ctx.arc(kneeX, kneeY, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = sk;  ctx.beginPath(); ctx.arc(kneeX, kneeY, 8.5, 0, Math.PI * 2); ctx.fill();
    // knuckle crease across the joint
    const ka = Math.atan2(kneeY - hipY, kneeX - hipX) + Math.PI / 2;
    ctx.strokeStyle = "rgba(150,80,40,0.40)"; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(kneeX + Math.cos(ka) * 7, kneeY + Math.sin(ka) * 7);
    ctx.lineTo(kneeX - Math.cos(ka) * 7, kneeY - Math.sin(ka) * 7);
    ctx.stroke();
    // distal phalange (tapering lower segment)
    ctx.strokeStyle = skd; ctx.lineWidth = 18; ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(tipX, tipY); ctx.stroke();
    ctx.strokeStyle = sk;  ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(tipX, tipY); ctx.stroke();
    // fingertip pad
    ctx.fillStyle = skd; ctx.beginPath(); ctx.arc(tipX, tipY, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = sk;  ctx.beginPath(); ctx.arc(tipX, tipY, 7, 0, Math.PI * 2); ctx.fill();
    // fingernail, oriented along the finger
    const nd = Math.atan2(tipY - kneeY, tipX - kneeX);
    ctx.save(); ctx.translate(tipX, tipY); ctx.rotate(nd - Math.PI / 2);
    ctx.fillStyle = NAIL_D; ctx.beginPath(); ctx.roundRect(-5.5, -10, 11, 11, 4); ctx.fill();
    ctx.fillStyle = NAIL;   ctx.beginPath(); ctx.roundRect(-4.5, -9, 9, 8.5, 3); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.beginPath(); ctx.roundRect(-3.5, -8.5, 3, 6, 2); ctx.fill();
    ctx.restore();
  };

  const drawFinger = (
    ctx: CanvasRenderingContext2D, playerY: number, time: number, _height: number,
    gameRunning: boolean, hatId: HatId, stretchX = 1, stretchY = 1,
    saber: Saber | null = null, saberSwing = 0,
  ) => {
    const cx = 185;
    const strideSpeed = gameRunning ? 0.26 : 0.05;
    const stride = Math.sin(time * strideSpeed);
    const bodyBob = gameRunning ? Math.abs(stride) * -6 : Math.sin(time * 0.05) * 2;
    const palmY = playerY + bodyBob;
    const footY = playerY + FINGER_TIP_OFFSET;

    // Ground shadow (drawn unscaled, shrinks as the hand rises for fake depth)
    const lift = Math.max(0, footY - (palmY + 64));
    const shScale = Math.max(0.5, 1 - lift * 0.004);
    ctx.fillStyle = `rgba(0,0,0,${0.20 * shScale})`;
    ctx.beginPath(); ctx.ellipse(cx, footY + 6, 34 * shScale, 7 * shScale, 0, 0, Math.PI * 2); ctx.fill();

    // Squash & stretch — scale the whole character around the foot contact point
    ctx.save();
    ctx.translate(cx, footY);
    ctx.scale(stretchX, stretchY);
    ctx.translate(-cx, -footY);

    const baseY = palmY + 22;
    const indexSwing  =  stride * 0.6;
    const middleSwing = -stride * 0.6;

    // Back leg (middle finger) first for depth
    drawFingerLeg(ctx, cx + 11, baseY, middleSwing, false);

    // ── Fist / hand body ──
    ctx.save();
    ctx.translate(cx, palmY);
    ctx.rotate(-0.06 + stride * 0.05);

    // main mass (back of a relaxed fist)
    ctx.fillStyle = SKIN_D;  ctx.beginPath(); ctx.roundRect(-34, -30, 68, 60, 20); ctx.fill();
    ctx.fillStyle = SKIN;    ctx.beginPath(); ctx.roundRect(-32, -30, 62, 55, 18); ctx.fill();
    // soft top highlight
    ctx.fillStyle = SKIN_HI; ctx.beginPath(); ctx.roundRect(-30, -30, 54, 15, [16, 16, 6, 6]); ctx.fill();

    // curled ring & pinky tucked along the right side
    ctx.strokeStyle = SKIN_D; ctx.lineCap = "round"; ctx.lineWidth = 13;
    ctx.beginPath(); ctx.arc(20, -8, 13, Math.PI * 1.15, Math.PI * 1.95); ctx.stroke();
    ctx.lineWidth = 11; ctx.beginPath(); ctx.arc(24, 8, 11, Math.PI * 1.1, Math.PI * 1.95); ctx.stroke();
    ctx.strokeStyle = "rgba(150,80,40,0.30)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(8, -16); ctx.lineTo(30, -12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(32, 6); ctx.stroke();

    // thumb wrapping across the lower-left front
    ctx.fillStyle = SKIN_D; ctx.beginPath(); ctx.ellipse(-30, 9, 13, 17, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SKIN;   ctx.beginPath(); ctx.ellipse(-31, 6, 9.5, 13, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(-37, -3); ctx.rotate(-0.55);
    ctx.fillStyle = NAIL_D; ctx.beginPath(); ctx.roundRect(-5, -7, 10, 11, 3); ctx.fill();
    ctx.fillStyle = NAIL;   ctx.beginPath(); ctx.roundRect(-4, -6, 8, 9, 2); ctx.fill();
    ctx.restore();

    // friendly eyes (gives the hand a face for its dialog)
    const blink = (Math.floor(time / 8) % 24 === 0) ? 0.15 : 1;
    const lookX = gameRunning ? 2.5 : 0;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(-10, -2, 7, 8 * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, -2, 7, 8 * blink, 0, 0, Math.PI * 2); ctx.fill();
    if (blink > 0.5) {
      ctx.fillStyle = "#2a2a2a";
      ctx.beginPath(); ctx.arc(-10 + lookX, -1, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(8 + lookX, -1, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(-11 + lookX, -2.5, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(7 + lookX, -2.5, 1.3, 0, Math.PI * 2); ctx.fill();
    }
    // determined eyebrows
    ctx.strokeStyle = SKIN_DD; ctx.lineWidth = 2.6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-16, -12); ctx.lineTo(-5, -10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16, -12); ctx.lineTo(5, -10); ctx.stroke();

    // hat (drawn in palm-local coords, sits on top)
    drawHat(ctx, hatId);
    ctx.restore();

    // Front leg (index finger) on top
    drawFingerLeg(ctx, cx - 11, baseY, indexSwing, true);

    // ── Lightsaber wielded by the front hand ──
    if (saber) {
      const pivotX = cx - 6;
      const pivotY = palmY + 12;
      // Idle: blade held up and forward with a gentle bob. Swing: sweep up→down-forward.
      let ang = -1.12 + Math.sin(time * 0.08) * 0.05;
      if (saberSwing > 0) {
        const p = 1 - saberSwing / SABER_SWING_FRAMES;     // 0 → 1 across the swing
        const ease = 1 - Math.pow(1 - p, 2);
        ang = -1.95 + ease * 2.55;                          // arc from overhead to down-forward
      }
      const hiltLen = 22;
      const bladeLen = saber.reach * 0.5;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const hiltBaseX = pivotX - dx * 7, hiltBaseY = pivotY - dy * 7;
      const emitX = pivotX + dx * hiltLen, emitY = pivotY + dy * hiltLen;
      const tipX = emitX + dx * bladeLen, tipY = emitY + dy * bladeLen;

      ctx.save();
      ctx.lineCap = "round";
      // swing trail
      if (saberSwing > 0) {
        ctx.globalAlpha = 0.18 * (saberSwing / SABER_SWING_FRAMES);
        ctx.strokeStyle = saber.glow; ctx.lineWidth = bladeLen * 0.7;
        ctx.beginPath();
        ctx.arc(pivotX, pivotY, hiltLen + bladeLen * 0.5, ang - 0.55, ang + 0.15);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // metal hilt
      ctx.strokeStyle = "#777"; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(hiltBaseX, hiltBaseY); ctx.lineTo(emitX, emitY); ctx.stroke();
      ctx.strokeStyle = "#cfcfcf"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(hiltBaseX, hiltBaseY); ctx.lineTo(emitX, emitY); ctx.stroke();
      ctx.fillStyle = "#3a3a3a"; ctx.beginPath(); ctx.arc(emitX, emitY, 3.4, 0, Math.PI * 2); ctx.fill();
      // glowing blade
      ctx.shadowColor = saber.glow; ctx.shadowBlur = 18;
      ctx.strokeStyle = saber.glow; ctx.lineWidth = 11;
      ctx.beginPath(); ctx.moveTo(emitX, emitY); ctx.lineTo(tipX, tipY); ctx.stroke();
      ctx.strokeStyle = saber.color; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(emitX, emitY); ctx.lineTo(tipX, tipY); ctx.stroke();
      // white-hot core
      ctx.shadowBlur = 9;
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(emitX, emitY); ctx.lineTo(tipX, tipY); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    ctx.restore();
  };

  // ── Speech bubble for in-game dialog ───────────────────────────────────────
  const drawSpeechBubble = (ctx: CanvasRenderingContext2D, x: number, y: number, text: string, alpha: number) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    const AF = "'Press Start 2P', 'Courier New', monospace";
    ctx.font = `11px ${AF}`;
    const w = Math.min(340, ctx.measureText(text).width + 28);
    const h = 36;
    const bx = x - w / 2; const by = y - h;
    ctx.fillStyle = "#000012";
    ctx.beginPath(); ctx.roundRect(bx, by, w, h, 3); ctx.fill();
    ctx.shadowColor = "#00ffcc"; ctx.shadowBlur = 10;
    ctx.strokeStyle = "#00ffcc"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(bx, by, w, h, 3); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#000012";
    ctx.beginPath(); ctx.moveTo(x - 7, by + h - 1); ctx.lineTo(x + 7, by + h - 1); ctx.lineTo(x, by + h + 11); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#00ffcc"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - 7, by + h - 1); ctx.lineTo(x, by + h + 11); ctx.lineTo(x + 7, by + h - 1); ctx.stroke();
    ctx.fillStyle = "#00ffcc"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, x, by + h / 2);
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  };

  // ── Main game loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        if (e.repeat) return; // ignore OS key-repeat so holding doesn't burn the double jump
        jump();
      } else if (e.code === "KeyF" || e.code === "KeyJ" || e.code === "ArrowDown"
                 || e.code === "ShiftLeft" || e.code === "ShiftRight") {
        e.preventDefault();
        if (e.repeat) return;
        slash();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); releaseJump(); }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);

    const loop = () => {
      const st = stateRef.current;
      const width = canvas.width; const height = canvas.height;
      const groundY = getGroundY(height);
      const roadY = height - ROAD_SURFACE_OFFSET;
      const lvlDef = getLevelDef(st.currentLevel);
      const theme = lvlDef.theme;

      if (st.gameRunning) {
        st.time++;
        const scoreGain = 0.6;
        st.levelScore += scoreGain;
        st.totalScore += scoreGain;

        // Check level completion
        if (st.levelScore >= lvlDef.target) {
          levelComplete();
        }

        // Saber swing / cooldown timers
        if (st.saberSwing > 0) st.saberSwing--;
        if (st.saberCooldown > 0) st.saberCooldown--;

        // Physics — variable jump height + snappy fall
        let g = GRAVITY;
        if (st.velocity < 0 && !st.jumpHeld) g *= LOW_JUMP_GRAVITY_MULT;
        else if (st.velocity > 0) g *= FALL_GRAVITY_MULT;
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

        // Dialog — periodic quirky one-liners while running
        if (st.dialog && st.dialog.life > 0) st.dialog.life--;
        st.dialogCooldown--;
        if (st.dialogCooldown <= 0 && (!st.dialog || st.dialog.life <= 0)) {
          showDialog(pick(RUN_QUIPS), 130);
          st.dialogCooldown = 260 + Math.floor(Math.random() * 220);
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
            st.coins.push({ x: width + 40 + k * 40, y: baseY, phase: Math.random() * Math.PI * 2 });
          }
        }

        // Obstacles + collision
        const fingerLeft = 168; const fingerRight = 202;
        const fingerTipY = st.playerY + FINGER_TIP_OFFSET - 8;
        const speed = (BASE_SPEED * lvlDef.speedMult + st.levelScore * 0.001) * kidsSpeedMult;
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
          if (st.saberSwing > 0 && !didCrash
              && o.x + o.obsWidth >= fingerLeft - 6 && o.x <= fingerRight + saberReach
              && fingerHigh <= roadY && fingerTipY + vReach >= obsTopSlice) {
            sliceObstacle(o, roadY);
            st.obstacles.splice(i, 1);
            continue;
          }
          if (!didCrash) {
            const obsTop = roadY - o.obsHeight;
            if (fingerRight > o.x && fingerLeft < o.x + o.obsWidth && fingerTipY > obsTop) {
              crash(); didCrash = true;
            }
          }
          if (!o.passed && o.x + o.obsWidth * 0.55 < fingerLeft) o.passed = true;
          if (o.x < -150) st.obstacles.splice(i, 1);
        }

        // Coins — move, collect on overlap with the finger
        const coinTop = st.playerY - 18;
        const coinBottom = st.playerY + FINGER_TIP_OFFSET;
        for (let i = st.coins.length - 1; i >= 0; i--) {
          const c = st.coins[i];
          c.x -= speed;
          if (c.x + COIN_R > 156 && c.x - COIN_R < 214 && c.y + COIN_R > coinTop && c.y - COIN_R < coinBottom) {
            st.coinBalance++;
            setCoinsLS(st.coinBalance);
            playCoinSound();
            for (let s = 0; s < 8; s++) {
              const a = Math.random() * Math.PI * 2; const sp = 2 + Math.random() * 3;
              st.particles.push({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2,
                life: 22 + Math.random() * 12, size: 3 + Math.random() * 4, color: "#ffe27a", shape: "circle" });
            }
            st.coins.splice(i, 1);
            continue;
          }
          if (c.x < -40) st.coins.splice(i, 1);
        }

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
            if (Math.random() < 0.7) showDialog(pick(JUMP_QUIPS), 70);
          }
        }

        // ── Scrolling ropes: move, detect grab ──────────────────────────────────
        for (let i = st.ropes.length - 1; i >= 0; i--) {
          const rope = st.ropes[i];
          rope.x -= speed;
          if (!st.activeSwing && !st.onGround) {
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
          st.ropes.push({ x: width + 90, anchorY: 70 + Math.floor(Math.random() * 90), length: 210 + Math.floor(Math.random() * 100) });
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
        if (st.platformTimer > 450 + Math.floor(Math.random() * 180)) {
          st.platformTimer = 0;
          st.platforms.push({ x: width + 60, y: roadY - 130 - Math.floor(Math.random() * 100), w: 100 + Math.floor(Math.random() * 110) });
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
        const scrollSpeed = BASE_SPEED * lvlDef.speedMult + st.levelScore * 0.001;
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

      // ── Draw ────────────────────────────────────────────────────────────────
      drawBackground(ctx, width, height, st.time, theme);

      // Screen shake — applied to the foreground only (background already fills the canvas)
      ctx.save();
      if (st.shake > 0) {
        ctx.translate((Math.random() - 0.5) * st.shake, (Math.random() - 0.5) * st.shake);
      }

      // Blood puddles (behind obstacles and character)
      for (const bp of st.bloodPuddles) {
        const alpha = Math.min(0.82, (bp.life / bp.maxLife) * 0.82);
        ctx.globalAlpha = alpha;
        const pg = ctx.createRadialGradient(bp.x, bp.y, 0, bp.x, bp.y, bp.rx);
        pg.addColorStop(0, "#8B0000"); pg.addColorStop(0.6, "#6B0000"); pg.addColorStop(1, "rgba(50,0,0,0)");
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.ellipse(bp.x, bp.y, bp.rx, bp.ry, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (const o of st.obstacles) drawObstacle(ctx, o, height);

      // Draw floating platforms — neon electric style
      ctx.save();
      for (const plat of st.platforms) {
        const pw = plat.w;
        ctx.fillStyle = "#001428";
        ctx.beginPath(); ctx.roundRect(plat.x, plat.y, pw, 16, [3, 3, 2, 2]); ctx.fill();
        ctx.shadowColor = "#00ccff"; ctx.shadowBlur = 14;
        ctx.fillStyle = "#00aaff";
        ctx.beginPath(); ctx.roundRect(plat.x, plat.y, pw, 5, [3, 3, 0, 0]); ctx.fill();
        ctx.strokeStyle = "#00ccff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(plat.x, plat.y, pw, 16, [3, 3, 2, 2]); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#005588";
        for (let px2 = plat.x + 8; px2 < plat.x + pw - 8; px2 += 16) {
          ctx.fillRect(px2, plat.y + 7, 8, 2);
          ctx.fillRect(px2, plat.y + 11, 8, 2);
        }
      }
      ctx.restore();

      // Draw ropes — electric neon style
      ctx.save();
      ctx.lineCap = "round";
      const drawRopeVisual = (ax: number, ay: number, ex: number, ey: number) => {
        // Anchor beam
        ctx.fillStyle = "#1a0a00";
        ctx.beginPath(); ctx.roundRect(ax - 22, ay - 10, 44, 14, 3); ctx.fill();
        ctx.shadowColor = "#ffaa00"; ctx.shadowBlur = 10;
        ctx.strokeStyle = "#ffaa00"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(ax - 22, ay - 10, 44, 14, 3); ctx.stroke();
        ctx.shadowBlur = 0;
        // Rope glow (outer)
        ctx.shadowColor = "#ffee00"; ctx.shadowBlur = 18;
        ctx.strokeStyle = "#aa6600"; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(ax, ay + 4); ctx.lineTo(ex, ey); ctx.stroke();
        // Rope bright core
        ctx.strokeStyle = "#ffdd00"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(ax, ay + 4); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.shadowBlur = 0;
        // White gleam
        ctx.strokeStyle = "rgba(255,255,200,0.6)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ax + 1, ay + 4); ctx.lineTo(ex + 1, ey); ctx.stroke();
        // Grab knot
        ctx.shadowColor = "#ffee00"; ctx.shadowBlur = 16;
        ctx.fillStyle = "#884400"; ctx.beginPath(); ctx.arc(ex, ey, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffcc00"; ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffee88"; ctx.beginPath(); ctx.arc(ex - 2, ey - 2, 3, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      };
      for (const rope of st.ropes) {
        drawRopeVisual(rope.x, rope.anchorY, rope.x, rope.anchorY + rope.length);
      }
      if (st.activeSwing) {
        const sw = st.activeSwing;
        // Draw from anchor to player grip (top of character body)
        drawRopeVisual(sw.anchorX, sw.anchorY, 185, st.playerY + 10);
      }
      ctx.restore();

      // Collectible coins
      for (const c of st.coins) drawCoin(ctx, c, st.time);

      // Particles — drawn by shape
      ctx.shadowBlur = 0;
      for (const p of st.particles) {
        const alpha = Math.max(0.08, p.life / 70);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        if (p.shape === "circle") {
          ctx.beginPath(); ctx.arc(p.x, p.y, (p.size||6)/2, 0, Math.PI*2); ctx.fill();
        } else if (p.shape === "bone") {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
          const r = (p.size||6)/2;
          ctx.fillRect(-r, -r*0.35, r*2, r*0.7);
          ctx.beginPath(); ctx.arc(-r, 0, r*0.5, 0, Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.arc( r, 0, r*0.5, 0, Math.PI*2); ctx.fill();
          ctx.restore();
        } else {
          ctx.fillRect(p.x, p.y, p.size||6, p.size||6);
        }
      }
      ctx.globalAlpha = 1;

      // Read hat from localStorage each frame so it updates live
      const hat = (localStorage.getItem("fingerRunnerHat") || "none") as HatId;
      // Squash & stretch from vertical motion / landing impact
      let stretchY = 1, stretchX = 1;
      if (st.gameRunning && !st.onGround) {
        stretchY = 1 + Math.max(-0.10, Math.min(0.16, -st.velocity * 0.011));
        stretchX = 1 - (stretchY - 1) * 0.55;
      }
      if (st.landImpact > 0) {
        const k = st.landImpact / 10;
        stretchY = 1 - 0.26 * k;
        stretchX = 1 + 0.26 * k;
      }
      const saberDefRender = getSaberDef(getSaberLevel());
      drawFinger(ctx, st.playerY, st.time, height, st.gameRunning, hat, stretchX, stretchY, saberDefRender, st.saberSwing);

      // Dialog speech bubble above the character
      if (st.dialog && st.dialog.life > 0) {
        const d = st.dialog;
        const fadeIn = Math.min(1, (d.maxLife - d.life) / 8);
        const fadeOut = Math.min(1, d.life / 20);
        const bubbleY = st.playerY - 120 + Math.sin(st.time * 0.1) * 2;
        drawSpeechBubble(ctx, 185, bubbleY, d.text, Math.min(fadeIn, fadeOut));
      }

      ctx.restore(); // end screen shake

      // HUD — retro arcade style
      const AF = "'Press Start 2P', 'Courier New', monospace";
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";

      // Score (6-digit zero-padded)
      ctx.shadowColor = "#00ffff"; ctx.shadowBlur = 16;
      ctx.fillStyle = "#00ffff"; ctx.font = `bold 44px ${AF}`;
      ctx.fillText(String(Math.floor(st.levelScore)).padStart(6, "0"), 20, 68);
      ctx.shadowBlur = 0;

      // Best score
      ctx.shadowColor = "#ff00ff"; ctx.shadowBlur = 10;
      ctx.fillStyle = "#ff00ff"; ctx.font = `10px ${AF}`;
      ctx.fillText("BEST " + st.bestScore, 22, 90);
      ctx.shadowBlur = 0;

      // Coin counter (top-right)
      ctx.textAlign = "right";
      ctx.shadowColor = "#ffee00"; ctx.shadowBlur = 12;
      ctx.fillStyle = "#ffee00"; ctx.font = `11px ${AF}`;
      ctx.fillText("\u2605 " + st.coinBalance, width - 20, 90);
      ctx.shadowBlur = 0; ctx.textAlign = "left";

      // Level pill
      const lvlText = `LV${st.currentLevel}`;
      ctx.font = `10px ${AF}`;
      const lvlW = ctx.measureText(lvlText).width + 22;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.strokeStyle = "#00ffcc"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(20, 102, lvlW, 22, 3); ctx.fill(); ctx.stroke();
      ctx.shadowColor = "#00ffcc"; ctx.shadowBlur = 8;
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

      // Game over panel — GAME OVER arcade style
      if (!st.gameRunning && !st.levelComplete && st.totalScore > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.88)";
        ctx.strokeStyle = "#ff0044"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(width/2-220, height/2-148, 440, 296, 4); ctx.fill();
        ctx.shadowColor = "#ff0044"; ctx.shadowBlur = 24; ctx.stroke(); ctx.shadowBlur = 0;
        ctx.shadowColor = "#ff0044"; ctx.shadowBlur = 20;
        ctx.fillStyle = "#ff0044"; ctx.textAlign = "center";
        ctx.font = `24px ${AF}`; ctx.fillText("GAME OVER", width/2, height/2 - 86);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#00ffcc"; ctx.font = `10px ${AF}`;
        ctx.fillText(`LEVEL ${st.currentLevel}`, width/2, height/2 - 48);
        ctx.fillStyle = "#ffffff"; ctx.font = `10px ${AF}`;
        ctx.fillText(`${Math.floor(st.levelScore)} / ${lvlDef.target} m`, width/2, height/2 - 24);
        ctx.fillStyle = "#555555"; ctx.font = `9px ${AF}`;
        ctx.fillText(`TOTAL: ${Math.floor(st.totalScore)} m`, width/2, height/2 + 6);
        if (Math.floor(st.totalScore) >= st.bestScore && st.totalScore > 5) {
          ctx.shadowColor = "#ffee00"; ctx.shadowBlur = 16;
          ctx.fillStyle = "#ffee00"; ctx.font = `10px ${AF}`;
          ctx.fillText("\u2605 NEW RECORD \u2605", width/2, height/2 + 46);
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = "#444444"; ctx.font = `8px ${AF}`;
        ctx.fillText("PRESS SPACE TO RETRY", width/2, height/2 + 106);
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
    setTimeout(() => { if (audioRef.current.enabled) startMusic(false); }, 650);

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
  const handleToggleMusic = () => {
    const newVal = !audioRef.current.enabled;
    audioRef.current.enabled = newVal; setMusicOn(newVal);
    if (newVal) startMusic(stateRef.current.gameRunning); else stopMusic();
  };
  const handleEquipHat = (id: HatId) => {
    setEquippedHat(id); setEquippedHatState(id);
  };
  const handleBuyOutfit = (hat: typeof HATS[number]) => {
    const cost = hat.cost ?? 0;
    if (getCoins() < cost || getOwnedOutfits().includes(hat.id)) return;
    const newBal = getCoins() - cost;
    setCoinsLS(newBal); setCoinBalanceState(newBal);
    stateRef.current.coinBalance = newBal;
    const owned = getOwnedOutfits();
    owned.push(hat.id); setOwnedOutfits(owned); setOwnedState([...owned]);
    // Auto-equip the freshly bought outfit
    setEquippedHat(hat.id); setEquippedHatState(hat.id);
  };
  const handleUpgradeSaber = () => {
    const cur = getSaberLevel();
    if (cur >= SABERS.length) return;
    const next = getSaberDef(cur + 1);
    if (getCoins() < next.cost) return;
    const newBal = getCoins() - next.cost;
    setCoinsLS(newBal); setCoinBalanceState(newBal); stateRef.current.coinBalance = newBal;
    setSaberLevelLS(next.tier); setSaberLevelState(next.tier);
  };
  const handleToggleKids = () => {
    const v = !getKidsMode();
    setKidsModeLS(v); setKidsModeState(v); stateRef.current.kidsMode = v;
  };
  const openWardrobe = () => {
    setCoinBalanceState(getCoins());
    setOwnedState(getOwnedOutfits());
    setSaberLevelState(getSaberLevel());
    setScreen("wardrobe");
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

  return (
    <div style={{ position:"relative", width:"100vw", height:"100vh", overflow:"hidden", background:"#000008", touchAction:"none" }}>
      <canvas ref={canvasRef} style={{ display:"block" }} onPointerDown={handleCanvasClick}
        onPointerUp={() => releaseJump()} onPointerLeave={() => releaseJump()} onPointerCancel={() => releaseJump()} />
      <div className="arcade-vignette" />
      <div className="arcade-scanlines" />

      {/* ── Start screen ── */}
      {screen === "start" && (
        <div style={{ ...overlay, background:"rgba(0,0,0,0.82)" }}>
          <div className="arcade-neon-pulse" style={{ fontFamily:retroFont, fontSize:"1.7rem", color:"#ffee00", marginBottom:8, letterSpacing:"0.04em", textAlign:"center", textShadow:"0 0 12px #ffee00, 0 0 30px #ff8800" }}>
            👆 FINGER RUNNER
          </div>
          <p style={{ fontSize:"0.58rem", fontFamily:retroFont, margin:"8px auto 4px", maxWidth:500, lineHeight:2.5, color:"#00ffcc", textShadow:"0 0 8px #00ffcc", textAlign:"center" }}>
            {STORY_INTRO}
          </p>
          <p style={{ fontSize:"0.54rem", fontFamily:retroFont, margin:"2px 0 0", color:"#ff88ff", lineHeight:2.5, letterSpacing:"0.03em", textShadow:"0 0 8px #ff88ff", textAlign:"center" }}>
            TAP / SPACE TO JUMP · DOUBLE TAP = DOUBLE JUMP
          </p>
          <p style={{ fontSize:"0.54rem", fontFamily:retroFont, margin:"2px 0 0", color:"#ff5555", lineHeight:2.5, letterSpacing:"0.03em", textShadow:"0 0 8px #ff5555", textAlign:"center" }}>
            ⚔ SLASH BUTTON / F TO SWING THE LIGHTSABER
          </p>
          <p style={{ fontSize:"0.52rem", fontFamily:retroFont, margin:"0 0 4px", color:"#555", lineHeight:2.5, textAlign:"center" }}>
            {HATS.filter(h=>h.id!=="none"&&isHatUnlocked(h, ownedOutfits)).map(h=>h.emoji).join(" ")||"🤚"} outfits unlocked · collect ★ coins
          </p>
          <div style={{ display:"flex", gap:16, marginTop:20 }}>
            <button onClick={() => startLevel(1)} className="retro-btn"
              style={{ padding:"14px 30px", fontSize:"0.78rem", fontFamily:retroFont,
                background:"transparent", color:"#ff4444",
                border:"3px solid #ff4444",
                boxShadow:"0 0 14px #ff4444, inset 0 0 14px rgba(255,68,68,0.08)",
                cursor:"pointer", letterSpacing:"0.05em", lineHeight:1.8 }}>
              ▶ START
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
          {kidsMode && (
            <p style={{ fontSize:"0.5rem", fontFamily:retroFont, margin:"8px 0 0", color:"#00ff88aa", lineHeight:2.2, textAlign:"center" }}>
              SLOWER · MORE SPACE · FLOATIER JUMPS · FASTER SABER
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
        <div style={{ ...overlay, background:"rgba(0,0,10,0.94)" }}>
          <div style={{ background:"rgba(0,255,204,0.03)", border:"2px solid #00ffcc44", boxShadow:"0 0 30px rgba(0,255,204,0.12)", borderRadius:3, padding:"26px 32px", maxWidth:540, width:"90%" }}>
            <h2 style={{ fontSize:"0.85rem", margin:"0 0 6px 0", color:"#00ffcc", textAlign:"center", fontFamily:retroFont, textShadow:"0 0 12px #00ffcc", letterSpacing:"0.06em" }}>WARDROBE</h2>
            <p style={{ color:"#555", textAlign:"center", margin:"0 0 12px 0", fontFamily:font, fontSize:"0.75rem" }}>Level up or spend ★ coins to unlock outfits</p>
            <div style={{ textAlign:"center", margin:"0 0 14px 0" }}>
              <span style={{ display:"inline-block", background:"rgba(255,238,0,0.08)", border:"2px solid #ffee00",
                boxShadow:"0 0 10px rgba(255,238,0,0.25)", borderRadius:2, padding:"5px 16px", fontSize:"0.72rem", fontFamily:retroFont, color:"#ffee00" }}>
                ★ {coinBalance} COINS
              </span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9, maxHeight:"50vh", overflowY:"auto" }}>
              {HATS.map(hat => {
                const owned = isHatUnlocked(hat, ownedOutfits);
                const isCoin = hat.cost != null;
                const equipped = equippedHat === hat.id;
                const affordable = coinBalance >= (hat.cost ?? 0);
                const subtitle = isCoin
                  ? (owned ? "Owned" : `Buy: ★ ${hat.cost}`)
                  : (hat.unlockLevel === 0 ? "Always available" : `Unlock: Level ${hat.unlockLevel}`);
                return (
                  <div key={hat.id}
                    style={{ background: equipped ? "rgba(0,255,204,0.07)" : "rgba(255,255,255,0.02)",
                      border: `2px solid ${equipped ? "#00ffcc" : owned ? "#333" : "#222"}`,
                      boxShadow: equipped ? "0 0 10px rgba(0,255,204,0.22)" : "none",
                      borderRadius:3, padding:"11px 13px", display:"flex", alignItems:"center", gap:10,
                      opacity: owned ? 1 : 0.55 }}>
                    <span style={{ fontSize:"1.8rem" }}>{hat.emoji}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:"bold", fontSize:"0.62rem", fontFamily:retroFont, color:"#fff", lineHeight:1.9 }}>{hat.name}</div>
                      <div style={{ fontSize:"0.6rem", color:"#555", fontFamily:font }}>{subtitle}</div>
                    </div>
                    {owned ? (
                      <button onClick={() => handleEquipHat(hat.id)} className="retro-btn"
                        style={{ padding:"5px 10px", fontSize:"0.58rem", fontFamily:retroFont,
                          background: equipped ? "rgba(0,255,204,0.18)" : "transparent",
                          color: equipped ? "#00ffcc" : "#777",
                          border:`2px solid ${equipped ? "#00ffcc" : "#444"}`,
                          boxShadow: equipped ? "0 0 8px rgba(0,255,204,0.35)" : "none",
                          cursor:"pointer", lineHeight:2 }}>
                        {equipped ? "✓ ON" : "EQUIP"}
                      </button>
                    ) : isCoin ? (
                      <button onClick={() => affordable && handleBuyOutfit(hat)} className={affordable ? "retro-btn" : undefined}
                        disabled={!affordable}
                        style={{ padding:"5px 10px", fontSize:"0.58rem", fontFamily:retroFont,
                          background: affordable ? "rgba(255,238,0,0.12)" : "transparent",
                          color: affordable ? "#ffee00" : "#444",
                          border:`2px solid ${affordable ? "#ffee00" : "#333"}`,
                          boxShadow: affordable ? "0 0 8px rgba(255,238,0,0.25)" : "none",
                          cursor: affordable ? "pointer" : "not-allowed", lineHeight:2 }}>
                        ★ {hat.cost}
                      </button>
                    ) : (
                      <span style={{ fontSize:"0.52rem", color:"#444", fontFamily:retroFont, lineHeight:2 }}>🔒 LV{hat.unlockLevel}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Lightsaber upgrades */}
            <h3 style={{ fontSize:"0.7rem", margin:"18px 0 4px 0", color:"#ff5555", textAlign:"center", fontFamily:retroFont, textShadow:"0 0 10px #ff5555", letterSpacing:"0.06em" }}>⚔ LIGHTSABER</h3>
            <p style={{ color:"#555", textAlign:"center", margin:"0 0 10px 0", fontFamily:font, fontSize:"0.72rem" }}>Slash obstacles mid-run — upgrade for a longer, brighter blade</p>
            <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
              {SABERS.map(s => {
                const owned = saberLevel >= s.tier;
                const equipped = saberLevel === s.tier;
                const isNext = s.tier === saberLevel + 1;
                const affordable = coinBalance >= s.cost;
                return (
                  <div key={s.tier}
                    style={{ width:96, background: equipped ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.015)",
                      border:`2px solid ${equipped ? s.color : owned ? "#333" : isNext ? s.color+"88" : "#222"}`,
                      boxShadow: equipped ? `0 0 12px ${s.color}66` : "none",
                      borderRadius:3, padding:"10px 6px", display:"flex", flexDirection:"column", alignItems:"center", gap:6,
                      opacity: owned || isNext ? 1 : 0.45 }}>
                    {/* blade preview */}
                    <div style={{ width:5, height:38, borderRadius:3, background:s.color,
                      boxShadow:`0 0 10px ${s.glow}, 0 0 18px ${s.glow}` }} />
                    <div style={{ fontSize:"0.46rem", fontFamily:retroFont, color:"#ccc", lineHeight:1.8, textAlign:"center" }}>{s.name.replace(" Saber","")}</div>
                    {equipped ? (
                      <span style={{ fontSize:"0.46rem", fontFamily:retroFont, color:s.color, lineHeight:1.8 }}>✓ ACTIVE</span>
                    ) : owned ? (
                      <span style={{ fontSize:"0.46rem", fontFamily:retroFont, color:"#666", lineHeight:1.8 }}>OWNED</span>
                    ) : isNext ? (
                      <button onClick={() => affordable && handleUpgradeSaber()} className={affordable ? "retro-btn" : undefined}
                        disabled={!affordable}
                        style={{ padding:"4px 8px", fontSize:"0.46rem", fontFamily:retroFont,
                          background: affordable ? "rgba(255,238,0,0.12)" : "transparent",
                          color: affordable ? "#ffee00" : "#444",
                          border:`2px solid ${affordable ? "#ffee00" : "#333"}`,
                          cursor: affordable ? "pointer" : "not-allowed", lineHeight:1.8 }}>
                        ★ {s.cost}
                      </button>
                    ) : (
                      <span style={{ fontSize:"0.5rem", fontFamily:retroFont, color:"#444", lineHeight:1.8 }}>🔒</span>
                    )}
                  </div>
                );
              })}
            </div>
            <button onClick={() => setScreen("start")} className="retro-btn"
              style={{ marginTop:18, width:"100%", padding:"11px", fontSize:"0.66rem", fontFamily:retroFont,
                background:"transparent", color:"#444", border:"2px solid #333", cursor:"pointer", letterSpacing:"0.05em" }}>
              ← BACK
            </button>
          </div>
        </div>
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
            {unlockedHat && (
              <div style={{ background:"rgba(170,68,255,0.10)", border:"2px solid #aa44ff", boxShadow:"0 0 14px rgba(170,68,255,0.28)", borderRadius:3, padding:"10px 16px", marginBottom:16 }}>
                <div style={{ fontSize:"0.58rem", color:"#cc88ff", fontFamily:retroFont, lineHeight:2.2 }}>NEW UNLOCK!</div>
                <div style={{ fontSize:"1.8rem" }}>{unlockedHat.emoji}</div>
                <div style={{ fontSize:"0.62rem", fontFamily:retroFont, color:"#fff", lineHeight:2.2 }}>{unlockedHat.name}</div>
                <button onClick={() => handleEquipHat(unlockedHat.id)} className="retro-btn"
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
              <button onClick={() => setScreen("start")} className="retro-btn"
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
        const s = getSaberDef(saberLevel);
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
