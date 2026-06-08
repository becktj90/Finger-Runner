import { useEffect, useRef, useState } from "react";

type ObstacleType =
  | "mailbox" | "hydrant" | "stopsign" | "trashcan"
  | "dog" | "cat" | "bicycle" | "gnome" | "cone" | "newsbox";

interface Obstacle {
  x: number;
  obsWidth: number;   // horizontal footprint
  obsHeight: number;  // height above road surface
  type: ObstacleType;
  passed: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

const GRAVITY = 0.88;
const JUMP_FORCE = -18.5;
const BASE_SPEED = 2.0;

// playerY is the palm center; finger tips reach ~90px below palm
const FINGER_TIP_OFFSET = 90;
// Road surface is at height - 108 (matches drawBackground)
const ROAD_SURFACE_OFFSET = 108;

function getGroundY(height: number) {
  return height - ROAD_SURFACE_OFFSET - FINGER_TIP_OFFSET - 8;
}

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    gameRunning: false,
    score: 0,
    bestScore: parseInt(localStorage.getItem("fingerRunnerBest") || "0"),
    time: 0,
    velocity: 0,
    playerY: 300,
    spawnTimer: 0,
    onGround: true,
    obstacles: [] as Obstacle[],
    particles: [] as Particle[],
  });
  const audioRef = useRef<{
    ctx: AudioContext | null;
    enabled: boolean;
    interval: ReturnType<typeof setInterval> | null;
    melodyOsc: OscillatorNode | null;
    bassOsc: OscillatorNode | null;
    kickOsc: OscillatorNode | null;
    step: number;
  }>({
    ctx: null,
    enabled: true,
    interval: null,
    melodyOsc: null,
    bassOsc: null,
    kickOsc: null,
    step: 0,
  });
  const rafRef = useRef<number>(0);
  const [screen, setScreen] = useState<"start" | "playing" | "dead">("start");
  const [musicOn, setMusicOn] = useState(true);

  const initAudio = () => {
    const a = audioRef.current;
    if (!a.ctx) {
      a.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
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
      const ctx = a.ctx;
      if (!ctx) return;
      const running = stateRef.current.gameRunning;
      const t = ctx.currentTime;
      const baseNote = 220;
      const melodyNotes = [0, 4, 7, 12, 7, 4, 0, 2, 5, 9, 5, 2];
      const note = baseNote * Math.pow(2, melodyNotes[a.step % melodyNotes.length] / 12);

      try { if (a.melodyOsc) a.melodyOsc.stop(); } catch {}
      a.melodyOsc = ctx.createOscillator();
      const mGain = ctx.createGain();
      const mFilter = ctx.createBiquadFilter();
      a.melodyOsc.type = "sawtooth";
      a.melodyOsc.frequency.value = note;
      mFilter.type = "lowpass";
      mFilter.frequency.value = 1800;
      const vol = running ? 0.18 : 0.09;
      const envTime = running ? 0.38 : 0.55;
      mGain.gain.value = vol;
      mGain.gain.setValueAtTime(vol, t);
      mGain.gain.linearRampToValueAtTime(0.001, t + envTime);
      a.melodyOsc.connect(mFilter);
      mFilter.connect(mGain);
      mGain.connect(ctx.destination);
      a.melodyOsc.start(t);
      a.melodyOsc.stop(t + envTime + 0.05);

      if (a.step % 2 === 0) {
        try { if (a.bassOsc) a.bassOsc.stop(); } catch {}
        a.bassOsc = ctx.createOscillator();
        const bGain = ctx.createGain();
        a.bassOsc.type = "sine";
        a.bassOsc.frequency.value = baseNote / 2;
        bGain.gain.value = running ? 0.55 : 0.3;
        bGain.gain.linearRampToValueAtTime(0.001, t + 0.65);
        a.bassOsc.connect(bGain);
        bGain.connect(ctx.destination);
        a.bassOsc.start(t);
        a.bassOsc.stop(t + 0.7);
      }

      if (a.step % 4 === 0) {
        try { if (a.kickOsc) a.kickOsc.stop(); } catch {}
        a.kickOsc = ctx.createOscillator();
        const kGain = ctx.createGain();
        const kFilter = ctx.createBiquadFilter();
        a.kickOsc.type = "sine";
        a.kickOsc.frequency.value = 95;
        kFilter.type = "lowpass";
        kFilter.frequency.value = 450;
        kGain.gain.value = 1.1;
        kGain.gain.linearRampToValueAtTime(0.001, t + 0.45);
        a.kickOsc.frequency.setValueAtTime(95, t);
        a.kickOsc.frequency.linearRampToValueAtTime(42, t + 0.25);
        a.kickOsc.connect(kFilter);
        kFilter.connect(kGain);
        kGain.connect(ctx.destination);
        a.kickOsc.start(t);
        a.kickOsc.stop(t + 0.5);
      }

      a.step++;
    }, isPlaying ? 185 : 280);
  };

  const playJumpSound = () => {
    const a = audioRef.current;
    if (!a.enabled || !a.ctx) return;
    const ctx = a.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = "sawtooth";
    osc.frequency.value = 680;
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    gain.gain.value = 0.35;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(680, t);
    osc.frequency.linearRampToValueAtTime(420, t + 0.18);
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.22);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  };

  const playCrashSound = () => {
    const a = audioRef.current;
    if (!a.enabled || !a.ctx) return;
    const ctx = a.ctx;
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.8, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.9, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.75);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(t);
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = "sine";
    boom.frequency.value = 65;
    boomGain.gain.value = 1.2;
    boomGain.gain.linearRampToValueAtTime(0.001, t + 1.1);
    boom.connect(boomGain);
    boomGain.connect(ctx.destination);
    boom.start(t);
    boom.stop(t + 1.2);
  };

  // Obstacle catalogue — things a kid sees from a car window
  const OBSTACLE_TYPES: Array<{ type: ObstacleType; w: number; h: number }> = [
    { type: "mailbox",  w: 55,  h: 74  },
    { type: "hydrant",  w: 48,  h: 64  },
    { type: "stopsign", w: 30,  h: 100 },
    { type: "trashcan", w: 52,  h: 72  },
    { type: "dog",      w: 78,  h: 52  },
    { type: "cat",      w: 44,  h: 46  },
    { type: "bicycle",  w: 84,  h: 76  },
    { type: "gnome",    w: 40,  h: 68  },
    { type: "cone",     w: 50,  h: 62  },
    { type: "newsbox",  w: 54,  h: 66  },
  ];

  const spawnObstacle = (width: number) => {
    const pick = OBSTACLE_TYPES[Math.floor(Math.random() * OBSTACLE_TYPES.length)];
    stateRef.current.obstacles.push({
      x: width + 80,
      obsWidth: pick.w,
      obsHeight: pick.h,
      type: pick.type,
      passed: false,
    });
  };

  const createCrashExplosion = (x: number, y: number) => {
    const st = stateRef.current;
    for (let i = 0; i < 35; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.2 + Math.random() * 5.5;
      st.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.8,
        life: 38 + Math.random() * 25,
        size: 6 + Math.random() * 7,
        color: ["#f1c27d", "#c8946f", "#ff6b6b", "#888"][Math.floor(Math.random() * 4)],
      });
    }
  };

  const crash = () => {
    const st = stateRef.current;
    if (!st.gameRunning) return;
    st.gameRunning = false;
    playCrashSound();
    createCrashExplosion(185, st.playerY + 30);
    if (st.score > st.bestScore) {
      st.bestScore = Math.floor(st.score);
      localStorage.setItem("fingerRunnerBest", String(st.bestScore));
    }
    stopMusic();
    setTimeout(() => {
      if (!stateRef.current.gameRunning && audioRef.current.enabled) startMusic(false);
    }, 600);
    setScreen("dead");
  };

  const jump = () => {
    initAudio();
    const st = stateRef.current;
    if (!st.gameRunning) return;
    // Only jump from ground (or allow a single mid-air re-jump when close to ground)
    if (!st.onGround && st.jumpsUsed >= 2) return;
    st.jumpsUsed = (st.jumpsUsed || 0) + 1;
    st.velocity = JUMP_FORCE;
    st.onGround = false;
    playJumpSound();
    for (let i = 0; i < 8; i++) {
      st.particles.push({
        x: 175 + Math.random() * 30,
        y: st.playerY + 80,
        vx: (Math.random() - 0.5) * 5,
        vy: -2 + Math.random() * 2,
        life: 22,
        size: 4 + Math.random() * 4,
        color: "#d4916a",
      });
    }
  };

  const startGame = (canvas: HTMLCanvasElement) => {
    initAudio();
    const st = stateRef.current;
    const groundY = getGroundY(canvas.height);
    st.gameRunning = true;
    st.score = 0;
    st.obstacles = [];
    st.particles = [];
    st.playerY = groundY;
    st.velocity = 0;
    st.onGround = true;
    st.jumpsUsed = 0;
    st.spawnTimer = 0;
    st.time = 0;
    setScreen("playing");
    stopMusic();
    if (audioRef.current.enabled) setTimeout(() => startMusic(true), 80);
  };

  const drawBackground = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, "#5db8f0");
    grad.addColorStop(0.45, "#8ed0ff");
    grad.addColorStop(1, "#c8e8ff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#7aa8c2";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.72);
    ctx.quadraticCurveTo(width * 0.25, height * 0.48, width * 0.55, height * 0.76);
    ctx.quadraticCurveTo(width * 0.82, height * 0.42, width, height * 0.69);
    ctx.lineTo(width, height); ctx.lineTo(0, height);
    ctx.fill();

    ctx.fillStyle = "#5d8a9e";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.78);
    ctx.quadraticCurveTo(width * 0.35, height * 0.58, width * 0.7, height * 0.81);
    ctx.quadraticCurveTo(width * 0.92, height * 0.62, width, height * 0.77);
    ctx.lineTo(width, height); ctx.lineTo(0, height);
    ctx.fill();

    // Sidewalk / grass strip
    ctx.fillStyle = "#7db560";
    ctx.fillRect(0, height - 108, width, 18);
    // Road
    ctx.fillStyle = "#555e6a";
    ctx.fillRect(0, height - 90, width, 90);
    // Curb
    ctx.fillStyle = "#8a929e";
    ctx.fillRect(0, height - 92, width, 5);
    // Road dashes
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 4;
    for (let i = -1; i < 7; i++) {
      const xPos = ((time * 3.8) % (width + 180)) + i * (width / 5.5) - 90;
      ctx.beginPath();
      ctx.moveTo(xPos, height - 50);
      ctx.lineTo(xPos + 60, height - 50);
      ctx.stroke();
    }
  };

  // ── Obstacle drawings ────────────────────────────────────────────────────────
  const drawObstacle = (ctx: CanvasRenderingContext2D, o: Obstacle, height: number) => {
    const roadY = height - ROAD_SURFACE_OFFSET; // road surface Y
    const gx = o.x + o.obsWidth / 2;           // center x
    const by = roadY;                            // base (bottom) y

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (o.type === "mailbox") {
      // Wooden post
      ctx.fillStyle = "#8B5E3C";
      ctx.fillRect(gx - 5, by - o.obsHeight, 10, o.obsHeight);
      // Box body
      ctx.fillStyle = "#b0b8c5";
      ctx.beginPath();
      ctx.roundRect(gx - 20, by - o.obsHeight, 42, 32, 4);
      ctx.fill();
      // Box lid (arched top)
      ctx.fillStyle = "#c8d0db";
      ctx.beginPath();
      ctx.ellipse(gx + 1, by - o.obsHeight + 2, 21, 12, 0, Math.PI, 0);
      ctx.fill();
      // Mail slot
      ctx.fillStyle = "#888";
      ctx.fillRect(gx - 14, by - o.obsHeight + 18, 28, 4);
      // Red flag
      ctx.fillStyle = "#e53935";
      ctx.fillRect(gx + 18, by - o.obsHeight + 5, 4, 18);
      ctx.fillRect(gx + 18, by - o.obsHeight + 5, 14, 10);
      // Address numbers
      ctx.fillStyle = "#555";
      ctx.font = "bold 9px Arial";
      ctx.textAlign = "center";
      ctx.fillText("42", gx, by - o.obsHeight + 30);

    } else if (o.type === "hydrant") {
      const hy = by - o.obsHeight;
      // Base flange
      ctx.fillStyle = "#c62828";
      ctx.beginPath();
      ctx.ellipse(gx, by - 6, 22, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      // Main barrel
      ctx.fillStyle = "#e53935";
      ctx.beginPath();
      ctx.roundRect(gx - 16, hy + 14, 32, o.obsHeight - 20, 6);
      ctx.fill();
      // Dome top
      ctx.fillStyle = "#ff5252";
      ctx.beginPath();
      ctx.ellipse(gx, hy + 16, 16, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      // Cap on top
      ctx.fillStyle = "#ffd600";
      ctx.beginPath();
      ctx.ellipse(gx, hy + 6, 9, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Side nozzles
      ctx.fillStyle = "#c62828";
      ctx.fillRect(gx - 24, by - 38, 10, 12);
      ctx.fillRect(gx + 14, by - 38, 10, 12);
      // Nozzle caps
      ctx.fillStyle = "#ffd600";
      ctx.beginPath(); ctx.arc(gx - 19, by - 32, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(gx + 19, by - 32, 5, 0, Math.PI * 2); ctx.fill();
      // Shine
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.beginPath();
      ctx.ellipse(gx - 5, hy + 20, 5, 10, -0.3, 0, Math.PI * 2);
      ctx.fill();

    } else if (o.type === "stopsign") {
      // Metal pole
      ctx.fillStyle = "#888";
      ctx.fillRect(gx - 4, by - o.obsHeight, 8, o.obsHeight);
      ctx.fillStyle = "#aaa";
      ctx.fillRect(gx - 3, by - o.obsHeight, 4, o.obsHeight);
      // Octagon sign
      const sr = 22;
      const sy = by - o.obsHeight + sr + 4;
      ctx.fillStyle = "#cc0000";
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 - Math.PI / 8;
        const px = gx + sr * Math.cos(a);
        const py = sy + sr * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      // White border
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // STOP text
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px Arial";
      ctx.textAlign = "center";
      ctx.fillText("STOP", gx, sy + 4);

    } else if (o.type === "trashcan") {
      const tw = 40;
      const th = o.obsHeight;
      // Can body (slightly tapered)
      ctx.fillStyle = "#78909c";
      ctx.beginPath();
      ctx.moveTo(gx - tw / 2 + 4, by - th + 14);
      ctx.lineTo(gx + tw / 2 - 4, by - th + 14);
      ctx.lineTo(gx + tw / 2 + 2, by);
      ctx.lineTo(gx - tw / 2 - 2, by);
      ctx.closePath();
      ctx.fill();
      // Lid
      ctx.fillStyle = "#546e7a";
      ctx.beginPath();
      ctx.roundRect(gx - tw / 2 - 4, by - th + 4, tw + 8, 14, 4);
      ctx.fill();
      // Lid handle
      ctx.fillStyle = "#78909c";
      ctx.fillRect(gx - 8, by - th, 16, 6);
      // Horizontal ribs
      ctx.strokeStyle = "#546e7a";
      ctx.lineWidth = 2;
      for (let r = 1; r <= 3; r++) {
        const ry = by - th + 14 + r * ((th - 14) / 4);
        ctx.beginPath();
        ctx.moveTo(gx - tw / 2 + 2, ry);
        ctx.lineTo(gx + tw / 2 - 2, ry);
        ctx.stroke();
      }
      // Shine
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(gx - tw / 2 + 6, by - th + 18, 8, th - 20);

    } else if (o.type === "dog") {
      const dy = by - o.obsHeight;
      // Body
      ctx.fillStyle = "#c4954a";
      ctx.beginPath();
      ctx.ellipse(gx - 5, dy + 22, 32, 18, 0.1, 0, Math.PI * 2);
      ctx.fill();
      // Head
      ctx.fillStyle = "#d4a55a";
      ctx.beginPath();
      ctx.ellipse(gx + 28, dy + 14, 18, 16, -0.2, 0, Math.PI * 2);
      ctx.fill();
      // Ear (floppy)
      ctx.fillStyle = "#b07030";
      ctx.beginPath();
      ctx.ellipse(gx + 34, dy + 18, 8, 14, 0.6, 0, Math.PI * 2);
      ctx.fill();
      // Snout
      ctx.fillStyle = "#c4954a";
      ctx.beginPath();
      ctx.ellipse(gx + 44, dy + 20, 10, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      // Nose
      ctx.fillStyle = "#333";
      ctx.beginPath();
      ctx.ellipse(gx + 53, dy + 17, 4, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eye
      ctx.fillStyle = "#222";
      ctx.beginPath();
      ctx.arc(gx + 36, dy + 10, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(gx + 37, dy + 9, 1.2, 0, Math.PI * 2);
      ctx.fill();
      // Tail (curled up)
      ctx.strokeStyle = "#b07030";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(gx - 36, dy + 12, 14, 0.2, Math.PI * 1.4);
      ctx.stroke();
      // Legs (4 stubs)
      ctx.fillStyle = "#b07030";
      const legPositions = [gx - 18, gx - 5, gx + 8, gx + 20];
      for (const lx of legPositions) {
        ctx.fillRect(lx - 4, dy + 34, 8, 16);
      }
      // Paws
      ctx.fillStyle = "#c4954a";
      for (const lx of legPositions) {
        ctx.beginPath();
        ctx.ellipse(lx, dy + 50, 6, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }

    } else if (o.type === "cat") {
      const cy2 = by - o.obsHeight;
      // Body (sitting)
      ctx.fillStyle = "#888";
      ctx.beginPath();
      ctx.ellipse(gx, cy2 + 22, 16, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      // Head
      ctx.fillStyle = "#999";
      ctx.beginPath();
      ctx.arc(gx, cy2 + 6, 14, 0, Math.PI * 2);
      ctx.fill();
      // Ears
      ctx.fillStyle = "#999";
      ctx.beginPath();
      ctx.moveTo(gx - 10, cy2); ctx.lineTo(gx - 16, cy2 - 12); ctx.lineTo(gx - 2, cy2 - 4);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(gx + 10, cy2); ctx.lineTo(gx + 16, cy2 - 12); ctx.lineTo(gx + 2, cy2 - 4);
      ctx.fill();
      // Inner ear
      ctx.fillStyle = "#f48fb1";
      ctx.beginPath();
      ctx.moveTo(gx - 9, cy2 - 1); ctx.lineTo(gx - 13, cy2 - 9); ctx.lineTo(gx - 3, cy2 - 4);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(gx + 9, cy2 - 1); ctx.lineTo(gx + 13, cy2 - 9); ctx.lineTo(gx + 3, cy2 - 4);
      ctx.fill();
      // Eyes (slanted)
      ctx.fillStyle = "#4caf50";
      ctx.beginPath(); ctx.ellipse(gx - 5, cy2 + 5, 4, 3, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(gx + 5, cy2 + 5, 4, 3, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.ellipse(gx - 5, cy2 + 5, 2, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(gx + 5, cy2 + 5, 2, 3, 0, 0, Math.PI * 2); ctx.fill();
      // Nose & whiskers
      ctx.fillStyle = "#f48fb1";
      ctx.beginPath(); ctx.arc(gx, cy2 + 10, 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#bbb"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx - 3, cy2 + 10); ctx.lineTo(gx - 14, cy2 + 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx + 3, cy2 + 10); ctx.lineTo(gx + 14, cy2 + 9); ctx.stroke();
      // Tail (curved around side)
      ctx.strokeStyle = "#888"; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(gx + 14, cy2 + 28);
      ctx.quadraticCurveTo(gx + 30, cy2 + 36, gx + 22, cy2 + 44);
      ctx.stroke();

    } else if (o.type === "bicycle") {
      const bby = by - 12;
      const wr = 30; // wheel radius
      const lx = o.x + wr + 4;
      const rx = o.x + o.obsWidth - wr - 4;
      const axleY = bby - wr;
      // Wheels
      for (const wx of [lx, rx]) {
        // Tire
        ctx.strokeStyle = "#222"; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(wx, axleY, wr, 0, Math.PI * 2); ctx.stroke();
        // Rim
        ctx.strokeStyle = "#999"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(wx, axleY, wr - 4, 0, Math.PI * 2); ctx.stroke();
        // Spokes
        ctx.strokeStyle = "#aaa"; ctx.lineWidth = 1.5;
        for (let sp = 0; sp < 6; sp++) {
          const a = (sp * Math.PI) / 3;
          ctx.beginPath();
          ctx.moveTo(wx, axleY);
          ctx.lineTo(wx + (wr - 5) * Math.cos(a), axleY + (wr - 5) * Math.sin(a));
          ctx.stroke();
        }
        // Hub
        ctx.fillStyle = "#888";
        ctx.beginPath(); ctx.arc(wx, axleY, 5, 0, Math.PI * 2); ctx.fill();
      }
      // Frame
      ctx.strokeStyle = "#e53935"; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(lx, axleY);
      ctx.lineTo(gx - 2, axleY - wr + 6); // seat post
      ctx.lineTo(rx, axleY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gx - 2, axleY - wr + 6);
      ctx.lineTo(rx, axleY);
      ctx.stroke();
      // Handle bars
      ctx.strokeStyle = "#888"; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(rx, axleY);
      ctx.lineTo(rx - 2, axleY - 18);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rx - 8, axleY - 18);
      ctx.lineTo(rx + 8, axleY - 18);
      ctx.stroke();
      // Seat
      ctx.fillStyle = "#333";
      ctx.beginPath();
      ctx.roundRect(gx - 18, axleY - wr + 2, 32, 8, 4);
      ctx.fill();

    } else if (o.type === "gnome") {
      const gy = by - o.obsHeight;
      // Legs
      ctx.fillStyle = "#1565c0";
      ctx.fillRect(gx - 12, gy + 42, 9, 24);
      ctx.fillRect(gx + 3, gy + 42, 9, 24);
      // Boots
      ctx.fillStyle = "#4e342e";
      ctx.beginPath(); ctx.ellipse(gx - 8, by - 4, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(gx + 8, by - 4, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      // Body / coat
      ctx.fillStyle = "#c62828";
      ctx.beginPath();
      ctx.moveTo(gx - 16, gy + 44);
      ctx.quadraticCurveTo(gx - 18, gy + 22, gx, gy + 18);
      ctx.quadraticCurveTo(gx + 18, gy + 22, gx + 16, gy + 44);
      ctx.closePath();
      ctx.fill();
      // Belt
      ctx.fillStyle = "#4e342e"; ctx.fillRect(gx - 14, gy + 38, 28, 6);
      ctx.fillStyle = "#ffd600";
      ctx.beginPath(); ctx.roundRect(gx - 5, gy + 37, 10, 8, 2); ctx.fill();
      // Head
      ctx.fillStyle = "#ffcc80";
      ctx.beginPath(); ctx.arc(gx, gy + 14, 13, 0, Math.PI * 2); ctx.fill();
      // Beard
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(gx - 10, gy + 18);
      ctx.quadraticCurveTo(gx, gy + 28, gx + 10, gy + 18);
      ctx.quadraticCurveTo(gx, gy + 34, gx - 10, gy + 18);
      ctx.fill();
      // Eyes
      ctx.fillStyle = "#333";
      ctx.beginPath(); ctx.arc(gx - 4, gy + 12, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(gx + 4, gy + 12, 2, 0, Math.PI * 2); ctx.fill();
      // Pointy hat
      ctx.fillStyle = "#c62828";
      ctx.beginPath();
      ctx.moveTo(gx, gy - 4);
      ctx.lineTo(gx - 13, gy + 4);
      ctx.lineTo(gx + 13, gy + 4);
      ctx.closePath();
      ctx.fill();
      // Hat brim
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.ellipse(gx, gy + 4, 15, 5, 0, 0, Math.PI * 2); ctx.fill();

    } else if (o.type === "cone") {
      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.beginPath();
      ctx.ellipse(gx, by - 3, 22, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      // Main cone body
      ctx.fillStyle = "#f57c00";
      ctx.beginPath();
      ctx.moveTo(gx, by - o.obsHeight);
      ctx.lineTo(gx - 22, by - 5);
      ctx.lineTo(gx + 22, by - 5);
      ctx.closePath();
      ctx.fill();
      // White stripes
      ctx.fillStyle = "#fff";
      for (let s = 0; s < 2; s++) {
        const sy2 = by - o.obsHeight + (o.obsHeight * 0.4) + s * (o.obsHeight * 0.22);
        const sw = 5 + s * 10;
        ctx.beginPath();
        ctx.moveTo(gx - sw, sy2);
        ctx.lineTo(gx + sw, sy2);
        ctx.lineTo(gx + sw + 4, sy2 + 10);
        ctx.lineTo(gx - sw - 4, sy2 + 10);
        ctx.closePath();
        ctx.fill();
      }
      // Base plate
      ctx.fillStyle = "#e65100";
      ctx.beginPath();
      ctx.roundRect(gx - 24, by - 8, 48, 8, 2);
      ctx.fill();

    } else if (o.type === "newsbox") {
      const nw = 46;
      const nh = o.obsHeight;
      // Stand legs
      ctx.fillStyle = "#555"; ctx.fillRect(gx - 14, by - 20, 6, 20); ctx.fillRect(gx + 8, by - 20, 6, 20);
      // Main box body
      ctx.fillStyle = "#1976d2";
      ctx.beginPath(); ctx.roundRect(gx - nw / 2, by - nh, nw, nh - 14, 5); ctx.fill();
      // Glass window
      ctx.fillStyle = "#bbdefb";
      ctx.beginPath(); ctx.roundRect(gx - nw / 2 + 4, by - nh + 4, nw - 8, nh - 28, 3); ctx.fill();
      // Newspaper visible inside
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.roundRect(gx - nw / 2 + 6, by - nh + 7, nw - 12, nh - 34, 2); ctx.fill();
      ctx.fillStyle = "#333"; ctx.font = "bold 8px Arial"; ctx.textAlign = "center";
      ctx.fillText("NEWS", gx, by - nh + 16);
      ctx.fillStyle = "#666"; ctx.font = "6px Arial";
      ctx.fillText("DAILY", gx, by - nh + 24);
      // Coin slot
      ctx.fillStyle = "#0d47a1";
      ctx.fillRect(gx - nw / 2 + 6, by - nh + nh - 22, nw - 12, 6);
      ctx.fillStyle = "#1565c0"; ctx.fillRect(gx - 4, by - nh + nh - 22, 8, 6);
    }

    ctx.restore();
  };

  // Free-floating hand: palm as body, two two-segment finger-legs running
  const drawFinger = (
    ctx: CanvasRenderingContext2D,
    playerY: number,
    time: number,
    _height: number,
    gameRunning: boolean,
  ) => {
    const cx = 185;
    const strideSpeed = gameRunning ? 0.26 : 0.05;
    const stride = Math.sin(time * strideSpeed);
    const bodyBob = gameRunning ? Math.abs(stride) * -6 : Math.sin(time * 0.05) * 2;
    const palmY = playerY + bodyBob;

    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.beginPath();
    ctx.ellipse(cx, palmY + 115, 30, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    const drawFingerLeg = (baseX: number, baseY: number, swing: number, skin: string, dark: string) => {
      const seg1 = 34;
      const seg2 = 28;
      const j1x = baseX + Math.sin(swing) * seg1;
      const j1y = baseY + Math.cos(swing) * seg1;
      const bendOut = swing * 0.55 + (swing > 0 ? 0.28 : -0.28);
      const tipX = j1x + Math.sin(bendOut) * seg2;
      const tipY = j1y + Math.cos(bendOut) * seg2;

      ctx.lineCap = "round";
      ctx.strokeStyle = dark; ctx.lineWidth = 19;
      ctx.beginPath(); ctx.moveTo(baseX, baseY + 1); ctx.lineTo(j1x + 1, j1y + 1); ctx.stroke();
      ctx.strokeStyle = skin; ctx.lineWidth = 17;
      ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(j1x, j1y); ctx.stroke();
      ctx.strokeStyle = dark; ctx.lineWidth = 16;
      ctx.beginPath(); ctx.moveTo(j1x + 1, j1y + 1); ctx.lineTo(tipX + 1, tipY + 1); ctx.stroke();
      ctx.strokeStyle = skin; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.moveTo(j1x, j1y); ctx.lineTo(tipX, tipY); ctx.stroke();

      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(j1x, j1y, 9.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(j1x, j1y, 7.5, 0, Math.PI * 2); ctx.fill();
      const kAngle = Math.atan2(j1y - baseY, j1x - baseX) + Math.PI / 2;
      ctx.strokeStyle = dark; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(j1x + Math.cos(kAngle) * 6, j1y + Math.sin(kAngle) * 6);
      ctx.lineTo(j1x - Math.cos(kAngle) * 6, j1y - Math.sin(kAngle) * 6);
      ctx.stroke();

      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(tipX, tipY, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f8c090"; ctx.beginPath(); ctx.arc(tipX - 1, tipY - 1, 7, 0, Math.PI * 2); ctx.fill();

      const nDir = Math.atan2(tipY - j1y, tipX - j1x);
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate(nDir - Math.PI / 2);
      ctx.fillStyle = "#d9a080"; ctx.beginPath(); ctx.roundRect(-5, -9, 10, 10, 3); ctx.fill();
      ctx.fillStyle = "#fdf5f0"; ctx.beginPath(); ctx.roundRect(-4, -8, 8, 7, 2); ctx.fill();
      ctx.strokeStyle = "rgba(140,70,40,0.25)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.stroke();
      ctx.restore();

      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(baseX, baseY, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(baseX - 1, baseY - 1, 8, 0, Math.PI * 2); ctx.fill();
    };

    ctx.save();
    ctx.translate(cx, palmY);
    ctx.rotate(-0.1);

    ctx.fillStyle = "#bf7040"; ctx.beginPath(); ctx.roundRect(-33, -26, 66, 54, 16); ctx.fill();
    ctx.fillStyle = "#eda068"; ctx.beginPath(); ctx.roundRect(-31, -24, 62, 50, 14); ctx.fill();
    ctx.fillStyle = "#cc8448"; ctx.beginPath(); ctx.roundRect(-29, -26, 58, 18, [14, 14, 0, 0]); ctx.fill();

    for (let k = -1; k <= 1; k++) {
      ctx.fillStyle = "#b06030"; ctx.beginPath(); ctx.ellipse(k * 19, -22, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#dd9858"; ctx.beginPath(); ctx.ellipse(k * 19 - 1, -25, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
    }

    ctx.strokeStyle = "#b86830"; ctx.lineWidth = 11; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(21, -20, 12, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(31, -17, 9, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();

    ctx.fillStyle = "#eda068"; ctx.beginPath(); ctx.ellipse(-36, 5, 12, 17, -0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c07840"; ctx.beginPath(); ctx.ellipse(-37, 0, 7.5, 12, -0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#d9a080"; ctx.beginPath(); ctx.roundRect(-42, -7, 9, 12, 3); ctx.fill();
    ctx.fillStyle = "#fdf5f0"; ctx.beginPath(); ctx.roundRect(-41, -6, 7, 9, 2); ctx.fill();

    ctx.strokeStyle = "rgba(140,60,20,0.30)"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-24, 4); ctx.quadraticCurveTo(0, 0, 24, 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-22, 14); ctx.quadraticCurveTo(0, 11, 21, 16); ctx.stroke();

    ctx.restore();

    const baseY = palmY + 26;
    const indexSwing  =  stride * 0.54;
    const middleSwing = -stride * 0.54;
    drawFingerLeg(cx + 12, baseY, middleSwing, "#e8a060", "#b86830");
    drawFingerLeg(cx - 12, baseY, indexSwing,  "#f0b070", "#c87840");
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); jump(); }
    };
    document.addEventListener("keydown", onKey);

    const loop = () => {
      const st = stateRef.current;
      const width = canvas.width;
      const height = canvas.height;
      const groundY = getGroundY(height);
      const roadY = height - ROAD_SURFACE_OFFSET;

      if (st.gameRunning) {
        st.time++;
        st.score += 0.6;

        // Physics
        st.velocity += GRAVITY;
        st.playerY += st.velocity;

        if (st.playerY >= groundY) {
          st.playerY = groundY;
          st.velocity = 0;
          st.onGround = true;
          st.jumpsUsed = 0;
        } else {
          st.onGround = false;
        }
        if (st.playerY < 30) { st.playerY = 30; st.velocity = 1; }

        // Spawn — starts very slow, ramps up gradually
        st.spawnTimer++;
        const spawnRate = Math.max(90, 220 - Math.floor(st.score / 6));
        if (st.spawnTimer > spawnRate) {
          spawnObstacle(width);
          st.spawnTimer = 0;
        }

        // Update obstacles + collision (hitbox shrunk for fairness)
        const fingerLeft  = 168;
        const fingerRight = 202;
        const fingerTipY  = st.playerY + FINGER_TIP_OFFSET - 8;

        let didCrash = false;
        for (let i = st.obstacles.length - 1; i >= 0; i--) {
          const o = st.obstacles[i];
          o.x -= BASE_SPEED + st.score * 0.0018;

          if (!didCrash) {
            const obsLeft  = o.x;
            const obsRight = o.x + o.obsWidth;
            const obsTop   = roadY - o.obsHeight;
            if (fingerRight > obsLeft && fingerLeft < obsRight && fingerTipY > obsTop) {
              crash();
              didCrash = true;
            }
          }

          if (!o.passed && o.x + o.obsWidth < fingerLeft) o.passed = true;
          if (o.x < -150) st.obstacles.splice(i, 1);
        }

        // Particles
        for (let i = st.particles.length - 1; i >= 0; i--) {
          const p = st.particles[i];
          p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.life--;
          if (p.life <= 0) st.particles.splice(i, 1);
        }
      } else {
        st.time++;
        // Keep idle character at ground
        const groundY2 = getGroundY(height);
        if (!stateRef.current.gameRunning) st.playerY = groundY2;
      }

      // Draw
      drawBackground(ctx, width, height, st.time);
      for (const o of st.obstacles) drawObstacle(ctx, o, height);

      ctx.shadowBlur = 0;
      for (const p of st.particles) {
        ctx.globalAlpha = Math.max(0.15, p.life / 45);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size || 6, p.size || 6);
      }
      ctx.globalAlpha = 1;

      drawFinger(ctx, st.playerY, st.time, height, st.gameRunning);

      // HUD
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 6;
      ctx.fillStyle = "#fff";
      ctx.font = "bold 56px Arial";
      ctx.textAlign = "left";
      ctx.fillText(String(Math.floor(st.score)), 38, 82);
      ctx.font = "bold 24px Arial";
      ctx.fillText("BEST " + st.bestScore, 40, 118);
      ctx.shadowBlur = 0;

      // Game over
      if (!st.gameRunning && st.score > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.beginPath();
        ctx.roundRect(width / 2 - 240, height / 2 - 135, 480, 270, 18);
        ctx.fill();
        ctx.fillStyle = "#ff6b6b"; ctx.textAlign = "center";
        ctx.font = "bold 48px Arial";
        ctx.fillText("OUCH! 🤕", width / 2, height / 2 - 58);
        ctx.fillStyle = "#fff"; ctx.font = "bold 30px Arial";
        ctx.fillText("Distance: " + Math.floor(st.score), width / 2, height / 2 - 12);
        if (Math.floor(st.score) >= st.bestScore && st.score > 5) {
          ctx.fillStyle = "#ffd700"; ctx.font = "bold 26px Arial";
          ctx.fillText("★ NEW RECORD! ★", width / 2, height / 2 + 30);
        }
        ctx.fillStyle = "#ddd"; ctx.font = "22px Arial";
        ctx.fillText("Tap or press SPACE to run again!", width / 2, height / 2 + 100);
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

  const handleStart = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    startGame(canvas);
  };

  const handleCanvasClick = () => {
    const st = stateRef.current;
    if (st.gameRunning) {
      jump();
    } else if (st.score > 0) {
      const canvas = canvasRef.current;
      if (canvas) startGame(canvas);
    }
  };

  const handleToggleMusic = () => {
    const newVal = !audioRef.current.enabled;
    audioRef.current.enabled = newVal;
    setMusicOn(newVal);
    if (newVal) startMusic(stateRef.current.gameRunning);
    else stopMusic();
  };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#87CEEB", touchAction: "none" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} onPointerDown={handleCanvasClick} />

      {screen === "start" && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", color: "white",
          textShadow: "0 2px 4px rgba(0,0,0,0.6)", zIndex: 10,
          background: "rgba(0,0,0,0.45)", fontFamily: "Arial, sans-serif",
        }}>
          <h1 style={{ fontSize: "3.8rem", margin: "0 0 12px 0", color: "#ffd700", textShadow: "0 4px 8px rgba(0,0,0,0.5)" }}>
            👆 FINGER RUNNER
          </h1>
          <p style={{ fontSize: "1.45rem", margin: "6px 0" }}>Your fingers are running along the road!</p>
          <p style={{ fontSize: "1.45rem", margin: "6px 0" }}>Tap or press SPACE to jump over obstacles</p>
          <p style={{ fontSize: "1.45rem", margin: "6px 0" }}>Dogs 🐶 Hydrants 🔴 Gnomes 🎅 Bikes 🚲 &amp; more!</p>
          <button
            onClick={handleStart}
            style={{
              marginTop: 28, padding: "16px 48px", fontSize: "1.55rem",
              background: "#ff4757", color: "white", border: "none",
              borderRadius: 60, cursor: "pointer", boxShadow: "0 8px 0 #c2363e",
              transition: "all 0.1s", fontFamily: "Arial, sans-serif",
            }}
            onMouseDown={e => { e.currentTarget.style.transform = "translateY(4px)"; e.currentTarget.style.boxShadow = "0 4px 0 #c2363e"; }}
            onMouseUp={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 8px 0 #c2363e"; }}
          >
            START RUNNING
          </button>
        </div>
      )}

      <button
        onClick={handleToggleMusic}
        style={{
          position: "absolute", top: 20, right: 20, zIndex: 20,
          padding: "10px 18px", fontSize: "1.1rem",
          background: "rgba(0,0,0,0.6)", color: "white",
          border: "2px solid #ffd700", borderRadius: 30, cursor: "pointer",
          fontFamily: "Arial, sans-serif",
        }}
      >
        🎵 Music: {musicOn ? "ON" : "OFF"}
      </button>
    </div>
  );
}
