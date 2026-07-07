// Core type definitions for the Finger Runner game engine

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform {
  position: Vec2;
  velocity: Vec2;
  acceleration: Vec2;
  rotation: number;
  scale: Vec2;
}

export interface Collision {
  entityA: Entity;
  entityB: Entity;
  normal: Vec2;
  depth: number;
}

export interface Entity {
  id: number;
  active: boolean;
  transform: Transform;
  collider?: Rect;
  tag: string;
}

export interface GameState {
  running: boolean;
  paused: boolean;
  score: number;
  time: number;
  deltaTime: number;
}

export interface DebugMetrics {
  fps: number;
  memoryUsed: number;
  drawCalls: number;
  activeEntities: number;
  collisionsPerFrame: number;
}

export type SystemUpdateResult = void | { shouldRemove: boolean };

export interface GameSystem {
  name: string;
  update(gameState: GameState, deltaTime: number): SystemUpdateResult;
  destroy(): void;
}
