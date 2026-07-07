import { FACTIONS, WORLD_H, WORLD_W } from "./constants";
import type { Npc, Particle, Player, FloatText } from "./entities";
import type { Sector } from "./galaxy";
import type { WorldEntity } from "./types";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  w: number;
  h: number;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  private wx(x: number, cam: Camera): number {
    return (x - cam.x) * cam.zoom + cam.w / 2;
  }
  private wy(y: number, cam: Camera): number {
    return (y - cam.y) * cam.zoom + cam.h / 2;
  }

  drawBackground(sector: Sector, cam: Camera, t: number) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, cam.h);
    g.addColorStop(0, sector.tint);
    g.addColorStop(1, "#03040a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cam.w, cam.h);

    // Background megastructures (deep parallax)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const s of sector.bgStructures) {
      const p = 0.35;
      const sx = (s.x - cam.x * p) * cam.zoom + cam.w / 2;
      const sy = (s.y - cam.y * p) * cam.zoom + cam.h / 2;
      const r = s.r * cam.zoom;
      if (sx < -r * 2 || sx > cam.w + r * 2 || sy < -r * 2 || sy > cam.h + r * 2)
        continue;
      this.drawStructure(sx, sy, r, s.type, s.color, s.rot + t * 0.02);
    }
    ctx.restore();

    // Star layers (tiled + parallax)
    this.drawStars(sector.starsFar, cam, 0.25, "#a9c4ff");
    this.drawStars(sector.starsNear, cam, 0.5, "#ffffff");
  }

  private drawStars(
    stars: { x: number; y: number; r: number; a: number }[],
    cam: Camera,
    p: number,
    base: string,
  ) {
    const ctx = this.ctx;
    ctx.fillStyle = base;
    for (const s of stars) {
      const sx = mod((s.x - cam.x * p) * cam.zoom, cam.w);
      const sy = mod((s.y - cam.y * p) * cam.zoom, cam.h);
      ctx.globalAlpha = s.a;
      ctx.beginPath();
      ctx.arc(sx, sy, s.r * cam.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawStructure(
    x: number,
    y: number,
    r: number,
    type: string,
    color: string,
    rot: number,
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (type === "dyson") {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, r * (0.5 + i * 0.25), 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.stroke();
      }
    } else if (type === "ring") {
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.7, r * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (type === "spire") {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.18, r);
      ctx.lineTo(-r * 0.18, r);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.5);
      ctx.lineTo(r * 0.5, 0);
      ctx.moveTo(0, -r * 0.5);
      ctx.lineTo(-r * 0.5, 0);
      ctx.stroke();
    } else {
      // rift
      ctx.beginPath();
      for (let i = -5; i <= 5; i++) {
        const a = (i / 5) * Math.PI;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.5 + (i % 2) * 14);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawWorldBorder(cam: Camera) {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(120,160,255,0.18)";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      this.wx(0, cam),
      this.wy(0, cam),
      WORLD_W * cam.zoom,
      WORLD_H * cam.zoom,
    );
  }

  drawEntity(e: WorldEntity, cam: Camera, t: number, scanned: boolean) {
    const ctx = this.ctx;
    const x = this.wx(e.x, cam);
    const y = this.wy(e.y, cam);
    const r = e.r * cam.zoom;
    if (x < -r - 60 || x > cam.w + r + 60 || y < -r - 60 || y > cam.h + r + 60)
      return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2 + e.pulse);

    if (e.kind === "hazard") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, "rgba(122,240,255,0.22)");
      grd.addColorStop(0.6, "rgba(122,240,255,0.10)");
      grd.addColorStop(1, "rgba(122,240,255,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "rgba(122,240,255,0.5)";
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(x, y, r, t % (Math.PI * 2), Math.PI * 1.7 + (t % (Math.PI * 2)));
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    let color = "#8fa6d8";
    if (e.faction) color = FACTIONS[e.faction].color;
    if (e.kind === "resource") color = "#8affc4";
    if (e.kind === "ruin") color = "#c9b48a";
    if (e.kind === "event") color = "#ff9de2";
    if (e.kind === "gate") color = "#7dd3ff";

    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = color;
    ctx.shadowBlur = 14 + pulse * 8;
    ctx.strokeStyle = color;
    ctx.fillStyle = "rgba(8,12,24,0.6)";
    ctx.lineWidth = 2;

    if (e.kind === "station") {
      ctx.rotate(t * 0.3);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const rr = r * (i % 2 === 0 ? 1 : 0.6);
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
      ctx.stroke();
    } else if (e.kind === "ruin") {
      if (e.used) {
        ctx.globalAlpha = 0.4;
        ctx.shadowBlur = 4;
      }
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.5);
      ctx.lineTo(-r * 0.4, -r);
      ctx.lineTo(r * 0.3, -r * 0.3);
      ctx.lineTo(r, r * 0.6);
      ctx.lineTo(-r, r * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r);
      ctx.lineTo(-r * 0.1, r * 0.5);
      ctx.stroke();
    } else if (e.kind === "resource") {
      ctx.rotate(t * 0.6 + e.pulse);
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.9, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.9, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (e.kind === "event") {
      ctx.rotate(t * 0.8);
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.7 + pulse * 0.3), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.moveTo(-r, 0);
      ctx.lineTo(r, 0);
      ctx.stroke();
    } else if (e.kind === "gate") {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.55 + pulse * 0.25), 0, Math.PI * 2);
      ctx.globalAlpha = 0.5 + pulse * 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // labels when near / scanned
    if (scanned) {
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(220,232,255,0.7)";
      ctx.font = "11px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(e.label, x, y + r + 16);
      ctx.restore();
    }
  }

  drawNpc(n: Npc, cam: Camera, t: number) {
    const ctx = this.ctx;
    const x = this.wx(n.x, cam);
    const y = this.wy(n.y, cam);
    const r = n.r * cam.zoom;
    if (x < -40 || x > cam.w + 40 || y < -40 || y > cam.h + 40) return;
    const f = FACTIONS[n.faction];

    if (n.faction === "nanocloud") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = f.glow;
      for (let i = 0; i < 5; i++) {
        const a = t * 2 + i;
        ctx.beginPath();
        ctx.arc(
          x + Math.cos(a) * r * 0.6,
          y + Math.sin(a * 1.3) * r * 0.6,
          r * 0.5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(n.angle + Math.PI / 2);
    ctx.shadowColor = f.color;
    ctx.shadowBlur = n.isElite ? 18 : 10;
    ctx.strokeStyle = f.color;
    ctx.fillStyle = "rgba(8,10,20,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (n.isElite) {
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.8, r * 0.4);
      ctx.lineTo(r * 0.3, r);
      ctx.lineTo(-r * 0.3, r);
      ctx.lineTo(-r * 0.8, r * 0.4);
    } else {
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.7, r * 0.7);
      ctx.lineTo(-r * 0.7, r * 0.7);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawCaptureBeam(n: Npc, px: number, py: number, cam: Camera, t: number) {
    const ctx = this.ctx;
    const x1 = this.wx(n.x, cam);
    const y1 = this.wy(n.y, cam);
    const x2 = this.wx(px, cam);
    const y2 = this.wy(py, cam);
    const f = FACTIONS[n.faction];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = f.color;
    ctx.globalAlpha = 0.4 + 0.3 * Math.sin(t * 12);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  drawPlayer(p: Player, cam: Camera, t: number, captured: number) {
    const ctx = this.ctx;
    const x = this.wx(p.x, cam);
    const y = this.wy(p.y, cam);
    ctx.save();
    ctx.translate(x, y);

    // capture warning aura
    if (captured > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const aura = 20 + captured * 26 + Math.sin(t * 8) * 4;
      const grd = ctx.createRadialGradient(0, 0, 6, 0, 0, aura);
      const a = 0.25 + captured * 0.35;
      grd.addColorStop(0, `rgba(255,90,120,${a})`);
      grd.addColorStop(1, "rgba(255,90,120,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(0, 0, aura, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.rotate(p.angle + Math.PI / 2);

    // running legs animation
    const speed = Math.hypot(p.vx, p.vy);
    const isRunning = speed > 10;
    if (isRunning) {
      ctx.save();
      ctx.strokeStyle = "#a8c5e0";
      ctx.lineWidth = 2;
      const legPhase = (t * speed * 0.5) % (Math.PI * 2);
      const legSwing = Math.sin(legPhase) * 6;

      // left leg
      ctx.beginPath();
      ctx.moveTo(-4, 8);
      ctx.lineTo(-4 + legSwing, 14);
      ctx.stroke();

      // right leg
      ctx.beginPath();
      ctx.moveTo(4, 8);
      ctx.lineTo(4 - legSwing, 14);
      ctx.stroke();
      ctx.restore();
    } else {
      // standing legs
      ctx.strokeStyle = "#a8c5e0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4, 8);
      ctx.lineTo(-4, 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(4, 8);
      ctx.lineTo(4, 14);
      ctx.stroke();
    }

    // red light saber
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const saberLength = 28 + Math.sin(t * 6) * 2;
    const saberGrd = ctx.createLinearGradient(0, -13, 0, -13 - saberLength);
    saberGrd.addColorStop(0, "rgba(255, 100, 100, 0.9)");
    saberGrd.addColorStop(0.4, "rgba(255, 50, 50, 0.7)");
    saberGrd.addColorStop(0.7, "rgba(200, 20, 20, 0.4)");
    saberGrd.addColorStop(1, "rgba(200, 20, 20, 0)");
    ctx.strokeStyle = saberGrd;
    ctx.lineWidth = 4;
    ctx.shadowColor = "#ff3333";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(0, -13 - saberLength);
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.restore();

    // thruster flame
    if (p.thrusting) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const fl = (p.boosting ? 26 : 14) + Math.random() * 8;
      const grd = ctx.createLinearGradient(0, 10, 0, 10 + fl);
      grd.addColorStop(0, p.boosting ? "#fff6c0" : "#9be7ff");
      grd.addColorStop(1, "rgba(120,200,255,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(-5, 9);
      ctx.lineTo(5, 9);
      ctx.lineTo(0, 10 + fl);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.shadowColor = "#bfe9ff";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = "#eaf6ff";
    ctx.fillStyle = "#16314f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(9, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-9, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // cockpit
    ctx.fillStyle = "#7fd7ff";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(0, -3, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawParticles(particles: Particle[], cam: Camera) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      const x = this.wx(p.x, cam);
      const y = this.wy(p.y, cam);
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, p.size * cam.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawTexts(texts: FloatText[], cam: Camera) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "bold 14px 'Inter', sans-serif";
    for (const t of texts) {
      const x = this.wx(t.x, cam);
      const y = this.wy(t.y, cam);
      ctx.globalAlpha = Math.min(1, t.life);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, x, y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawSpeech(n: Npc, cam: Camera) {
    if (n.speak <= 0 || !n.line) return;
    const ctx = this.ctx;
    const x = this.wx(n.x, cam);
    const y = this.wy(n.y, cam) - n.r * cam.zoom - 14;
    const f = FACTIONS[n.faction];
    ctx.save();
    ctx.font = "12px 'Inter', sans-serif";
    ctx.textAlign = "center";
    const w = ctx.measureText(n.line).width + 16;
    ctx.globalAlpha = Math.min(1, n.speak);
    ctx.fillStyle = "rgba(6,8,18,0.82)";
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 1;
    roundRect(ctx, x - w / 2, y - 18, w, 22, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = f.color;
    ctx.fillText(n.line, x, y - 3);
    ctx.restore();
  }
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
