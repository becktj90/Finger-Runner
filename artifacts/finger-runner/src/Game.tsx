import { useEffect, useRef, useState } from "react";

interface Obstacle {
  x: number;
  top: number;
  gap: number;
  type: "tree" | "pole" | "sign" | "bush";
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

const GRAVITY = 0.52;
const JUMP_FORCE = -13.5;
const BASE_SPEED = 4.5;

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
  const screenRef = useRef(screen);
  screenRef.current = screen;

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

  const spawnObstacle = (width: number, height: number) => {
    const st = stateRef.current;
    const gapSize = Math.max(155, 235 - Math.floor(st.score / 7));
    const minTop = 75;
    const maxTop = height - gapSize - 155;
    const topHeight = minTop + Math.random() * (maxTop - minTop);
    const types: Obstacle["type"][] = ["tree", "pole", "sign", "bush"];
    const type = types[Math.floor(Math.random() * types.length)];
    st.obstacles.push({ x: width + 90, top: topHeight, gap: gapSize, type, passed: false });
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
    createCrashExplosion(175, st.playerY + 25);
    if (st.score > st.bestScore) {
      st.bestScore = Math.floor(st.score);
      localStorage.setItem("fingerRunnerBest", String(st.bestScore));
    }
    stopMusic();
    setTimeout(() => {
      if (!stateRef.current.gameRunning && audioRef.current.enabled) {
        startMusic(false);
      }
    }, 600);
    setScreen("dead");
  };

  const jump = () => {
    initAudio();
    const st = stateRef.current;
    if (!st.gameRunning) return;
    st.velocity = JUMP_FORCE;
    playJumpSound();
    for (let i = 0; i < 9; i++) {
      st.particles.push({
        x: 175 + Math.random() * 35,
        y: st.playerY + 35,
        vx: -2.5 - Math.random() * 3.5,
        vy: -2.5 + Math.random() * 4,
        life: 26,
        size: 5 + Math.random() * 4,
        color: "#f1c27d",
      });
    }
  };

  const startGame = (canvas: HTMLCanvasElement) => {
    initAudio();
    const st = stateRef.current;
    st.gameRunning = true;
    st.score = 0;
    st.obstacles = [];
    st.particles = [];
    st.playerY = canvas.height * 0.42;
    st.velocity = JUMP_FORCE * 0.55;
    st.spawnTimer = 0;
    setScreen("playing");
    stopMusic();
    if (audioRef.current.enabled) {
      setTimeout(() => startMusic(true), 80);
    }
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
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.fill();

    ctx.fillStyle = "#5d8a9e";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.78);
    ctx.quadraticCurveTo(width * 0.35, height * 0.58, width * 0.7, height * 0.81);
    ctx.quadraticCurveTo(width * 0.92, height * 0.62, width, height * 0.77);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.fill();

    ctx.fillStyle = "#3b2f22";
    ctx.fillRect(0, height - 108, width, 108);
    ctx.fillStyle = "#2c2f33";
    ctx.fillRect(0, height - 92, width, 92);
    ctx.fillStyle = "#555c66";
    ctx.fillRect(0, height - 102, width, 14);

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 4;
    for (let i = -1; i < 6; i++) {
      const xPos = ((time * 3.5) % (width + 180)) + i * (width / 5) - 90;
      ctx.beginPath();
      ctx.moveTo(xPos, height - 55);
      ctx.lineTo(xPos + 70, height - 55);
      ctx.stroke();
    }
  };

  const drawFinger = (ctx: CanvasRenderingContext2D, playerY: number, time: number, height: number) => {
    const bob = Math.sin(time * 0.18) * 2.8;
    const px = 168;
    const py = playerY + bob;

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(px + 8, height - 78, 38, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#e0b38a";
    ctx.lineWidth = 24;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(px - 10, py + 52);
    ctx.lineTo(px - 18, py + 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + 14, py + 52);
    ctx.lineTo(px + 22, py + 10);
    ctx.stroke();

    ctx.lineWidth = 16;
    ctx.strokeStyle = "#f0c090";
    ctx.beginPath();
    ctx.moveTo(px - 16, py + 42);
    ctx.quadraticCurveTo(px - 26, py - 18, px - 12, py - 55);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + 16, py + 42);
    ctx.quadraticCurveTo(px + 30, py - 12, px + 24, py - 58);
    ctx.stroke();

    ctx.fillStyle = "#e89a70";
    ctx.beginPath();
    ctx.arc(px - 12, py - 55, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px + 24, py - 58, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(px - 13, py - 59, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px + 23, py - 63, 5.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#d48a60";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px - 18, py - 22);
    ctx.lineTo(px - 6, py - 22);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + 18, py - 26);
    ctx.lineTo(px + 30, py - 26);
    ctx.stroke();
  };

  const drawObstacle = (ctx: CanvasRenderingContext2D, o: Obstacle, height: number) => {
    const w = 82;
    ctx.fillStyle = "#3b2f22";
    ctx.fillRect(o.x, 0, w, o.top);
    ctx.fillRect(o.x, o.top + o.gap, w, height - o.top - o.gap - 92);

    if (o.type === "tree") {
      ctx.fillStyle = "#228b22";
      ctx.beginPath();
      ctx.arc(o.x + w / 2, o.top - 22, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(o.x + w / 2, o.top + o.gap + 38, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#32a852";
      ctx.beginPath();
      ctx.arc(o.x + w / 2 - 12, o.top - 30, 18, 0, Math.PI * 2);
      ctx.fill();
    } else if (o.type === "sign") {
      ctx.fillStyle = "#ffeb3b";
      ctx.fillRect(o.x + 14, o.top - 58, w - 28, 42);
      ctx.fillRect(o.x + 14, o.top + o.gap + 14, w - 28, 42);
      ctx.fillStyle = "#d32f2f";
      ctx.font = "bold 20px Arial";
      ctx.textAlign = "center";
      ctx.fillText("SLOW", o.x + w / 2, o.top - 30);
      ctx.fillText("STOP", o.x + w / 2, o.top + o.gap + 42);
    } else if (o.type === "pole") {
      ctx.fillStyle = "#444";
      ctx.fillRect(o.x + 34, o.top - 95, 14, 110);
      ctx.fillRect(o.x + 34, o.top + o.gap - 5, 14, 110);
      ctx.fillStyle = "#aaa";
      ctx.fillRect(o.x + 37, o.top - 70, 8, 25);
    } else {
      ctx.fillStyle = "#1e8449";
      ctx.beginPath();
      ctx.ellipse(o.x + w / 2, o.top - 15, 48, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(o.x + w / 2, o.top + o.gap + 42, 42, 26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
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
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jump();
      }
    };
    document.addEventListener("keydown", onKey);

    const onPointer = () => jump();
    canvas.addEventListener("pointerdown", onPointer);

    const loop = () => {
      const st = stateRef.current;
      const width = canvas.width;
      const height = canvas.height;

      if (st.gameRunning) {
        st.time++;
        st.score += 0.75;
        st.velocity += GRAVITY;
        st.playerY += st.velocity;

        if (st.playerY > height - 175) { st.playerY = height - 175; st.velocity = 0; }
        if (st.playerY < 35) { st.playerY = 35; st.velocity = 1.8; }

        st.spawnTimer++;
        const spawnRate = Math.max(42, 58 - Math.floor(st.score / 12));
        if (st.spawnTimer > spawnRate) {
          spawnObstacle(width, height);
          st.spawnTimer = 0;
        }

        for (let i = st.obstacles.length - 1; i >= 0; i--) {
          const o = st.obstacles[i];
          o.x -= BASE_SPEED + st.score * 0.0075;
          const fingerLeft = 135, fingerRight = 205;
          const fingerTop = st.playerY - 55, fingerBottom = st.playerY + 48;
          if (o.x < fingerRight && o.x + 82 > fingerLeft) {
            if (fingerTop < o.top || fingerBottom > o.top + o.gap) {
              crash();
              return;
            }
          }
          if (!o.passed && o.x + 82 < fingerLeft) o.passed = true;
          if (o.x < -120) st.obstacles.splice(i, 1);
        }

        for (let i = st.particles.length - 1; i >= 0; i--) {
          const p = st.particles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.18;
          p.life--;
          if (p.life <= 0) st.particles.splice(i, 1);
        }
      }

      drawBackground(ctx, width, height, st.time);
      for (const o of st.obstacles) drawObstacle(ctx, o, height);

      ctx.shadowBlur = 0;
      for (const p of st.particles) {
        ctx.globalAlpha = Math.max(0.15, p.life / 45);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size || 6, p.size || 6);
      }
      ctx.globalAlpha = 1;

      drawFinger(ctx, st.playerY, st.time, height);

      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 6;
      ctx.fillStyle = "#fff";
      ctx.font = "bold 56px Arial";
      ctx.textAlign = "left";
      ctx.fillText(String(Math.floor(st.score)), 38, 82);
      ctx.font = "bold 24px Arial";
      ctx.fillText("BEST " + st.bestScore, 40, 118);
      ctx.shadowBlur = 0;

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    setTimeout(() => {
      if (audioRef.current.enabled) startMusic(false);
    }, 650);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      document.removeEventListener("keydown", onKey);
      canvas.removeEventListener("pointerdown", onPointer);
      stopMusic();
    };
  }, []);

  const handleStart = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    startGame(canvas);
  };

  const handleToggleMusic = () => {
    const newVal = !audioRef.current.enabled;
    audioRef.current.enabled = newVal;
    setMusicOn(newVal);
    if (newVal) {
      startMusic(stateRef.current.gameRunning);
    } else {
      stopMusic();
    }
  };

  const handleCanvasPointer = () => {
    const st = stateRef.current;
    if (!st.gameRunning) {
      if (screen === "dead") {
        const canvas = canvasRef.current;
        if (canvas) startGame(canvas);
      }
    }
  };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#87CEEB", touchAction: "none" }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block" }}
        onPointerDown={handleCanvasPointer}
      />

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
          <p style={{ fontSize: "1.45rem", margin: "6px 0" }}>Stick your fingers out the car window!</p>
          <p style={{ fontSize: "1.45rem", margin: "6px 0" }}>Tap anywhere or press SPACE to jump</p>
          <p style={{ fontSize: "1.45rem", margin: "6px 0" }}>Dodge trees, signs &amp; poles • Beat your best distance</p>
          <button
            onClick={handleStart}
            style={{
              marginTop: 28, padding: "16px 48px", fontSize: "1.55rem",
              background: "#ff4757", color: "white", border: "none",
              borderRadius: 60, cursor: "pointer", boxShadow: "0 8px 0 #c2363e",
              transition: "all 0.1s",
            }}
            onMouseDown={e => (e.currentTarget.style.transform = "translateY(4px)", e.currentTarget.style.boxShadow = "0 4px 0 #c2363e")}
            onMouseUp={e => (e.currentTarget.style.transform = "", e.currentTarget.style.boxShadow = "0 8px 0 #c2363e")}
          >
            START RUNNING
          </button>
        </div>
      )}

      {screen === "dead" && (
        <div
          style={{
            position: "absolute", inset: 0, zIndex: 10, cursor: "pointer",
          }}
          onClick={() => { const c = canvasRef.current; if (c) startGame(c); }}
        />
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
