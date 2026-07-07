// ── Particle system ───────────────────────────────────────────────────────────────────────────────

export interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  color: string;
  shape: "circle" | "rect" | "bone" | "star";
  rot?: number; rotV?: number;
  gravity?: number;
  fade?: boolean;
}

export interface ParticleEmitter {
  particles: Particle[];
  spawn(x: number, y: number, count: number, type: string, color?: string): void;
  update(): void;
  draw(ctx: CanvasRenderingContext2D): void;
}

export function createEmitter(): ParticleEmitter {
  const particles: Particle[] = [];

  function spawn(x: number, y: number, count: number, type: string, color?: string) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 6;
      const p: Particle = {
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (type === "explosion" ? 3 : 1.5),
        life: 20 + Math.random() * 30,
        maxLife: 20 + Math.random() * 30,
        size: 2 + Math.random() * 5,
        color: color || "#fff",
        shape: type === "slice" ? "star" : type === "explosion" ? "circle" : "rect",
        rot: Math.random() * 6,
        rotV: (Math.random() - 0.5) * 0.4,
        gravity: type === "explosion" ? 0.15 : 0.08,
        fade: true,
      };
      particles.push(p);
    }
  }

  function update() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity || 0.08;
      p.life--;
      if (p.rot != null && p.rotV != null) p.rot += p.rotV;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function draw(ctx: CanvasRenderingContext2D) {
    for (const p of particles) {
      const alpha = p.fade ? Math.max(0, p.life / p.maxLife) : 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;

      if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === "star") {
        drawStar(ctx, p.x, p.y, 4, p.size / 2, p.size / 4, p.rot || 0);
      } else if (p.shape === "bone") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        const r = p.size / 2;
        ctx.fillRect(-r, -r * 0.35, r * 2, r * 0.7);
        ctx.beginPath(); ctx.arc(-r, 0, r * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(r, 0, r * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        if (p.rot != null) ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  return { particles, spawn, update, draw };
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outerR: number, innerR: number, rot: number) {
  let rotAngle = Math.PI / 2 * 3 + rot;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rotAngle) * outerR, cy + Math.sin(rotAngle) * outerR);
    rotAngle += step;
    ctx.lineTo(cx + Math.cos(rotAngle) * innerR, cy + Math.sin(rotAngle) * innerR);
    rotAngle += step;
  }
  ctx.lineTo(cx, cy - outerR);
  ctx.closePath();
  ctx.fill();
}
