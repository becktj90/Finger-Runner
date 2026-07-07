import { GameSystem, GameState } from '../core/types';

export class AudioSystem implements GameSystem {
  readonly name = 'AudioSystem';

  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = true;

  constructor() {
    if (typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
    }
  }

  update(): void {}

  playSound(frequency: number, duration: number, type: OscillatorType = 'sine'): void {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.3, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    const now = this.audioContext.currentTime;
    osc.start(now);
    osc.stop(now + duration);
  }

  playJumpSound(): void {
    if (!this.enabled) return;
    this.playSound(680, 0.15, 'sawtooth');
  }

  playCrashSound(): void {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;

    const now = this.audioContext.currentTime;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.5);
    
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.8);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setVolume(volume: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  destroy(): void {
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}
