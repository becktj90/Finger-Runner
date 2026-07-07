import { Entity } from '../../engine/core/types';

export type ObstacleType = 'tree' | 'pole' | 'sign' | 'bush';

export class Obstacle implements Entity {
  id = 0;
  active = true;
  tag = 'obstacle';

  type: ObstacleType;
  width = 82;

  transform = {
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  };

  collider = {
    x: 0,
    y: 0,
    width: 82,
    height: 0,
  };

  topHeight: number;
  gapSize: number;
  passed = false;

  constructor(type: ObstacleType, topHeight: number, gapSize: number, x: number = 0) {
    this.type = type;
    this.topHeight = topHeight;
    this.gapSize = gapSize;
    this.transform.position.x = x;
    this.transform.position.y = 0;
    this.collider.height = topHeight;
  }

  setSpeed(speed: number): void {
    this.transform.velocity.x = -speed;
  }

  markPassed(): void {
    this.passed = true;
  }

  isOffScreen(screenWidth: number): boolean {
    return this.transform.position.x < -120;
  }
}
