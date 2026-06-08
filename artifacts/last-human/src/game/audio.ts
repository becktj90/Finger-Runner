export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private muted = false;
  private started = false;

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.now(), 0.05);
    }
  }

  isMuted() {
    return this.muted;
  }

  private now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  init() {
    if (this.started) {
      if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this.started = true;
      this.startDrone();
    } catch {
      this.ctx = null;
    }
  }

  private startDrone() {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    this.droneGain = c.createGain();
    this.droneGain.gain.value = 0.06;
    this.droneGain.connect(this.master);

    const freqs = [55, 82.5, 110];
    for (const f of freqs) {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 1.5;
      lfo.connect(lfoGain);
      lfoGain.connect(o.frequency);
      const g = c.createGain();
      g.gain.value = 0.5;
      o.connect(g);
      g.connect(this.droneGain);
      o.start();
      lfo.start();
    }
  }

  setTension(t: number) {
    if (this.droneGain) {
      this.droneGain.gain.setTargetAtTime(0.05 + t * 0.12, this.now(), 0.4);
    }
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol = 0.3) {
    if (!this.ctx || !this.master || this.muted) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(c.currentTime + dur + 0.02);
  }

  ui() {
    this.blip(660, 0.08, "square", 0.18);
  }
  confirm() {
    this.blip(520, 0.1, "triangle", 0.22);
    setTimeout(() => this.blip(780, 0.12, "triangle", 0.2), 60);
  }
  pickup() {
    this.blip(880, 0.09, "sine", 0.25);
    setTimeout(() => this.blip(1180, 0.1, "sine", 0.2), 50);
  }
  warn() {
    this.blip(180, 0.18, "sawtooth", 0.18);
  }
  jump() {
    if (!this.ctx || !this.master || this.muted) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(120, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(900, c.currentTime + 0.5);
    g.gain.setValueAtTime(0.25, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(c.currentTime + 0.65);
  }
  captured() {
    if (!this.ctx || !this.master || this.muted) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(440, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(60, c.currentTime + 1.2);
    g.gain.setValueAtTime(0.3, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.3);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(c.currentTime + 1.35);
  }

  destroy() {
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        /* ignore */
      }
    }
    this.ctx = null;
    this.master = null;
    this.droneGain = null;
    this.started = false;
  }
}
