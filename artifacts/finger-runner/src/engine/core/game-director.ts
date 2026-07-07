import { GameSystem, GameState, DebugMetrics, Entity } from './types';

export class GameDirector {
  private gameState: GameState = {
    running: false,
    paused: false,
    score: 0,
    time: 0,
    deltaTime: 0,
  };

  private systems: Map<string, GameSystem> = new Map();
  private entities: Map<number, Entity> = new Map();
  private nextEntityId = 1;
  private lastFrameTime = 0;

  private debugMetrics: DebugMetrics = {
    fps: 0,
    memoryUsed: 0,
    drawCalls: 0,
    activeEntities: 0,
    collisionsPerFrame: 0,
  };

  private frameCount = 0;
  private fpsUpdateInterval = 0;

  constructor() {
    this.lastFrameTime = performance.now();
  }

  registerSystem(system: GameSystem): void {
    this.systems.set(system.name, system);
  }

  unregisterSystem(name: string): void {
    const system = this.systems.get(name);
    if (system) {
      system.destroy();
      this.systems.delete(name);
    }
  }

  registerEntity(entity: Entity): number {
    entity.id = this.nextEntityId++;
    this.entities.set(entity.id, entity);
    return entity.id;
  }

  unregisterEntity(id: number): void {
    this.entities.delete(id);
  }

  getEntity(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  getAllEntities(): Entity[] {
    return Array.from(this.entities.values());
  }

  getActiveEntities(): Entity[] {
    return Array.from(this.entities.values()).filter(e => e.active);
  }

  start(): void {
    this.gameState.running = true;
    this.gameState.time = 0;
    this.lastFrameTime = performance.now();
  }

  stop(): void {
    this.gameState.running = false;
  }

  pause(): void {
    this.gameState.paused = true;
  }

  resume(): void {
    this.gameState.paused = false;
  }

  update(): void {
    const now = performance.now();
    this.gameState.deltaTime = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    if (this.gameState.paused || !this.gameState.running) return;

    this.gameState.time += this.gameState.deltaTime;

    for (const system of this.systems.values()) {
      system.update(this.gameState, this.gameState.deltaTime);
    }

    this.updateDebugMetrics();
  }

  private updateDebugMetrics(): void {
    this.frameCount++;
    this.fpsUpdateInterval += this.gameState.deltaTime;

    if (this.fpsUpdateInterval >= 0.25) {
      this.debugMetrics.fps = Math.round(this.frameCount / this.fpsUpdateInterval);
      this.frameCount = 0;
      this.fpsUpdateInterval = 0;
    }

    if (performance.memory) {
      this.debugMetrics.memoryUsed = Math.round(performance.memory.usedJSHeapSize / 1048576);
    }

    this.debugMetrics.activeEntities = this.getActiveEntities().length;
  }

  getGameState(): GameState {
    return this.gameState;
  }

  getDebugMetrics(): DebugMetrics {
    return this.debugMetrics;
  }

  setScore(score: number): void {
    this.gameState.score = score;
  }

  addScore(amount: number): void {
    this.gameState.score += amount;
  }

  destroy(): void {
    for (const system of this.systems.values()) {
      system.destroy();
    }
    this.systems.clear();
    this.entities.clear();
  }
}
