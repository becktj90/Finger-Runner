import { useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
type ObstacleType = "mailbox"|"hydrant"|"stopsign"|"trashcan"|"dog"|"cat"|"bicycle"|"gnome"|"cone"|"newsbox";
type Theme = "suburb"|"city"|"highway"|"mountain"|"night";
type HatId = "none"|"tophat"|"cap"|"crown"|"cowboy"|"viking"|"beanie"|"party"|"wizard"|"propeller"|"halo";

interface Obstacle { x: number; obsWidth: number; obsHeight: number; type: ObstacleType; passed: boolean; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number; color: string; shape?: "rect"|"circle"|"bone"; rot?: number; rotV?: number; }
interface BloodPuddle { x: number; y: number; rx: number; ry: number; life: number; maxLife: number; }
interface Coin { x: number; y: number; phase: number; }

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
  const drawCloud = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) => {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.arc(20, 4, 22, 0, Math.PI * 2);
    ctx.arc(44, 2, 16, 0, Math.PI * 2);
    ctx.arc(22, -12, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const drawBackground = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, theme: Theme) => {
    // Sky gradient per theme
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    if (theme === "suburb") {
      grad.addColorStop(0, "#5db8f0"); grad.addColorStop(0.45, "#8ed0ff"); grad.addColorStop(1, "#c8e8ff");
    } else if (theme === "city") {
      grad.addColorStop(0, "#7a9bbf"); grad.addColorStop(0.5, "#a0b8cc"); grad.addColorStop(1, "#c4d4df");
    } else if (theme === "highway") {
      grad.addColorStop(0, "#3a90d8"); grad.addColorStop(0.4, "#6ab8f0"); grad.addColorStop(1, "#b8dcf4");
    } else if (theme === "mountain") {
      grad.addColorStop(0, "#6ab5e8"); grad.addColorStop(0.4, "#9ad0f0"); grad.addColorStop(1, "#d0eaf8");
    } else { // night
      grad.addColorStop(0, "#0a0a22"); grad.addColorStop(0.5, "#1a1a40"); grad.addColorStop(1, "#2a2a55");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Parallax clouds (daytime themes) — slow far drift for depth
    if (theme !== "night") {
      const span = width + 260;
      for (let c = 0; c < 5; c++) {
        const scale = 0.7 + (c % 3) * 0.45;
        const cx2 = ((c * 360 - time * (0.25 + scale * 0.18)) % span + span) % span - 130;
        const cy2 = 48 + (c % 3) * 52 + (c % 2) * 14;
        drawCloud(ctx, cx2, cy2, scale);
      }
    }

    if (theme === "night") {
      // Stars
      ctx.fillStyle = "#fff";
      for (let s = 0; s < 80; s++) {
        const sx = ((s * 173 + time * 0.2) % width + width) % width;
        const sy = (s * 137) % (height * 0.55);
        const ss = s % 3 === 0 ? 2 : 1;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 0.02 + s);
        ctx.fillRect(sx, sy, ss, ss);
      }
      ctx.globalAlpha = 1;
      // Distant city glow
      ctx.fillStyle = "rgba(255,140,0,0.12)";
      ctx.beginPath(); ctx.ellipse(width*0.3, height*0.65, 200, 60, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "rgba(255,160,30,0.08)";
      ctx.beginPath(); ctx.ellipse(width*0.72, height*0.68, 150, 45, 0, 0, Math.PI*2); ctx.fill();
      // City skyline silhouette
      ctx.fillStyle = "#111128";
      const buildings = [0.05,0.12,0.18,0.24,0.32,0.38,0.44,0.52,0.58,0.64,0.70,0.78,0.85,0.92];
      const bHeights = [90,140,80,120,100,160,70,130,90,150,110,80,140,100];
      const bWidths  = [40,30,50,35,45,25,55,38,42,28,48,52,32,44];
      buildings.forEach((bx, i) => {
        const bh = bHeights[i]; const bw = bWidths[i];
        ctx.fillRect(bx*width, height-108-bh, bw, bh);
        // Windows
        ctx.fillStyle = "rgba(255,220,80,0.6)";
        for (let wx = 4; wx < bw-4; wx += 10) {
          for (let wy = 8; wy < bh-10; wy += 14) {
            if (Math.random() > 0.3) ctx.fillRect(bx*width+wx, height-108-bh+wy, 6, 8);
          }
        }
        ctx.fillStyle = "#111128";
      });
    } else if (theme === "city") {
      // Building silhouettes
      ctx.fillStyle = "#5a6878";
      const cfgs = [[0.02,50,55],[0.1,80,38],[0.17,45,60],[0.25,100,30],[0.33,65,48],[0.42,55,40],[0.5,90,35],[0.58,70,45],[0.65,48,55],[0.72,85,32],[0.8,60,50],[0.88,45,62],[0.94,75,38]];
      cfgs.forEach(([bx,bh,bw]) => {
        ctx.fillRect(bx*width, height-108-bh, bw, bh);
      });
      ctx.fillStyle = "#6a7888";
      const cfgs2 = [[0.06,35,40],[0.15,60,28],[0.22,30,48],[0.3,75,25],[0.4,40,32],[0.48,65,28],[0.56,50,36],[0.63,35,44],[0.7,65,26],[0.78,45,38],[0.86,30,50]];
      cfgs2.forEach(([bx,bh,bw]) => {
        ctx.fillRect(bx*width, height-108-bh, bw, bh);
      });
    } else if (theme === "mountain") {
      // Mountain silhouettes
      ctx.fillStyle = "#4a6858";
      ctx.beginPath();
      ctx.moveTo(0, height*0.75);
      ctx.lineTo(width*0.12, height*0.42); ctx.lineTo(width*0.25, height*0.65);
      ctx.lineTo(width*0.38, height*0.35); ctx.lineTo(width*0.52, height*0.58);
      ctx.lineTo(width*0.65, height*0.30); ctx.lineTo(width*0.78, height*0.52);
      ctx.lineTo(width*0.90, height*0.38); ctx.lineTo(width, height*0.55);
      ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath(); ctx.fill();
      // Snow caps
      ctx.fillStyle = "#e8f0f8";
      [[0.38, height*0.35],[0.65, height*0.30],[0.90, height*0.38]].forEach(([mx, my]) => {
        ctx.beginPath();
        ctx.moveTo(mx*width, my); ctx.lineTo(mx*width-18, my+28); ctx.lineTo(mx*width+18, my+28);
        ctx.closePath(); ctx.fill();
      });
      // Pine trees silhouette
      ctx.fillStyle = "#2d4a38";
      [0.05,0.09,0.15,0.20,0.45,0.48,0.55,0.60,0.75,0.80,0.87,0.92].forEach(tx => {
        ctx.beginPath();
        ctx.moveTo(tx*width, height-108-55);
        ctx.lineTo(tx*width-14, height-108); ctx.lineTo(tx*width+14, height-108);
        ctx.closePath(); ctx.fill();
      });
    } else if (theme === "highway") {
      // Wide open landscape
      ctx.fillStyle = "#5a8a6a";
      ctx.beginPath();
      ctx.moveTo(0, height*0.85);
      ctx.lineTo(width*0.5, height*0.70); ctx.lineTo(width, height*0.82);
      ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath(); ctx.fill();
      // Distance hills
      ctx.fillStyle = "#7aac8a";
      ctx.beginPath();
      ctx.moveTo(0, height*0.78);
      ctx.quadraticCurveTo(width*0.3, height*0.62, width*0.6, height*0.75);
      ctx.quadraticCurveTo(width*0.85, height*0.55, width, height*0.72);
      ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath(); ctx.fill();
    } else {
      // Suburb — rolling hills
      ctx.fillStyle = "#7aa8c2";
      ctx.beginPath();
      ctx.moveTo(0, height*0.72);
      ctx.quadraticCurveTo(width*0.25, height*0.48, width*0.55, height*0.76);
      ctx.quadraticCurveTo(width*0.82, height*0.42, width, height*0.69);
      ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.fill();
      ctx.fillStyle = "#5d8a9e";
      ctx.beginPath();
      ctx.moveTo(0, height*0.78);
      ctx.quadraticCurveTo(width*0.35, height*0.58, width*0.7, height*0.81);
      ctx.quadraticCurveTo(width*0.92, height*0.62, width, height*0.77);
      ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.fill();
    }

    // Sidewalk / grass strip
    if (theme === "city") {
      ctx.fillStyle = "#8a8a9a"; // concrete
    } else if (theme === "highway") {
      ctx.fillStyle = "#6a7260"; // gravel shoulder
    } else if (theme === "mountain") {
      ctx.fillStyle = "#7a7060"; // rocky gravel
    } else if (theme === "night") {
      ctx.fillStyle = "#3a3a4a"; // dark concrete
    } else {
      ctx.fillStyle = "#7db560"; // grass
    }
    ctx.fillRect(0, height - 108, width, 18);

    // Road surface
    ctx.fillStyle = theme === "night" ? "#1e1e2e" : theme === "highway" ? "#4a5260" : "#555e6a";
    ctx.fillRect(0, height - 90, width, 90);

    // Curb
    ctx.fillStyle = theme === "night" ? "#444" : "#8a929e";
    ctx.fillRect(0, height - 92, width, 5);

    // Road markings
    const dashSpeed = theme === "highway" ? 6.0 : 3.8;
    ctx.strokeStyle = theme === "night" ? "rgba(255,200,0,0.5)" : "rgba(255,255,255,0.4)";
    ctx.lineWidth = 4;
    for (let i = -1; i < 7; i++) {
      const xPos = ((time * dashSpeed) % (width + 180)) + i * (width / 5.5) - 90;
      ctx.beginPath(); ctx.moveTo(xPos, height - 50); ctx.lineTo(xPos + 60, height - 50); ctx.stroke();
    }
    // Highway gets double centre line
    if (theme === "highway") {
      ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 3;
      for (let i = -1; i < 7; i++) {
        const xPos = ((time * dashSpeed) % (width + 180)) + i * (width / 5.5) - 90;
        ctx.beginPath(); ctx.moveTo(xPos, height - 30); ctx.lineTo(xPos + 60, height - 30); ctx.stroke();
      }
    }
    // Night streetlights
    if (theme === "night") {
      for (let i = 0; i < 6; i++) {
        const lx = ((width * 0.18 * i - time * 2.0) % (width + 100) + width + 100) % (width + 100) - 50;
        // Pole
        ctx.fillStyle = "#555"; ctx.fillRect(lx - 3, height - 108 - 80, 6, 80);
        // Arm
        ctx.fillStyle = "#555"; ctx.fillRect(lx - 3, height - 108 - 80, 28, 5);
        // Light glow
        ctx.fillStyle = "rgba(255,200,60,0.9)";
        ctx.beginPath(); ctx.arc(lx + 25, height - 108 - 78, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,200,60,0.08)";
        ctx.beginPath(); ctx.ellipse(lx + 25, height - 108 - 40, 55, 55, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
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

    ctx.restore();
  };

  // ── Speech bubble for in-game dialog ───────────────────────────────────────
  const drawSpeechBubble = (ctx: CanvasRenderingContext2D, x: number, y: number, text: string, alpha: number) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = "bold 16px Arial";
    const w = Math.min(300, ctx.measureText(text).width + 28);
    const h = 36;
    const bx = x - w / 2, by = y - h;
    ctx.shadowColor = "rgba(0,0,0,0.25)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.roundRect(bx, by, w, h, 12); ctx.fill();
    // tail pointing down to the character
    ctx.beginPath(); ctx.moveTo(x - 9, by + h - 1); ctx.lineTo(x + 9, by + h - 1); ctx.lineTo(x - 2, by + h + 13); ctx.closePath(); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = "#222"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
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

        // Physics — variable jump height + snappy fall
        let g = GRAVITY;
        if (st.velocity < 0 && !st.jumpHeld) g *= LOW_JUMP_GRAVITY_MULT;
        else if (st.velocity > 0) g *= FALL_GRAVITY_MULT;
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
        st.spawnTimer++;
        const spawnRate = Math.max(lvlDef.minSpawn, 220 - Math.floor(st.levelScore / lvlDef.ramp));
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
        const speed = BASE_SPEED * lvlDef.speedMult + st.levelScore * 0.001;
        let didCrash = false;
        for (let i = st.obstacles.length - 1; i >= 0; i--) {
          const o = st.obstacles[i];
          o.x -= speed;
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
      drawFinger(ctx, st.playerY, st.time, height, st.gameRunning, hat, stretchX, stretchY);

      // Dialog speech bubble above the character
      if (st.dialog && st.dialog.life > 0) {
        const d = st.dialog;
        const fadeIn = Math.min(1, (d.maxLife - d.life) / 8);
        const fadeOut = Math.min(1, d.life / 20);
        const bubbleY = st.playerY - 26 + Math.sin(st.time * 0.1) * 2;
        drawSpeechBubble(ctx, 185, bubbleY, d.text, Math.min(fadeIn, fadeOut));
      }

      ctx.restore(); // end screen shake

      // HUD
      ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 6;
      ctx.fillStyle = theme === "night" ? "#ffd700" : "#fff";
      ctx.font = "bold 52px Arial"; ctx.textAlign = "left";
      ctx.fillText(String(Math.floor(st.levelScore)), 38, 74);
      ctx.font = "bold 20px Arial";
      ctx.fillText("BEST " + st.bestScore, 40, 102);

      // Coin counter (top-right, under the music toggle)
      ctx.textAlign = "right"; ctx.fillStyle = "#ffcf33"; ctx.font = "bold 26px Arial";
      ctx.fillText("🪙 " + st.coinBalance, width - 24, 92);
      ctx.textAlign = "left";

      // Level pill
      const lvlText = `LVL ${st.currentLevel}`;
      ctx.font = "bold 18px Arial"; ctx.textAlign = "center";
      const lvlW = ctx.measureText(lvlText).width + 28;
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.roundRect(38, 112, lvlW, 28, 8); ctx.fill();
      ctx.fillStyle = "#ffd700"; ctx.shadowBlur = 0; ctx.fillText(lvlText, 38 + lvlW/2, 131);

      // Level progress bar
      const progress = Math.min(1, st.levelScore / lvlDef.target);
      const barW = 180; const barX = 38; const barY = 145;
      ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.roundRect(barX, barY, barW, 8, 4); ctx.fill();
      const barGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      barGrad.addColorStop(0, "#4eff91"); barGrad.addColorStop(1, "#00c853");
      ctx.fillStyle = barGrad; ctx.beginPath(); ctx.roundRect(barX, barY, barW * progress, 8, 4); ctx.fill();
      ctx.shadowBlur = 0;

      // Game over panel (on canvas)
      if (!st.gameRunning && !st.levelComplete && st.totalScore > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.78)";
        ctx.beginPath(); ctx.roundRect(width/2-250, height/2-145, 500, 290, 20); ctx.fill();
        ctx.fillStyle = "#ff6b6b"; ctx.textAlign = "center";
        ctx.font = "bold 48px Arial"; ctx.fillText("OUCH! 🤕", width/2, height/2 - 70);
        ctx.fillStyle = "#fff"; ctx.font = "bold 26px Arial";
        ctx.fillText(`Level ${st.currentLevel}: ${Math.floor(st.levelScore)} / ${lvlDef.target}`, width/2, height/2 - 26);
        ctx.fillStyle = "#aaa"; ctx.font = "20px Arial";
        ctx.fillText(`Total distance: ${Math.floor(st.totalScore)}`, width/2, height/2 + 10);
        if (Math.floor(st.totalScore) >= st.bestScore && st.totalScore > 5) {
          ctx.fillStyle = "#ffd700"; ctx.font = "bold 24px Arial"; ctx.fillText("★ NEW RECORD! ★", width/2, height/2 + 48);
        }
        ctx.fillStyle = "#ddd"; ctx.font = "20px Arial";
        ctx.fillText("Tap or press SPACE to retry this level", width/2, height/2 + 110);
      }

      // Red screen flash on crash
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
  const openWardrobe = () => {
    setCoinBalanceState(getCoins());
    setOwnedState(getOwnedOutfits());
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
  const font = "Arial, sans-serif";
  const overlay: React.CSSProperties = {
    position:"absolute", inset:0, display:"flex", flexDirection:"column",
    alignItems:"center", justifyContent:"center", zIndex:10, fontFamily:font,
  };

  return (
    <div style={{ position:"relative", width:"100vw", height:"100vh", overflow:"hidden", background:"#87CEEB", touchAction:"none" }}>
      <canvas ref={canvasRef} style={{ display:"block" }} onPointerDown={handleCanvasClick}
        onPointerUp={() => releaseJump()} onPointerLeave={() => releaseJump()} onPointerCancel={() => releaseJump()} />

      {/* ── Start screen ── */}
      {screen === "start" && (
        <div style={{ ...overlay, background:"rgba(0,0,0,0.5)", color:"#fff", textShadow:"0 2px 4px rgba(0,0,0,0.7)" }}>
          <div style={{ fontSize:"4rem", fontWeight:"bold", color:"#ffd700", textShadow:"0 4px 10px rgba(0,0,0,0.6)", marginBottom:8, fontFamily:font }}>
            👆 FINGER RUNNER
          </div>
          <p style={{ fontSize:"1.05rem", margin:"10px auto 6px", maxWidth:520, lineHeight:1.5, color:"#ffe9a8", fontStyle:"italic" }}>
            {STORY_INTRO}
          </p>
          <p style={{ fontSize:"1.3rem", margin:"4px 0" }}>Tap / hold SPACE to jump • double-tap for a double jump • Clear 8 levels</p>
          <p style={{ fontSize:"1.1rem", margin:"4px 0", color:"#aef" }}>
            {HATS.filter(h=>h.id!=="none"&&isHatUnlocked(h, ownedOutfits)).map(h=>h.emoji).join(" ")||"🤚"} outfits unlocked • collect 🪙 coins for more!
          </p>
          <div style={{ display:"flex", gap:16, marginTop:28 }}>
            <button onClick={() => startLevel(1)}
              onMouseDown={btnPress} onMouseUp={btnRelease}
              style={{ padding:"16px 44px", fontSize:"1.5rem", background:"#ff4757", color:"#fff", border:"none",
                borderRadius:60, cursor:"pointer", boxShadow:"0 8px 0 #c2363e", fontFamily:font, fontWeight:"bold" }}>
              START RUNNING
            </button>
            <button onClick={openWardrobe}
              onMouseDown={btnPress} onMouseUp={btnRelease}
              style={{ padding:"16px 28px", fontSize:"1.4rem", background:"#7c4dff", color:"#fff", border:"none",
                borderRadius:60, cursor:"pointer", boxShadow:"0 8px 0 #5a2fd0", fontFamily:font, fontWeight:"bold" }}>
              👕 WARDROBE
            </button>
          </div>
          {/* Level select */}
          <div style={{ marginTop:24, display:"flex", gap:8, flexWrap:"wrap", justifyContent:"center", maxWidth:560 }}>
            {LEVELS.map((lv, idx) => {
              const unlocked = lv.num <= getMaxLevel();
              const best = levelBests[idx];
              const medal = getMedal(lv.num);
              const borderColor = medal === "gold" ? "#ffd700" : medal === "silver" ? "#c0c0c0" : medal === "bronze" ? "#cd7f32" : unlocked ? "#4a9eff" : "#555";
              return (
                <button key={lv.num}
                  onClick={() => unlocked && startLevel(lv.num)}
                  onMouseDown={unlocked ? btnPress : undefined} onMouseUp={unlocked ? btnRelease : undefined}
                  style={{ padding:"8px 14px", fontSize:"0.85rem", fontWeight:"bold",
                    background: unlocked ? (medal ? "rgba(26,115,232,0.85)" : "#1a73e8") : "rgba(255,255,255,0.15)",
                    color: unlocked ? "#fff" : "#888",
                    border: `2px solid ${borderColor}`,
                    borderRadius:20, cursor: unlocked ? "pointer" : "default", fontFamily:font,
                    display:"flex", flexDirection:"column", alignItems:"center", gap:2, minWidth:110 }}>
                  <span>{unlocked ? `${lv.num}. ${lv.name}` : `🔒 Lv ${lv.num}`}</span>
                  {unlocked && (
                    <span style={{ fontSize:"0.75rem", fontWeight:"normal", color: medal ? MEDAL_COLOR[medal] : "#adf", letterSpacing:"0.03em" }}>
                      {medal ? MEDAL_EMOJI[medal] : "–"} {best > 0 ? `${best} / ${lv.target}` : "no run"}
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
        <div style={{ ...overlay, background:"rgba(10,10,30,0.92)", color:"#fff" }}>
          <div style={{ background:"rgba(255,255,255,0.07)", borderRadius:24, padding:"32px 40px", maxWidth:540, width:"90%", boxShadow:"0 8px 40px rgba(0,0,0,0.6)" }}>
            <h2 style={{ fontSize:"2rem", margin:"0 0 6px 0", color:"#ffd700", textAlign:"center", fontFamily:font }}>👕 WARDROBE</h2>
            <p style={{ color:"#aaa", textAlign:"center", margin:"0 0 12px 0", fontFamily:font }}>Earn outfits by leveling up — or buy them with 🪙 coins</p>
            <div style={{ textAlign:"center", margin:"0 0 20px 0" }}>
              <span style={{ display:"inline-block", background:"rgba(255,207,51,0.15)", border:"2px solid #ffcf33",
                borderRadius:30, padding:"6px 18px", fontSize:"1.2rem", fontWeight:"bold", color:"#ffcf33", fontFamily:font }}>
                🪙 {coinBalance} coins
              </span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, maxHeight:"50vh", overflowY:"auto" }}>
              {HATS.map(hat => {
                const owned = isHatUnlocked(hat, ownedOutfits);
                const isCoin = hat.cost != null;
                const equipped = equippedHat === hat.id;
                const affordable = coinBalance >= (hat.cost ?? 0);
                const subtitle = isCoin
                  ? (owned ? "Owned" : `Buy: 🪙 ${hat.cost}`)
                  : (hat.unlockLevel === 0 ? "Always available" : `Unlock: Level ${hat.unlockLevel}`);
                return (
                  <div key={hat.id}
                    style={{ background: equipped ? "rgba(124,77,255,0.3)" : "rgba(255,255,255,0.06)",
                      border: `2px solid ${equipped ? "#7c4dff" : owned ? "#555" : "#333"}`,
                      borderRadius:14, padding:"14px 16px", display:"flex", alignItems:"center", gap:12,
                      opacity: owned ? 1 : 0.7 }}>
                    <span style={{ fontSize:"2rem" }}>{hat.emoji}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:"bold", fontSize:"1rem", fontFamily:font }}>{hat.name}</div>
                      <div style={{ fontSize:"0.8rem", color:"#aaa", fontFamily:font }}>{subtitle}</div>
                    </div>
                    {owned ? (
                      <button onClick={() => handleEquipHat(hat.id)}
                        onMouseDown={btnPress} onMouseUp={btnRelease}
                        style={{ padding:"6px 14px", fontSize:"0.85rem", fontWeight:"bold",
                          background: equipped ? "#7c4dff" : "#333", color:"#fff",
                          border:"none", borderRadius:20, cursor:"pointer", fontFamily:font }}>
                        {equipped ? "✓ ON" : "EQUIP"}
                      </button>
                    ) : isCoin ? (
                      <button onClick={() => affordable && handleBuyOutfit(hat)}
                        onMouseDown={affordable ? btnPress : undefined} onMouseUp={affordable ? btnRelease : undefined}
                        disabled={!affordable}
                        style={{ padding:"6px 14px", fontSize:"0.85rem", fontWeight:"bold",
                          background: affordable ? "#ffcf33" : "#333", color: affordable ? "#222" : "#777",
                          border:"none", borderRadius:20, cursor: affordable ? "pointer" : "not-allowed", fontFamily:font }}>
                        🪙 {hat.cost}
                      </button>
                    ) : (
                      <span style={{ fontSize:"0.8rem", color:"#666", fontFamily:font }}>🔒 Lv {hat.unlockLevel}</span>
                    )}
                  </div>
                );
              })}
            </div>
            <button onClick={() => setScreen("start")}
              onMouseDown={btnPress} onMouseUp={btnRelease}
              style={{ marginTop:24, width:"100%", padding:"14px", fontSize:"1.1rem", fontWeight:"bold",
                background:"#444", color:"#fff", border:"none", borderRadius:40, cursor:"pointer", fontFamily:font }}>
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* ── Level Complete screen ── */}
      {screen === "levelComplete" && (
        <div style={{ ...overlay, background:"rgba(0,0,0,0.7)" }}>
          <div style={{ background:"linear-gradient(135deg,#1a1a3a,#2a2a5a)", borderRadius:24, padding:"36px 44px",
            maxWidth:480, width:"90%", textAlign:"center", boxShadow:"0 12px 60px rgba(0,0,0,0.8)",
            border:"2px solid rgba(255,215,0,0.3)" }}>
            <div style={{ fontSize:"3rem", marginBottom:8 }}>🎉</div>
            <h2 style={{ fontSize:"2.2rem", color:"#ffd700", margin:"0 0 6px 0", fontFamily:font }}>LEVEL COMPLETE!</h2>
            <p style={{ fontSize:"1.2rem", color:"#adf", margin:"0 0 10px 0", fontFamily:font }}>
              {getLevelDef(completedLevel).name}
            </p>
            <p style={{ fontSize:"1rem", color:"#ffe9a8", fontStyle:"italic", margin:"0 0 16px 0", lineHeight:1.4 }}>
              {completedLevel < LEVELS.length
                ? (LEVEL_STORY[completedLevel + 1] || "The road rolls on…")
                : "Lefty & Middy made it home — knuckles weary, nails chipped, hearts full."}
            </p>
            <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:12, padding:"12px 20px", marginBottom:16 }}>
              <div style={{ fontSize:"1rem", color:"#aaa", fontFamily:font }}>Distance covered</div>
              <div style={{ fontSize:"2rem", fontWeight:"bold", color:"#fff", fontFamily:font }}>
                {Math.floor(stateRef.current.levelScore)} m
              </div>
            </div>
            {/* Medal + best score */}
            {completedLevelMedal && (
              <div style={{ background:`rgba(${completedLevelMedal==="gold"?"255,215,0":completedLevelMedal==="silver"?"192,192,192":"205,127,50"},0.12)`,
                border:`2px solid ${MEDAL_COLOR[completedLevelMedal]}`,
                borderRadius:12, padding:"12px 20px", marginBottom:16 }}>
                <div style={{ fontSize:"2.4rem", lineHeight:1 }}>{MEDAL_EMOJI[completedLevelMedal]}</div>
                <div style={{ fontSize:"1.1rem", fontWeight:"bold", color: MEDAL_COLOR[completedLevelMedal], fontFamily:font, marginTop:4 }}>
                  {completedLevelMedal.toUpperCase()} MEDAL
                </div>
                {completedLevelPrevBest === 0 ? (
                  <div style={{ fontSize:"0.85rem", color:"#aaa", fontFamily:font }}>First clear!</div>
                ) : completedLevelPrevBest < getLevelDef(completedLevel).target ? (
                  <div style={{ fontSize:"0.85rem", color:"#adf", fontFamily:font }}>
                    Previous best: {completedLevelPrevBest} → 🥇 now!
                  </div>
                ) : (
                  <div style={{ fontSize:"0.85rem", color:"#aaa", fontFamily:font }}>
                    Best: {getLevelBest(completedLevel)} m
                  </div>
                )}
              </div>
            )}
            {unlockedHat && (
              <div style={{ background:"rgba(124,77,255,0.25)", border:"2px solid #7c4dff",
                borderRadius:12, padding:"12px 20px", marginBottom:20 }}>
                <div style={{ fontSize:"0.9rem", color:"#c5a9ff", fontFamily:font }}>NEW UNLOCK!</div>
                <div style={{ fontSize:"2rem" }}>{unlockedHat.emoji}</div>
                <div style={{ fontSize:"1.1rem", fontWeight:"bold", color:"#fff", fontFamily:font }}>{unlockedHat.name}</div>
                <button onClick={() => handleEquipHat(unlockedHat.id)}
                  onMouseDown={btnPress} onMouseUp={btnRelease}
                  style={{ marginTop:8, padding:"6px 20px", fontSize:"0.9rem", background:"#7c4dff",
                    color:"#fff", border:"none", borderRadius:20, cursor:"pointer", fontFamily:font }}>
                  Equip it!
                </button>
              </div>
            )}
            <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
              {completedLevel < LEVELS.length && (
                <button
                  onClick={() => startLevel(completedLevel + 1)}
                  onMouseDown={btnPress} onMouseUp={btnRelease}
                  style={{ padding:"16px 36px", fontSize:"1.3rem", fontWeight:"bold", background:"#00c853",
                    color:"#fff", border:"none", borderRadius:50, cursor:"pointer",
                    boxShadow:"0 6px 0 #009624", fontFamily:font }}>
                  Level {completedLevel + 1} →
                </button>
              )}
              {completedLevel >= LEVELS.length && (
                <button onClick={() => startLevel(completedLevel + 1)}
                  onMouseDown={btnPress} onMouseUp={btnRelease}
                  style={{ padding:"16px 36px", fontSize:"1.3rem", fontWeight:"bold", background:"#ffd700",
                    color:"#222", border:"none", borderRadius:50, cursor:"pointer",
                    boxShadow:"0 6px 0 #b8960a", fontFamily:font }}>
                  🏆 Keep Going!
                </button>
              )}
              <button onClick={() => setScreen("start")}
                onMouseDown={btnPress} onMouseUp={btnRelease}
                style={{ padding:"16px 24px", fontSize:"1.1rem", background:"#333",
                  color:"#fff", border:"none", borderRadius:50, cursor:"pointer", fontFamily:font }}>
                Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Music toggle ── */}
      <button onClick={handleToggleMusic}
        style={{ position:"absolute", top:20, right:20, zIndex:20,
          padding:"10px 18px", fontSize:"1.05rem",
          background:"rgba(0,0,0,0.6)", color:"white",
          border:"2px solid #ffd700", borderRadius:30, cursor:"pointer", fontFamily:font }}>
        🎵 {musicOn ? "ON" : "OFF"}
      </button>
    </div>
  );
}
