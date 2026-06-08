import { useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
type ObstacleType = "mailbox"|"hydrant"|"stopsign"|"trashcan"|"dog"|"cat"|"bicycle"|"gnome"|"cone"|"newsbox";
type Theme = "suburb"|"city"|"highway"|"mountain"|"night";
type HatId = "none"|"tophat"|"cap"|"crown"|"cowboy"|"viking";

interface Obstacle { x: number; obsWidth: number; obsHeight: number; type: ObstacleType; passed: boolean; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number; color: string; shape?: "rect"|"circle"|"bone"; rot?: number; rotV?: number; }
interface BloodPuddle { x: number; y: number; rx: number; ry: number; life: number; maxLife: number; }

// ── Constants ─────────────────────────────────────────────────────────────────
const GRAVITY = 0.70;
const JUMP_FORCE = -20;
const BASE_SPEED = 2.0;
const FINGER_TIP_OFFSET = 90;
const ROAD_SURFACE_OFFSET = 108;

function getGroundY(h: number) { return h - ROAD_SURFACE_OFFSET - FINGER_TIP_OFFSET - 8; }

// ── Level definitions ─────────────────────────────────────────────────────────
const LEVELS = [
  { num:1, name:"Neighborhood Cruise",  target:500,  theme:"suburb"   as Theme, speedMult:1.0,  minSpawn:130 },
  { num:2, name:"Shopping District",    target:600,  theme:"suburb"   as Theme, speedMult:1.25, minSpawn:120 },
  { num:3, name:"Downtown",             target:650,  theme:"city"     as Theme, speedMult:1.5,  minSpawn:110 },
  { num:4, name:"City Center",          target:700,  theme:"city"     as Theme, speedMult:1.8,  minSpawn:100 },
  { num:5, name:"Highway On-Ramp",      target:750,  theme:"highway"  as Theme, speedMult:2.1,  minSpawn:90  },
  { num:6, name:"Open Highway",         target:800,  theme:"highway"  as Theme, speedMult:2.5,  minSpawn:80  },
  { num:7, name:"Mountain Pass",        target:900,  theme:"mountain" as Theme, speedMult:3.0,  minSpawn:70  },
  { num:8, name:"Night Drive",          target:1000, theme:"night"    as Theme, speedMult:3.6,  minSpawn:60  },
];
function getLevelDef(num: number) { return LEVELS[Math.min(num - 1, LEVELS.length - 1)]; }

// ── Hat catalogue ─────────────────────────────────────────────────────────────
const HATS: { id: HatId; name: string; emoji: string; unlockLevel: number }[] = [
  { id:"none",   name:"Bare Knuckle",  emoji:"🤚", unlockLevel:0 },
  { id:"tophat", name:"Top Hat",       emoji:"🎩", unlockLevel:2 },
  { id:"cap",    name:"Baseball Cap",  emoji:"🧢", unlockLevel:3 },
  { id:"crown",  name:"Gold Crown",    emoji:"👑", unlockLevel:5 },
  { id:"cowboy", name:"Cowboy Hat",    emoji:"🤠", unlockLevel:6 },
  { id:"viking", name:"Viking Helmet", emoji:"⚔️",  unlockLevel:8 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMaxLevel(): number { return parseInt(localStorage.getItem("fingerRunnerMaxLevel") || "1"); }
function setMaxLevel(n: number) { localStorage.setItem("fingerRunnerMaxLevel", String(n)); }
function getEquippedHat(): HatId { return (localStorage.getItem("fingerRunnerHat") || "none") as HatId; }
function setEquippedHat(id: HatId) { localStorage.setItem("fingerRunnerHat", id); }

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
    obstacles: [] as Obstacle[],
    particles: [] as Particle[],
    bloodPuddles: [] as BloodPuddle[],
    crashFlash: 0,
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
  const [completedLevel, setCompletedLevel] = useState(0);
  const [unlockedHat, setUnlockedHat] = useState<typeof HATS[0] | null>(null);

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

  // ── Obstacles ──────────────────────────────────────────────────────────────
  const OBSTACLE_TYPES: { type: ObstacleType; w: number; h: number }[] = [
    { type:"mailbox",  w:36, h:68 }, { type:"hydrant",  w:34, h:58 },
    { type:"stopsign", w:22, h:88 }, { type:"trashcan", w:36, h:66 },
    { type:"dog",      w:44, h:46 }, { type:"cat",      w:28, h:42 },
    { type:"bicycle",  w:46, h:68 }, { type:"gnome",    w:30, h:62 },
    { type:"cone",     w:32, h:56 }, { type:"newsbox",  w:36, h:60 },
  ];
  const spawnObstacle = (width: number) => {
    const pick = OBSTACLE_TYPES[Math.floor(Math.random() * OBSTACLE_TYPES.length)];
    stateRef.current.obstacles.push({ x: width + 80, obsWidth: pick.w, obsHeight: pick.h, type: pick.type, passed: false });
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
    playCrashSound();
    createCrashExplosion(185, st.playerY + 30, roadY);
    if (st.totalScore > st.bestScore) {
      st.bestScore = Math.floor(st.totalScore);
      localStorage.setItem("fingerRunnerBest", String(st.bestScore));
    }
    stopMusic();
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
    const lvl = st.currentLevel;
    const newMax = Math.max(getMaxLevel(), lvl + 1);
    setMaxLevel(newMax); setMaxLevelState(newMax);
    // Check for hat unlock at next level
    const nextUnlock = HATS.find(h => h.unlockLevel === lvl + 1);
    setUnlockedHat(nextUnlock || null);
    setCompletedLevel(lvl);
    setCurrentLevel(lvl);
    setTimeout(() => setScreen("levelComplete"), 300);
  };

  const jump = () => {
    initAudio();
    const st = stateRef.current;
    if (!st.gameRunning) return;
    if (!st.onGround && st.jumpsUsed >= 2) return;
    st.jumpsUsed = (st.jumpsUsed || 0) + 1;
    st.velocity = JUMP_FORCE;
    st.onGround = false;
    playJumpSound();
    for (let i = 0; i < 8; i++) {
      st.particles.push({ x: 175+Math.random()*30, y: st.playerY+80,
        vx: (Math.random()-0.5)*5, vy: -2+Math.random()*2, life:22, size:4+Math.random()*4, color:"#d4916a" });
    }
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
    st.crashFlash = 0;
    st.playerY = groundY;
    st.velocity = 0;
    st.onGround = true;
    st.jumpsUsed = 0;
    st.spawnTimer = 0;
    st.time = 0;
    setCurrentLevel(levelNum);
    setScreen("playing");
    stopMusic();
    if (audioRef.current.enabled) setTimeout(() => startMusic(true), 80);
  };

  // ── Background themes ──────────────────────────────────────────────────────
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
    }
    ctx.restore();
  };

  // ── Character drawing ──────────────────────────────────────────────────────
  const drawFinger = (ctx: CanvasRenderingContext2D, playerY: number, time: number, _height: number, gameRunning: boolean, hatId: HatId) => {
    const cx = 185;
    const strideSpeed = gameRunning ? 0.26 : 0.05;
    const stride = Math.sin(time * strideSpeed);
    const bodyBob = gameRunning ? Math.abs(stride) * -6 : Math.sin(time * 0.05) * 2;
    const palmY = playerY + bodyBob;

    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.beginPath(); ctx.ellipse(cx, palmY + 115, 30, 6, 0, 0, Math.PI * 2); ctx.fill();

    const drawFingerLeg = (baseX: number, baseY: number, swing: number, skin: string, dark: string) => {
      const seg1=34; const seg2=28;
      const j1x=baseX+Math.sin(swing)*seg1; const j1y=baseY+Math.cos(swing)*seg1;
      const bendOut=swing*0.55+(swing>0?0.28:-0.28);
      const tipX=j1x+Math.sin(bendOut)*seg2; const tipY=j1y+Math.cos(bendOut)*seg2;
      ctx.lineCap="round";
      ctx.strokeStyle=dark;ctx.lineWidth=19;ctx.beginPath();ctx.moveTo(baseX,baseY+1);ctx.lineTo(j1x+1,j1y+1);ctx.stroke();
      ctx.strokeStyle=skin;ctx.lineWidth=17;ctx.beginPath();ctx.moveTo(baseX,baseY);ctx.lineTo(j1x,j1y);ctx.stroke();
      ctx.strokeStyle=dark;ctx.lineWidth=16;ctx.beginPath();ctx.moveTo(j1x+1,j1y+1);ctx.lineTo(tipX+1,tipY+1);ctx.stroke();
      ctx.strokeStyle=skin;ctx.lineWidth=14;ctx.beginPath();ctx.moveTo(j1x,j1y);ctx.lineTo(tipX,tipY);ctx.stroke();
      ctx.fillStyle=dark;ctx.beginPath();ctx.arc(j1x,j1y,9.5,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=skin;ctx.beginPath();ctx.arc(j1x,j1y,7.5,0,Math.PI*2);ctx.fill();
      const kAngle=Math.atan2(j1y-baseY,j1x-baseX)+Math.PI/2;
      ctx.strokeStyle=dark;ctx.lineWidth=1.8;
      ctx.beginPath();ctx.moveTo(j1x+Math.cos(kAngle)*6,j1y+Math.sin(kAngle)*6);ctx.lineTo(j1x-Math.cos(kAngle)*6,j1y-Math.sin(kAngle)*6);ctx.stroke();
      ctx.fillStyle=dark;ctx.beginPath();ctx.arc(tipX,tipY,9,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#f8c090";ctx.beginPath();ctx.arc(tipX-1,tipY-1,7,0,Math.PI*2);ctx.fill();
      const nDir=Math.atan2(tipY-j1y,tipX-j1x);
      ctx.save();ctx.translate(tipX,tipY);ctx.rotate(nDir-Math.PI/2);
      ctx.fillStyle="#d9a080";ctx.beginPath();ctx.roundRect(-5,-9,10,10,3);ctx.fill();
      ctx.fillStyle="#fdf5f0";ctx.beginPath();ctx.roundRect(-4,-8,8,7,2);ctx.fill();
      ctx.strokeStyle="rgba(140,70,40,0.25)";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-5,0);ctx.lineTo(5,0);ctx.stroke();
      ctx.restore();
      ctx.fillStyle=dark;ctx.beginPath();ctx.arc(baseX,baseY,10,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=skin;ctx.beginPath();ctx.arc(baseX-1,baseY-1,8,0,Math.PI*2);ctx.fill();
    };

    ctx.save();
    ctx.translate(cx, palmY);
    ctx.rotate(-0.1);
    // Palm body
    ctx.fillStyle="#bf7040";ctx.beginPath();ctx.roundRect(-33,-26,66,54,16);ctx.fill();
    ctx.fillStyle="#eda068";ctx.beginPath();ctx.roundRect(-31,-24,62,50,14);ctx.fill();
    ctx.fillStyle="#cc8448";ctx.beginPath();ctx.roundRect(-29,-26,58,18,[14,14,0,0]);ctx.fill();
    // Knuckle bumps
    for(let k=-1;k<=1;k++){ctx.fillStyle="#b06030";ctx.beginPath();ctx.ellipse(k*19,-22,11,8,0,0,Math.PI*2);ctx.fill();ctx.fillStyle="#dd9858";ctx.beginPath();ctx.ellipse(k*19-1,-25,7,5,0,0,Math.PI*2);ctx.fill();}
    // Curled ring/pinky
    ctx.strokeStyle="#b86830";ctx.lineWidth=11;ctx.lineCap="round";
    ctx.beginPath();ctx.arc(21,-20,12,Math.PI*1.05,Math.PI*1.95);ctx.stroke();
    ctx.lineWidth=9;ctx.beginPath();ctx.arc(31,-17,9,Math.PI*1.1,Math.PI*1.9);ctx.stroke();
    // Thumb
    ctx.fillStyle="#eda068";ctx.beginPath();ctx.ellipse(-36,5,12,17,-0.22,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#c07840";ctx.beginPath();ctx.ellipse(-37,0,7.5,12,-0.22,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#d9a080";ctx.beginPath();ctx.roundRect(-42,-7,9,12,3);ctx.fill();
    ctx.fillStyle="#fdf5f0";ctx.beginPath();ctx.roundRect(-41,-6,7,9,2);ctx.fill();
    // Skin creases
    ctx.strokeStyle="rgba(140,60,20,0.30)";ctx.lineWidth=1.5;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(-24,4);ctx.quadraticCurveTo(0,0,24,6);ctx.stroke();
    ctx.beginPath();ctx.moveTo(-22,14);ctx.quadraticCurveTo(0,11,21,16);ctx.stroke();
    // Hat (drawn in palm local coords)
    drawHat(ctx, hatId);
    ctx.restore();

    const baseY = palmY + 26;
    const indexSwing  =  stride * 0.54;
    const middleSwing = -stride * 0.54;
    drawFingerLeg(cx + 12, baseY, middleSwing, "#e8a060", "#b86830");
    drawFingerLeg(cx - 12, baseY, indexSwing,  "#f0b070", "#c87840");
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
      if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); jump(); }
    };
    document.addEventListener("keydown", onKey);

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

        // Physics
        st.velocity += GRAVITY;
        st.playerY += st.velocity;
        if (st.playerY >= groundY) { st.playerY = groundY; st.velocity = 0; st.onGround = true; st.jumpsUsed = 0; }
        else { st.onGround = false; }
        if (st.playerY < 30) { st.playerY = 30; st.velocity = 1; }

        // Spawn
        st.spawnTimer++;
        const spawnRate = Math.max(lvlDef.minSpawn, 220 - Math.floor(st.levelScore / 6));
        if (st.spawnTimer > spawnRate) { spawnObstacle(width); st.spawnTimer = 0; }

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
      drawFinger(ctx, st.playerY, st.time, height, st.gameRunning, hat);

      // HUD
      ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 6;
      ctx.fillStyle = theme === "night" ? "#ffd700" : "#fff";
      ctx.font = "bold 52px Arial"; ctx.textAlign = "left";
      ctx.fillText(String(Math.floor(st.levelScore)), 38, 74);
      ctx.font = "bold 20px Arial";
      ctx.fillText("BEST " + st.bestScore, 40, 102);

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
      <canvas ref={canvasRef} style={{ display:"block" }} onPointerDown={handleCanvasClick} />

      {/* ── Start screen ── */}
      {screen === "start" && (
        <div style={{ ...overlay, background:"rgba(0,0,0,0.5)", color:"#fff", textShadow:"0 2px 4px rgba(0,0,0,0.7)" }}>
          <div style={{ fontSize:"4rem", fontWeight:"bold", color:"#ffd700", textShadow:"0 4px 10px rgba(0,0,0,0.6)", marginBottom:8, fontFamily:font }}>
            👆 FINGER RUNNER
          </div>
          <p style={{ fontSize:"1.3rem", margin:"4px 0" }}>Your fingers escape out the car window!</p>
          <p style={{ fontSize:"1.3rem", margin:"4px 0" }}>Tap or SPACE to jump • Clear 8 levels</p>
          <p style={{ fontSize:"1.1rem", margin:"4px 0", color:"#aef" }}>
            {HATS.filter(h=>h.unlockLevel<=getMaxLevel()&&h.id!=="none").map(h=>h.emoji).join(" ")||"🤚"} outfits unlocked • reach new levels to earn more!
          </p>
          <div style={{ display:"flex", gap:16, marginTop:28 }}>
            <button onClick={() => startLevel(1)}
              onMouseDown={btnPress} onMouseUp={btnRelease}
              style={{ padding:"16px 44px", fontSize:"1.5rem", background:"#ff4757", color:"#fff", border:"none",
                borderRadius:60, cursor:"pointer", boxShadow:"0 8px 0 #c2363e", fontFamily:font, fontWeight:"bold" }}>
              START RUNNING
            </button>
            <button onClick={() => setScreen("wardrobe")}
              onMouseDown={btnPress} onMouseUp={btnRelease}
              style={{ padding:"16px 28px", fontSize:"1.4rem", background:"#7c4dff", color:"#fff", border:"none",
                borderRadius:60, cursor:"pointer", boxShadow:"0 8px 0 #5a2fd0", fontFamily:font, fontWeight:"bold" }}>
              👕 WARDROBE
            </button>
          </div>
          {/* Level select */}
          <div style={{ marginTop:24, display:"flex", gap:8, flexWrap:"wrap", justifyContent:"center", maxWidth:480 }}>
            {LEVELS.map(lv => {
              const unlocked = lv.num <= getMaxLevel();
              return (
                <button key={lv.num}
                  onClick={() => unlocked && startLevel(lv.num)}
                  onMouseDown={btnPress} onMouseUp={btnRelease}
                  style={{ padding:"8px 14px", fontSize:"0.9rem", fontWeight:"bold",
                    background: unlocked ? "#1a73e8" : "rgba(255,255,255,0.15)",
                    color: unlocked ? "#fff" : "#888",
                    border: "2px solid " + (unlocked ? "#4a9eff" : "#555"),
                    borderRadius:20, cursor: unlocked ? "pointer" : "default", fontFamily:font }}>
                  {unlocked ? `${lv.num}. ${lv.name}` : `🔒 Lv ${lv.num}`}
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
            <p style={{ color:"#aaa", textAlign:"center", margin:"0 0 24px 0", fontFamily:font }}>Unlock hats by reaching new levels</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {HATS.map(hat => {
                const unlocked = hat.unlockLevel <= getMaxLevel();
                const equipped = equippedHat === hat.id;
                return (
                  <div key={hat.id}
                    style={{ background: equipped ? "rgba(124,77,255,0.3)" : "rgba(255,255,255,0.06)",
                      border: `2px solid ${equipped ? "#7c4dff" : unlocked ? "#555" : "#333"}`,
                      borderRadius:14, padding:"14px 16px", display:"flex", alignItems:"center", gap:12,
                      opacity: unlocked ? 1 : 0.5 }}>
                    <span style={{ fontSize:"2rem" }}>{hat.emoji}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:"bold", fontSize:"1rem", fontFamily:font }}>{hat.name}</div>
                      <div style={{ fontSize:"0.8rem", color:"#aaa", fontFamily:font }}>
                        {hat.unlockLevel === 0 ? "Always available" : `Unlock: Level ${hat.unlockLevel}`}
                      </div>
                    </div>
                    {unlocked ? (
                      <button onClick={() => handleEquipHat(hat.id)}
                        onMouseDown={btnPress} onMouseUp={btnRelease}
                        style={{ padding:"6px 14px", fontSize:"0.85rem", fontWeight:"bold",
                          background: equipped ? "#7c4dff" : "#333", color:"#fff",
                          border:"none", borderRadius:20, cursor:"pointer", fontFamily:font }}>
                        {equipped ? "✓ ON" : "EQUIP"}
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
            <p style={{ fontSize:"1.2rem", color:"#adf", margin:"0 0 16px 0", fontFamily:font }}>
              {getLevelDef(completedLevel).name}
            </p>
            <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:12, padding:"12px 20px", marginBottom:20 }}>
              <div style={{ fontSize:"1rem", color:"#aaa", fontFamily:font }}>Distance covered</div>
              <div style={{ fontSize:"2rem", fontWeight:"bold", color:"#fff", fontFamily:font }}>
                {Math.floor(stateRef.current.levelScore)} m
              </div>
            </div>
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
