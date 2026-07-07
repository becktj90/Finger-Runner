import { GameSystem, GameState, Vec2 } from '../core/types';

export interface Camera {
  position: Vec2;
  zoom: number;
  width: number;
  height: number;
  targetPosition?: Vec2;
  followSpeed: number;
}

export class CameraSystem implements GameSystem {
  readonly name = 'CameraSystem';

  private camera: Camera;

  constructor(width: number, height: number) {
    this.camera = {
      position: { x: 0, y: 0 },
      zoom: 1,
      width,
      height,
      followSpeed: 0.1,
    };
  }

  update(gameState: GameState): void {
    if (this.camera.targetPosition) {
      this.camera.position.x += (this.camera.targetPosition.x - this.camera.position.x) * this.camera.followSpeed;
      this.camera.position.y += (this.camera.targetPosition.y - this.camera.position.y) * this.camera.followSpeed;
    }
  }

  getCamera(): Camera {
    return this.camera;
  }

  setPosition(x: number, y: number): void {
    this.camera.position.x = x;
    this.camera.position.y = y;
  }

  setZoom(zoom: number): void {
    this.camera.zoom = Math.max(0.1, zoom);
  }

  follow(target: Vec2): void {
    this.camera.targetPosition = target;
  }

  stopFollowing(): void {
    this.camera.targetPosition = undefined;
  }

  screenToWorld(screenX: number, screenY: number): Vec2 {
    return {
      x: screenX / this.camera.zoom + this.camera.position.x - this.camera.width / (2 * this.camera.zoom),
      y: screenY / this.camera.zoom + this.camera.position.y - this.camera.height / (2 * this.camera.zoom),
    };
  }

  worldToScreen(worldX: number, worldY: number): Vec2 {
    return {
      x: (worldX - this.camera.position.x + this.camera.width / (2 * this.camera.zoom)) * this.camera.zoom,
      y: (worldY - this.camera.position.y + this.camera.height / (2 * this.camera.zoom)) * this.camera.zoom,
    };
  }

  destroy(): void {}
}
