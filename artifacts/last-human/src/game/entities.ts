import { FACTIONS } from "./constants";
import { clamp } from "./rng";
import type { FactionId } from "./types";

export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  angle = -Math.PI / 2;
  r = 12;
  thrusting = false;
  boost = 1; // 0..1 reserve
  boosting = false;

  reset(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = -Math.PI / 2;
    this.boost = 1;
  }
}

export type NpcState = "approach" | "capture" | "wander" | "flee" | "pilgrim";

export class Npc {
  id: number;
  faction: FactionId;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  angle = 0;
  r: number;
  state: NpcState = "approach";
  speak = 0;
  line = "";
  isElite: boolean;
  pilgrim: boolean;
  wanderT = 0;
  wanderA = 0;

  constructor(
    id: number,
    faction: FactionId,
    x: number,
    y: number,
    opts?: { elite?: boolean; pilgrim?: boolean },
  ) {
    this.id = id;
    this.faction = faction;
    this.x = x;
    this.y = y;
    this.isElite = opts?.elite ?? false;
    this.pilgrim = opts?.pilgrim ?? false;
    this.r = this.isElite ? 18 : faction === "nanocloud" ? 14 : 12;
  }
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
  color: string;
}

export class ParticleSystem {
  particles: Particle[] = [];
  texts: FloatText[] = [];

  burst(
    x: number,
    y: number,
    color: string,
    count: number,
    speed = 120,
    life = 0.6,
  ) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: life,
        maxLife: life,
        size: 1 + Math.random() * 2.5,
        color,
      });
    }
  }

  trail(x: number, y: number, vx: number, vy: number, color: string) {
    this.particles.push({
      x,
      y,
      vx: vx + (Math.random() - 0.5) * 30,
      vy: vy + (Math.random() - 0.5) * 30,
      life: 0.4,
      maxLife: 0.4,
      size: 1.5 + Math.random() * 2,
      color,
    });
  }

  float(x: number, y: number, text: string, color: string) {
    this.texts.push({ x, y, vy: -38, life: 1.3, text, color });
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.y += t.vy * dt;
      t.vy *= 0.95;
      t.life -= dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    // soft cap
    if (this.particles.length > 600)
      this.particles.splice(0, this.particles.length - 600);
  }

  clear() {
    this.particles.length = 0;
    this.texts.length = 0;
  }
}

export function factionColor(id: FactionId): string {
  return FACTIONS[id].color;
}

export { clamp };
