import { GameSystem, GameState } from '../core/types';

export interface SaveData {
  bestScore: number;
  playCount: number;
  totalPlayTime: number;
  achievements: string[];
  settings: Record<string, any>;
  lastRun: Record<string, any> | null;
}

export class SaveSystem implements GameSystem {
  readonly name = 'SaveSystem';

  private saveKey = 'fingerRunnerSave';
  private data: SaveData = {
    bestScore: 0,
    playCount: 0,
    totalPlayTime: 0,
    achievements: [],
    settings: {},
    lastRun: null,
  };

  constructor() {
    this.load();
  }

  update(): void {}

  load(): void {
    try {
      const saved = localStorage.getItem(this.saveKey);
      if (saved) {
        this.data = JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load game data:', e);
    }
  }

  save(): void {
    try {
      localStorage.setItem(this.saveKey, JSON.stringify(this.data));
    } catch (e) {
      console.error('Failed to save game data:', e);
    }
  }

  getData(): SaveData {
    return this.data;
  }

  setBestScore(score: number): void {
    if (score > this.data.bestScore) {
      this.data.bestScore = score;
      this.save();
    }
  }

  incrementPlayCount(): void {
    this.data.playCount++;
    this.save();
  }

  addPlayTime(time: number): void {
    this.data.totalPlayTime += time;
    this.save();
  }

  unlockAchievement(id: string): void {
    if (!this.data.achievements.includes(id)) {
      this.data.achievements.push(id);
      this.save();
    }
  }

  saveSetting(key: string, value: any): void {
    this.data.settings[key] = value;
    this.save();
  }

  getSetting(key: string, defaultValue?: any): any {
    return this.data.settings[key] ?? defaultValue;
  }

  saveRun(runData: Record<string, any>): void {
    this.data.lastRun = runData;
    this.save();
  }

  getLastRun(): Record<string, any> | null {
    return this.data.lastRun;
  }

  clear(): void {
    this.data = {
      bestScore: 0,
      playCount: 0,
      totalPlayTime: 0,
      achievements: [],
      settings: {},
      lastRun: null,
    };
    localStorage.removeItem(this.saveKey);
  }

  destroy(): void {}
}
