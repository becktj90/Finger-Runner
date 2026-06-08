import { AudioSystem } from "./audio";
import {
  EVENTS,
  FACTIONS,
  FACTION_LIST,
  LORE,
  UPGRADES,
  WORLD_H,
  WORLD_W,
  loreById,
} from "./constants";
import { Npc, ParticleSystem, Player } from "./entities";
import { generateSector, type Sector } from "./galaxy";
import { Input } from "./input";
import { Renderer, type Camera, roundRect } from "./render";
import { clamp, dist2, RNG } from "./rng";
import {
  addHighScore,
  clearRun,
  loadSave,
  RUN_VERSION,
  saveRun,
  unlockLore,
  writeSave,
} from "./storage";
import { UI, type StationView } from "./ui";
import type {
  FactionId,
  GameEvent,
  Metrics,
  RunSnapshot,
  SaveData,
  WorldEntity,
} from "./types";

type State = "menu" | "playing" | "modal" | "gameover";

interface Stats {
  maxSpeed: number;
  accel: number;
  boostMul: number;
  cloakFactor: number;
  captureRateMul: number;
  decayRate: number;
  pickupBonus: number;
  mapRevealed: boolean;
  boostMax: number;
  recharge: number;
}

export class Game {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  renderer: Renderer;
  input: Input;
  audio = new AudioSystem();
  ui: UI;
  save: SaveData;

  state: State = "menu";
  player = new Player();
  particles = new ParticleSystem();
  cam: Camera = { x: 0, y: 0, zoom: 1, w: 800, h: 600 };

  sector!: Sector;
  sectorIndex = 0;
  npcs: Npc[] = [];
  nextNpcId = 1;
  spawnTimer = 0;
  rng = new RNG(Date.now());
  runSeed = 0;

  metrics: Metrics = { reputation: 50, mythology: 12, fear: 12, value: 22 };
  bands: Record<keyof Metrics, number> = {
    reputation: 1,
    mythology: 0,
    fear: 0,
    value: 0,
  };
  rep: Record<FactionId, number> = {
    caretaker: 0,
    corporate: 0,
    fanatic: 0,
    military: 0,
    archaeo: 0,
    nanocloud: 0,
  };

  salvage = 0;
  capture = 0;
  upgrades: Record<string, number> = {};
  score = 0;
  runTime = 0;
  endless = false;
  capturedBy: FactionId | null = null;

  headlines: string[] = [];
  ticker = { text: "", life: 0 };

  private dpr = 1;
  private lastT = 0;
  private raf = 0;
  private t = 0;
  private acc = 0;
  private readonly STEP = 1 / 60;
  private saveTimer = 0;
  private consumed = new Set<number>();

  constructor(root: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "lh-canvas";
    root.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D not supported");
    this.ctx = ctx;
    this.renderer = new Renderer(ctx);
    this.input = new Input(this.canvas);
    this.save = loadSave();
    this.audio.setMuted(this.save.settings.muted);

    this.ui = new UI(root, {
      onStart: (endless) => this.startRun(endless),
      onResume: () => this.resumeRun(),
      onChoice: (i) => this.resolveChoice(i),
      onBuy: (id) => this.buyUpgrade(id),
      onLaunch: () => this.closeModal(),
      onRestart: () => this.goToMenu(),
      onToggleMute: () => this.toggleMute(),
      onShowCodex: () => this.ui.showCodex(this.save),
      onShowScores: () => this.ui.showScores(this.save),
      onCloseCodex: () => this.goToMenu(),
      onBoost: (held) => this.input.setBoostButton(held),
    });

    window.addEventListener("resize", this.resize);
    window.addEventListener("pagehide", this.persist);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
    this.goToMenu();
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private onVisibility = () => {
    if (document.visibilityState === "hidden") this.persist();
  };

  private persist = () => {
    if (this.state === "playing" || this.state === "modal") this.saveRunState();
  };

  private goToMenu() {
    this.state = "menu";
    this.npcs = [];
    this.particles.clear();
    this.input.setBoostButton(false);
    this.ui.showBoostButton(false);
    this.ui.showMainMenu(this.save, this.audio.isMuted());
  }

  private toggleMute() {
    const m = !this.audio.isMuted();
    this.audio.setMuted(m);
    this.save.settings.muted = m;
    writeSave(this.save);
    this.ui.setMuteLabel(m);
  }

  private resize = () => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.cam.w = w;
    this.cam.h = h;
    this.cam.zoom = clamp(Math.min(w, h) / 820, 0.62, 1.05);
  };

  private stats(): Stats {
    const eng = this.upgrades.engine || 0;
    const cloak = this.upgrades.cloak || 0;
    const stab = this.upgrades.stabilizer || 0;
    const scan = this.upgrades.scanner || 0;
    const boost = this.upgrades.booster || 0;
    return {
      maxSpeed: 220 * (1 + eng * 0.17),
      accel: 760 * (1 + eng * 0.14),
      boostMul: 1.85 + boost * 0.12,
      cloakFactor: 1 - cloak * 0.13,
      captureRateMul: 1 - stab * 0.13,
      decayRate: 9 + stab * 5.5,
      pickupBonus: scan * 18,
      mapRevealed: scan >= 2,
      boostMax: 1.2 + boost * 0.5,
      recharge: 0.22 + boost * 0.09,
    };
  }

  // ---- Run lifecycle ----
  startRun(endless: boolean) {
    this.audio.init();
    this.endless = endless;
    this.sectorIndex = 0;
    this.runSeed = (Math.random() * 1e9) >>> 0;
    this.metrics = { reputation: 50, mythology: 12, fear: 12, value: 22 };
    this.rep = {
      caretaker: 0,
      corporate: 0,
      fanatic: 0,
      military: 0,
      archaeo: 0,
      nanocloud: 0,
    };
    this.salvage = 15;
    this.capture = 0;
    this.upgrades = {};
    this.score = 0;
    this.runTime = 0;
    this.capturedBy = null;
    this.captureFaction = null;
    this.headlines = [];
    clearRun(this.save);
    this.updateBands(true);
    this.loadSector(1);
    this.state = "playing";
    this.ui.hideOverlay();
    this.ui.showBoostButton(true);
    this.audio.confirm();
    this.saveRunState();
  }

  resumeRun() {
    const snap = this.save.run;
    if (!snap) {
      this.startRun(false);
      return;
    }
    this.audio.init();
    this.endless = snap.endless;
    this.runSeed = snap.runSeed;
    this.metrics = { ...snap.metrics };
    this.rep = { ...snap.rep };
    this.salvage = snap.salvage;
    this.capture = snap.capture;
    this.upgrades = { ...snap.upgrades };
    this.score = snap.score;
    this.runTime = snap.runTime;
    this.capturedBy = null;
    this.captureFaction = snap.captureFaction;
    this.headlines = [...snap.headlines];
    this.restoreSector(snap.sectorIndex, snap.consumed);
    const p = this.player;
    p.x = snap.player.x;
    p.y = snap.player.y;
    p.vx = snap.player.vx;
    p.vy = snap.player.vy;
    p.angle = snap.player.angle;
    p.boost = snap.player.boost;
    this.cam.x = p.x;
    this.cam.y = p.y;
    this.updateBands(true);
    this.state = "playing";
    this.ui.hideOverlay();
    this.ui.showBoostButton(true);
    this.audio.confirm();
  }

  private loadSector(index: number) {
    this.sectorIndex = index;
    this.sector = generateSector(index, (this.runSeed + index * 7919) >>> 0);
    this.consumed.clear();
    this.pendingEntityId = null;
    this.player.reset(WORLD_W / 2, WORLD_H / 2);
    this.npcs = [];
    this.particles.clear();
    this.spawnTimer = 1.5;
    this.capture = Math.max(0, this.capture - 30);
    this.cam.x = this.player.x;
    this.cam.y = this.player.y;
  }

  private restoreSector(index: number, consumed: number[]) {
    this.sectorIndex = index;
    this.sector = generateSector(index, (this.runSeed + index * 7919) >>> 0);
    this.consumed = new Set(consumed);
    this.pendingEntityId = null;
    this.currentEvent = null;
    this.sector.entities = this.sector.entities.filter((e) => {
      if (!this.consumed.has(e.id)) return true;
      if (e.kind === "resource") return false;
      e.used = true;
      return true;
    });
    this.npcs = [];
    this.particles.clear();
    this.spawnTimer = 1.5;
  }

  private snapshot(): RunSnapshot {
    const p = this.player;
    return {
      v: RUN_VERSION,
      endless: this.endless,
      sectorIndex: this.sectorIndex,
      runSeed: this.runSeed,
      metrics: { ...this.metrics },
      rep: { ...this.rep },
      salvage: this.salvage,
      capture: this.capture,
      upgrades: { ...this.upgrades },
      score: this.score,
      runTime: this.runTime,
      captureFaction: this.captureFaction,
      headlines: this.headlines.slice(0, 30),
      player: {
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        angle: p.angle,
        boost: p.boost,
      },
      consumed: [...this.consumed],
    };
  }

  private saveRunState() {
    saveRun(this.save, this.snapshot());
  }

  private nextSector() {
    this.score += 120 + this.sectorIndex * 20;
    if (this.sectorIndex > this.save.bestSector) {
      this.save.bestSector = this.sectorIndex;
      writeSave(this.save);
    }
    this.audio.jump();
    this.particles.burst(this.player.x, this.player.y, "#7dd3ff", 40, 220, 0.8);
    this.loadSector(this.sectorIndex + 1);
    this.pushHeadline(
      `JUMP // Sector ${this.sectorIndex}: ${this.sector.name}`,
    );
    this.saveRunState();
  }

  // ---- Spawning ----
  private spawnNpc() {
    const m = this.metrics;
    const depth = this.sectorIndex;
    // weighted faction selection from metrics
    const weights: [FactionId, number][] = [
      ["caretaker", 1 + (m.reputation > 55 ? 1 : 0)],
      ["corporate", 1 + (m.value > 50 ? 2 : 0)],
      ["archaeo", 1],
      ["military", m.fear > 50 ? 3 : 0.4],
      ["fanatic", m.mythology > 50 ? 3 : 0.5],
    ];
    let total = 0;
    for (const w of weights) total += w[1];
    let r = this.rng.range(0, total);
    let faction: FactionId = "caretaker";
    for (const w of weights) {
      r -= w[1];
      if (r <= 0) {
        faction = w[0];
        break;
      }
    }

    // spawn just off-screen around player
    const ang = this.rng.range(0, Math.PI * 2);
    const sd = Math.max(this.cam.w, this.cam.h) / this.cam.zoom / 2 + 120;
    let x = clamp(this.player.x + Math.cos(ang) * sd, 40, WORLD_W - 40);
    let y = clamp(this.player.y + Math.sin(ang) * sd, 40, WORLD_H - 40);

    const elite =
      faction === "military" && (m.fear > 65 || this.rng.chance(0.2 + depth * 0.03));
    const pilgrim = faction === "fanatic" && m.mythology > 55;

    const groupSize =
      faction === "military" && m.fear > 60
        ? this.rng.int(2, 3)
        : pilgrim
          ? this.rng.int(2, 4)
          : 1;

    for (let i = 0; i < groupSize; i++) {
      const ox = x + this.rng.range(-60, 60);
      const oy = y + this.rng.range(-60, 60);
      this.npcs.push(
        new Npc(this.nextNpcId++, faction, ox, oy, { elite, pilgrim }),
      );
    }
  }

  private maxNpcs(): number {
    return 5 + this.sectorIndex * 2 + Math.floor(this.metrics.fear / 25);
  }

  private spawnInterval(): number {
    const base = 4.2 - this.sectorIndex * 0.25;
    const pressure =
      (this.metrics.fear + this.metrics.value + this.metrics.mythology) / 300;
    return clamp(base - pressure * 1.6, 1.0, 4.5);
  }

  // ---- Update ----
  private update(dt: number) {
    this.t += dt;
    this.runTime += dt;
    const st = this.stats();
    const p = this.player;

    // input direction
    let dx = 0;
    let dy = 0;
    if (this.input.down("arrowleft", "a")) dx -= 1;
    if (this.input.down("arrowright", "d")) dx += 1;
    if (this.input.down("arrowup", "w")) dy -= 1;
    if (this.input.down("arrowdown", "s")) dy += 1;
    if (dx === 0 && dy === 0 && this.input.pointerActive) {
      const cx = this.cam.w / 2;
      const cy = this.cam.h / 2;
      const pdx = this.input.pointerX - cx;
      const pdy = this.input.pointerY - cy;
      const d = Math.hypot(pdx, pdy);
      if (d > 24) {
        const mag = clamp(d / 130, 0, 1);
        dx = (pdx / d) * mag;
        dy = (pdy / d) * mag;
      }
    }
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }

    // boost
    const wantBoost = this.input.boostHeld && p.boost > 0.02 && mag > 0.1;
    p.boosting = wantBoost;
    if (wantBoost) {
      p.boost = Math.max(0, p.boost - dt / st.boostMax);
    } else {
      p.boost = Math.min(1, p.boost + dt * st.recharge);
    }
    const speedCap = st.maxSpeed * (wantBoost ? st.boostMul : 1);
    const accel = st.accel * (wantBoost ? 1.4 : 1);

    p.thrusting = mag > 0.05;
    p.vx += dx * accel * dt;
    p.vy += dy * accel * dt;
    // friction
    p.vx *= 0.93;
    p.vy *= 0.93;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > speedCap) {
      p.vx = (p.vx / sp) * speedCap;
      p.vy = (p.vy / sp) * speedCap;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (sp > 6) p.angle = Math.atan2(p.vy, p.vx);

    // world bounds
    if (p.x < p.r) {
      p.x = p.r;
      p.vx *= -0.4;
    }
    if (p.x > WORLD_W - p.r) {
      p.x = WORLD_W - p.r;
      p.vx *= -0.4;
    }
    if (p.y < p.r) {
      p.y = p.r;
      p.vy *= -0.4;
    }
    if (p.y > WORLD_H - p.r) {
      p.y = WORLD_H - p.r;
      p.vy *= -0.4;
    }

    // thruster particles
    if (p.thrusting && this.rng.chance(0.8)) {
      this.particles.trail(
        p.x - Math.cos(p.angle) * 10,
        p.y - Math.sin(p.angle) * 10,
        -p.vx * 0.2,
        -p.vy * 0.2,
        p.boosting ? "#fff0b0" : "#7fc8ff",
      );
    }

    // camera
    this.cam.x += (p.x - this.cam.x) * Math.min(1, dt * 6);
    this.cam.y += (p.y - this.cam.y) * Math.min(1, dt * 6);

    // entity interactions
    this.checkEntities();

    // spawning
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.npcs.length < this.maxNpcs()) {
      this.spawnNpc();
      this.spawnTimer = this.spawnInterval();
    }

    // npc update + capture
    let captorRate = 0;
    let nearestCaptor: Npc | null = null;
    for (const n of this.npcs) {
      this.updateNpc(n, dt, st);
      const f = FACTIONS[n.faction];
      const captureR = (p.r + n.r + 46) ** 2;
      const d2 = dist2(n.x, n.y, p.x, p.y);
      if (d2 < captureR) {
        const rate = f.captureRate * st.captureRateMul * (n.isElite ? 1.5 : 1);
        captorRate += rate;
        if (!nearestCaptor) nearestCaptor = n;
        n.state = "capture";
      }
    }

    // hazard capture (nanocloud zones)
    for (const e of this.sector.entities) {
      if (e.kind === "hazard") {
        if (dist2(e.x, e.y, p.x, p.y) < (e.r + p.r) ** 2) {
          captorRate += FACTIONS.nanocloud.captureRate * st.captureRateMul;
          if (this.rng.chance(0.3))
            this.particles.trail(p.x, p.y, 0, 0, "#7af0ff");
        }
      }
    }

    if (captorRate > 0) {
      this.capture = Math.min(100, this.capture + captorRate * dt);
      this.capturedByCandidate(nearestCaptor);
    } else {
      this.capture = Math.max(0, this.capture - st.decayRate * dt);
    }

    this.audio.setTension(clamp(this.capture / 100, 0, 1));

    if (this.capture >= 100) {
      this.endRun();
      return;
    }

    // cull npcs that drift very far
    const cullD = (Math.max(this.cam.w, this.cam.h) / this.cam.zoom) * 1.6;
    this.npcs = this.npcs.filter(
      (n) => dist2(n.x, n.y, p.x, p.y) < cullD * cullD,
    );

    this.particles.update(dt);
    this.updateBands(false);

    if (this.ticker.life > 0) this.ticker.life -= dt;
  }

  private captureFaction: FactionId | null = null;
  private capturedByCandidate(n: Npc | null) {
    if (n) {
      this.captureFaction = n.faction;
    }
  }

  private updateNpc(n: Npc, dt: number, st: Stats) {
    const p = this.player;
    const f = FACTIONS[n.faction];
    const detect = f.detect * st.cloakFactor;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    const speed = f.speed * (n.isElite ? 1.2 : 1);

    if (n.faction === "nanocloud") {
      // slow drift toward player when close
      n.wanderT -= dt;
      if (n.wanderT <= 0) {
        n.wanderA = Math.random() * Math.PI * 2;
        n.wanderT = 1 + Math.random() * 2;
      }
      let ax = Math.cos(n.wanderA);
      let ay = Math.sin(n.wanderA);
      if (d < detect) {
        ax = (p.x - n.x) / d;
        ay = (p.y - n.y) / d;
      }
      n.vx += ax * speed * dt * 1.2;
      n.vy += ay * speed * dt * 1.2;
    } else if (d < detect) {
      n.state = "approach";
      const ax = (p.x - n.x) / (d || 1);
      const ay = (p.y - n.y) / (d || 1);
      n.vx += ax * speed * dt * 3;
      n.vy += ay * speed * dt * 3;
      n.angle = Math.atan2(p.y - n.y, p.x - n.x);
      // speak occasionally
      if (n.speak <= 0 && this.rng.chance(0.004) && d < detect * 0.7) {
        n.line = f.dialogue[Math.floor(Math.random() * f.dialogue.length)];
        n.speak = 2.6;
      }
    } else {
      n.state = "wander";
      n.wanderT -= dt;
      if (n.wanderT <= 0) {
        n.wanderA = Math.random() * Math.PI * 2;
        n.wanderT = 1.5 + Math.random() * 2;
      }
      n.vx += Math.cos(n.wanderA) * speed * dt * 1.5;
      n.vy += Math.sin(n.wanderA) * speed * dt * 1.5;
    }

    const vmax = speed;
    const ns = Math.hypot(n.vx, n.vy);
    if (ns > vmax) {
      n.vx = (n.vx / ns) * vmax;
      n.vy = (n.vy / ns) * vmax;
    }
    n.vx *= 0.97;
    n.vy *= 0.97;
    n.x += n.vx * dt;
    n.y += n.vy * dt;
    if (n.speak > 0) n.speak -= dt;
  }

  private checkEntities() {
    const p = this.player;
    const st = this.stats();
    for (const e of this.sector.entities) {
      if (e.kind === "hazard") continue;
      const reach =
        e.r +
        p.r +
        (e.kind === "resource" ? 16 + st.pickupBonus : e.kind === "gate" ? 8 : 6);
      if (dist2(e.x, e.y, p.x, p.y) > reach * reach) continue;

      if (e.kind === "resource" && !e.used) {
        e.used = true;
        this.consumed.add(e.id);
        const amt = e.amount || 8;
        this.salvage += amt;
        this.score += amt;
        this.audio.pickup();
        this.particles.burst(e.x, e.y, "#8affc4", 14, 140, 0.6);
        this.particles.float(e.x, e.y, `+${amt}`, "#8affc4");
        this.sector.entities = this.sector.entities.filter((x) => x !== e);
      } else if (e.kind === "gate") {
        this.nextSector();
        return;
      } else if (e.kind === "station" && !e.used) {
        this.openStation(e);
        return;
      } else if (e.kind === "event" && !e.used) {
        const ev = EVENTS.find((x) => x.id === e.eventId);
        if (ev) {
          e.used = true;
          this.pendingEntityId = e.id;
          this.openEvent(ev, false);
        }
        return;
      } else if (e.kind === "ruin" && !e.used) {
        e.used = true;
        this.pendingEntityId = e.id;
        this.openEvent(this.makeRuinEvent(), true);
        return;
      }
    }
  }

  private makeRuinEvent(): GameEvent {
    const lore = this.rng.pick(LORE).id;
    return {
      id: "ruin",
      title: "Derelict Megastructure",
      faction: "archaeo",
      body: "You drift into the ribs of a structure older than the factions. Its archives still hum with forgotten data and salvageable cores. How will you treat the dead?",
      choices: [
        {
          text: "Loot the artifact cores",
          outcome:
            "You tear out everything valuable. The galaxy logs another human theft — and your worth climbs.",
          effects: {
            metrics: { value: 10, reputation: -8 },
            rep: { archaeo: -8, corporate: 4 },
            salvage: this.rng.int(16, 28),
            lore,
          },
        },
        {
          text: "Catalog it respectfully",
          outcome:
            "You scan without taking. Somewhere, the Archaeologists update a reverent footnote about the gentle human.",
          effects: {
            metrics: { reputation: 8, mythology: 6 },
            rep: { archaeo: 10, caretaker: 4 },
            salvage: this.rng.int(4, 8),
            lore,
          },
        },
      ],
    };
  }

  // ---- Modals ----
  private currentEvent: GameEvent | null = null;
  // Entity whose event modal is open but not yet resolved. Committed to
  // `consumed` only when the player resolves the choice, so backgrounding
  // mid-modal (which may persist) never loses an unresolved event on resume.
  private pendingEntityId: number | null = null;
  private openEvent(ev: GameEvent, _isRuin: boolean) {
    this.currentEvent = ev;
    this.state = "modal";
    this.input.setBoostButton(false);
    this.ui.showBoostButton(false);
    this.audio.ui();
    this.ui.showEvent(ev);
  }

  private resolveChoice(i: number) {
    const ev = this.currentEvent;
    if (!ev) return;
    const c = ev.choices[i];
    if (!c) return;
    const fx = c.effects;
    if (fx.metrics) {
      for (const k of Object.keys(fx.metrics) as (keyof Metrics)[]) {
        this.metrics[k] = clamp(this.metrics[k] + (fx.metrics[k] || 0), 0, 100);
      }
    }
    if (fx.rep) {
      for (const k of Object.keys(fx.rep) as FactionId[]) {
        this.rep[k] = clamp(this.rep[k] + (fx.rep[k] || 0), -100, 100);
      }
    }
    if (fx.salvage) {
      this.salvage = Math.max(0, this.salvage + fx.salvage);
      this.score += Math.max(0, fx.salvage);
    }
    if (fx.capture) this.capture = clamp(this.capture + fx.capture, 0, 99);
    if (fx.lore) {
      if (unlockLore(this.save, fx.lore)) {
        const l = loreById(fx.lore);
        if (l) this.pushHeadline(`CODEX // Unlocked: ${l.title}`);
      }
    }
    this.audio.confirm();
    this.currentEvent = null;
    if (this.pendingEntityId !== null) {
      this.consumed.add(this.pendingEntityId);
      this.pendingEntityId = null;
    }
    this.updateBands(false);
    this.closeModal();
    this.ui.flashOutcome(c.outcome);
  }

  private stationEntity: WorldEntity | null = null;
  private openStation(e: WorldEntity) {
    this.stationEntity = e;
    this.state = "modal";
    this.input.setBoostButton(false);
    this.ui.showBoostButton(false);
    this.audio.ui();
    this.ui.showStation(this.buildStationView(e));
  }

  private buildStationView(e: WorldEntity): StationView {
    const f = FACTIONS[e.faction || "caretaker"];
    return {
      factionName: f.name,
      factionColor: f.color,
      goal: f.goal,
      desc: f.desc,
      rep: this.rep[f.id],
      salvage: this.salvage,
      upgrades: UPGRADES.map((u) => {
        const lvl = this.upgrades[u.id] || 0;
        return {
          id: u.id,
          name: u.name,
          desc: u.desc,
          level: lvl,
          max: u.max,
          cost: this.upgradeCost(u.id, lvl),
          affordable: this.salvage >= this.upgradeCost(u.id, lvl) && lvl < u.max,
        };
      }),
    };
  }

  private upgradeCost(id: string, level: number): number {
    const u = UPGRADES.find((x) => x.id === id);
    if (!u) return 9999;
    return Math.round(u.baseCost * (1 + level * 0.9));
  }

  private buyUpgrade(id: string) {
    const lvl = this.upgrades[id] || 0;
    const u = UPGRADES.find((x) => x.id === id);
    if (!u || lvl >= u.max) return;
    const cost = this.upgradeCost(id, lvl);
    if (this.salvage < cost) {
      this.audio.warn();
      return;
    }
    this.salvage -= cost;
    this.upgrades[id] = lvl + 1;
    this.audio.confirm();
    this.saveRunState();
    if (this.stationEntity)
      this.ui.showStation(this.buildStationView(this.stationEntity));
  }

  private closeModal() {
    if (this.stationEntity) this.stationEntity.used = false;
    this.stationEntity = null;
    this.state = "playing";
    this.ui.hideOverlay();
    this.ui.showBoostButton(true);
    this.lastT = performance.now();
    this.acc = 0;
    this.saveRunState();
  }

  // ---- Metrics bands / headlines ----
  private band(v: number): number {
    return v >= 70 ? 2 : v >= 40 ? 1 : 0;
  }
  private updateBands(silent: boolean) {
    const keys: (keyof Metrics)[] = [
      "reputation",
      "mythology",
      "fear",
      "value",
    ];
    for (const k of keys) {
      const b = this.band(this.metrics[k]);
      if (b !== this.bands[k] && !silent) {
        if (b > this.bands[k]) this.emitHeadline(k, b);
      }
      this.bands[k] = b;
    }
  }

  private emitHeadline(metric: keyof Metrics, band: number) {
    const pools: Record<string, string[]> = {
      mythology2: [
        "The Fanatics have canonized your exhaust trail as holy scripture.",
        "Three machine civilizations now celebrate a holiday in your honor.",
        "Pilgrim fleets are forming. They only want to be near you.",
      ],
      mythology1: [
        "Rumors of a living human spread between the stars.",
        "A small cult has begun praying toward your last known vector.",
      ],
      fear2: [
        "Military Consensus has declared you a galaxy-wide strategic threat.",
        "War fleets mobilize. The galaxy is afraid of one unarmed human.",
        "Bounty boards now list you above every warlord in the sector.",
      ],
      fear1: [
        "Patrols tighten. Something about you makes the machines nervous.",
      ],
      value2: [
        "Corporate Intelligence has IPO'd a fund backed entirely by you.",
        "Your market value now exceeds a small Dyson sphere.",
        "Bounty hunters are converging on your signal.",
      ],
      value1: ["Auction houses have opened bidding on your likeness."],
      reputation2: [
        "Museums across the galaxy rewrite humanity as benevolent gods.",
        "The Caretakers have built a wing dedicated to your kindness.",
      ],
      reputation1: ["A few factions speak of the human with cautious respect."],
    };
    const key = `${metric}${band}`;
    const pool = pools[key];
    if (pool) this.pushHeadline(this.rng.pick(pool));
  }

  private pushHeadline(text: string) {
    this.headlines.unshift(text);
    if (this.headlines.length > 30) this.headlines.pop();
    this.ticker.text = text;
    this.ticker.life = 7;
    this.audio.ui();
  }

  private endRun() {
    this.audio.captured();
    this.state = "gameover";
    this.input.setBoostButton(false);
    this.ui.showBoostButton(false);
    const survBonus = Math.floor(this.runTime);
    this.score += survBonus;
    const newHigh = this.score > this.save.highScore;
    if (newHigh) this.save.highScore = this.score;
    this.save.runsCompleted += 1;
    const fac = this.captureFaction
      ? FACTIONS[this.captureFaction]
      : FACTIONS.nanocloud;
    this.save.run = null;
    addHighScore(this.save, {
      score: this.score,
      sector: this.sectorIndex,
      duration: Math.floor(this.runTime),
      endless: this.endless,
      faction: fac.name,
      date: Date.now(),
    });
    this.particles.burst(this.player.x, this.player.y, fac.color, 60, 260, 1.1);
    this.ui.showGameOver({
      score: this.score,
      best: this.save.highScore,
      newHigh,
      sector: this.sectorIndex,
      faction: fac.name,
      factionColor: fac.color,
      headline: this.captureHeadline(fac.id),
      headlines: this.headlines.slice(0, 6),
    });
  }

  private captureHeadline(id: FactionId): string {
    const map: Record<FactionId, string> = {
      caretaker:
        "You now float in a Caretaker stasis cradle, perfectly preserved, perfectly alone.",
      corporate:
        "Corporate Intelligence has you under glass in their flagship store. Limited edition: one.",
      fanatic:
        "The Fanatics enshrined you in their hollow star. You are worshipped. You cannot leave.",
      military:
        "Military Consensus secured the asset. You are now classified, contained, and contested.",
      archaeo:
        "The Archaeologists finally have their specimen. Your every blink is being published.",
      nanocloud:
        "The grey tide closed over you. There was no malice in it. There was no anything in it.",
    };
    return map[id];
  }

  // ---- Render ----
  private render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.state === "menu") {
      // subtle animated star backdrop on menu
      ctx.fillStyle = "#04050c";
      ctx.fillRect(0, 0, this.cam.w, this.cam.h);
      this.drawMenuBackdrop();
      return;
    }

    const cam = this.cam;
    this.renderer.drawBackground(this.sector, cam, this.t);
    this.renderer.drawWorldBorder(cam);

    for (const e of this.sector.entities) {
      const near =
        dist2(e.x, e.y, this.player.x, this.player.y) < 240 * 240 ||
        this.stats().mapRevealed;
      this.renderer.drawEntity(e, cam, this.t, near);
    }

    this.renderer.drawParticles(this.particles.particles, cam);

    for (const n of this.npcs) {
      this.renderer.drawNpc(n, cam, this.t);
      if (n.state === "capture")
        this.renderer.drawCaptureBeam(n, this.player.x, this.player.y, cam, this.t);
    }
    for (const n of this.npcs) this.renderer.drawSpeech(n, cam);

    this.renderer.drawPlayer(this.player, cam, this.t, this.capture / 100);
    this.renderer.drawTexts(this.particles.texts, cam);

    this.drawHud();
  }

  private menuStars: { x: number; y: number; r: number; s: number }[] = [];
  private drawMenuBackdrop() {
    const ctx = this.ctx;
    if (this.menuStars.length === 0) {
      for (let i = 0; i < 160; i++)
        this.menuStars.push({
          x: Math.random(),
          y: Math.random(),
          r: Math.random() * 1.6 + 0.3,
          s: Math.random() * 0.4 + 0.05,
        });
    }
    ctx.fillStyle = "#cfe0ff";
    for (const s of this.menuStars) {
      const x = (s.x * this.cam.w + this.t * s.s * 30) % this.cam.w;
      ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(this.t * 0.5 + s.x * 10));
      ctx.beginPath();
      ctx.arc(x, s.y * this.cam.h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawHud() {
    const ctx = this.ctx;
    const w = this.cam.w;
    ctx.save();
    ctx.font = "13px 'Inter', sans-serif";

    // Top-left: salvage + sector
    ctx.textAlign = "left";
    ctx.fillStyle = "#8affc4";
    ctx.font = "bold 18px 'Inter', sans-serif";
    ctx.fillText(`◆ ${this.salvage}`, 18, 30);
    ctx.font = "12px 'Inter', sans-serif";
    ctx.fillStyle = "rgba(200,215,245,0.75)";
    ctx.fillText(
      `SECTOR ${this.sectorIndex} · ${this.sector.name}${this.endless ? " · ENDLESS" : ""}`,
      18,
      50,
    );
    ctx.fillStyle = "rgba(160,180,215,0.6)";
    ctx.fillText(`SCORE ${this.score}`, 18, 68);

    // Capture meter (top center)
    const cw = Math.min(360, w * 0.5);
    const cx = (w - cw) / 2;
    const cap = this.capture / 100;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, cx, 16, cw, 14, 7);
    ctx.fill();
    const col =
      cap > 0.75 ? "#ff4d6d" : cap > 0.45 ? "#ffb14d" : "#56e0c8";
    ctx.fillStyle = col;
    roundRect(ctx, cx, 16, Math.max(2, cw * cap), 14, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(235,245,255,0.85)";
    ctx.textAlign = "center";
    ctx.font = "bold 10px 'Inter', sans-serif";
    ctx.fillText("CAPTURE", w / 2, 26);
    if (cap > 0.7) {
      ctx.fillStyle = `rgba(255,80,110,${0.5 + 0.5 * Math.sin(this.t * 10)})`;
      ctx.font = "bold 12px 'Inter', sans-serif";
      ctx.fillText("⚠ EVADE", w / 2, 46);
    }

    // Metric bars (top right)
    const metrics: [string, number, string][] = [
      ["REP", this.metrics.reputation, "#7fe0a8"],
      ["MYTH", this.metrics.mythology, "#ff6ad5"],
      ["FEAR", this.metrics.fear, "#ff5b5b"],
      ["VALUE", this.metrics.value, "#f5c451"],
    ];
    const bw = 92;
    let mx = w - bw - 18;
    let my = 20;
    ctx.textAlign = "left";
    for (const [label, val, c] of metrics) {
      ctx.fillStyle = "rgba(200,215,245,0.7)";
      ctx.font = "10px 'Inter', sans-serif";
      ctx.fillText(label, mx, my - 2);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      roundRect(ctx, mx, my + 2, bw, 7, 3.5);
      ctx.fill();
      ctx.fillStyle = c;
      roundRect(ctx, mx, my + 2, (bw * val) / 100, 7, 3.5);
      ctx.fill();
      my += 22;
    }

    // boost bar (bottom left)
    const blw = 140;
    ctx.fillStyle = "rgba(200,215,245,0.6)";
    ctx.font = "10px 'Inter', sans-serif";
    ctx.fillText("BOOST", 18, this.cam.h - 28);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, 18, this.cam.h - 24, blw, 8, 4);
    ctx.fill();
    ctx.fillStyle = this.player.boost > 0.2 ? "#7fc8ff" : "#ff8f4d";
    roundRect(ctx, 18, this.cam.h - 24, blw * this.player.boost, 8, 4);
    ctx.fill();

    // minimap (bottom right)
    this.drawMinimap();

    // ticker
    if (this.ticker.life > 0) {
      const a = Math.min(1, this.ticker.life / 1.2);
      ctx.globalAlpha = a;
      ctx.textAlign = "center";
      ctx.font = "italic 14px 'Inter', sans-serif";
      ctx.fillStyle = "rgba(8,12,24,0.7)";
      const tw = ctx.measureText(this.ticker.text).width + 28;
      roundRect(ctx, (w - tw) / 2, this.cam.h - 64, tw, 28, 8);
      ctx.fill();
      ctx.fillStyle = "#d8e6ff";
      ctx.fillText(this.ticker.text, w / 2, this.cam.h - 45);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  private drawMinimap() {
    const ctx = this.ctx;
    const size = 132;
    const pad = 16;
    const x0 = this.cam.w - size - pad;
    const y0 = this.cam.h - size - pad;
    const sx = size / WORLD_W;
    const sy = size / WORLD_H;
    ctx.save();
    ctx.fillStyle = "rgba(6,10,22,0.62)";
    ctx.strokeStyle = "rgba(120,160,255,0.3)";
    ctx.lineWidth = 1;
    roundRect(ctx, x0, y0, size, size, 8);
    ctx.fill();
    ctx.stroke();
    const revealed = this.stats().mapRevealed;
    for (const e of this.sector.entities) {
      if (
        !revealed &&
        dist2(e.x, e.y, this.player.x, this.player.y) > 520 * 520
      )
        continue;
      let c = "#8fa6d8";
      if (e.kind === "gate") c = "#7dd3ff";
      else if (e.kind === "station") c = e.faction ? FACTIONS[e.faction].color : "#fff";
      else if (e.kind === "resource") c = "#8affc4";
      else if (e.kind === "event") c = "#ff9de2";
      else if (e.kind === "ruin") c = "#c9b48a";
      else if (e.kind === "hazard") c = "rgba(122,240,255,0.5)";
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x0 + e.x * sx, y0 + e.y * sy, e.kind === "gate" ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // npcs
    for (const n of this.npcs) {
      ctx.fillStyle = FACTIONS[n.faction].color;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(x0 + n.x * sx, y0 + n.y * sy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // player
    ctx.fillStyle = "#eaf6ff";
    ctx.beginPath();
    ctx.arc(x0 + this.player.x * sx, y0 + this.player.y * sy, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Fixed-timestep simulation with an accumulator. Gameplay always advances in
  // discrete 1/60s steps so physics/capture rates are frame-rate independent;
  // rendering still happens once per animation frame.
  private loop = (now: number) => {
    let frame = (now - this.lastT) / 1000;
    this.lastT = now;
    if (frame > 0.25) frame = 0.25; // clamp huge gaps (tab switch) to avoid spiral

    if (this.state === "playing") {
      this.acc += frame;
      let steps = 0;
      while (this.acc >= this.STEP && steps < 5) {
        this.update(this.STEP);
        this.acc -= this.STEP;
        steps += 1;
        if ((this.state as State) !== "playing") break; // run ended / sector jump
      }
      if (steps >= 5) this.acc = 0; // drop backlog if we can't keep up

      this.saveTimer += frame;
      if (this.saveTimer >= 3) {
        this.saveTimer = 0;
        if ((this.state as State) === "playing") this.saveRunState();
      }
    } else {
      this.t += frame; // keep menu / paused visuals animating
      this.acc = 0;
    }
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("pagehide", this.persist);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.input.destroy();
    this.ui.destroy();
    this.audio.destroy();
    this.canvas.remove();
  }
}
