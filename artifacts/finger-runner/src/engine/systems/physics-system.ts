import { GameSystem, GameState, Entity } from '../core/types';

export class PhysicsSystem implements GameSystem {
  readonly name = 'PhysicsSystem';

  private gravity: number = 9.81;
  private damping: number = 0.99;

  constructor(gravity: number = 9.81) {
    this.gravity = gravity;
  }

  update(gameState: GameState, deltaTime: number): void {
    // Apply gravity and velocity to all entities
    // This will be called by the GameDirector for all active entities
  }

  applyForce(entity: Entity, forceX: number, forceY: number): void {
    entity.transform.acceleration.x += forceX;
    entity.transform.acceleration.y += forceY;
  }

  applyGravity(entity: Entity, dt: number): void {
    entity.transform.velocity.y += this.gravity * dt;
    entity.transform.velocity.x *= this.damping;
    entity.transform.velocity.y *= this.damping;

    entity.transform.position.y += entity.transform.velocity.y * dt;
    entity.transform.position.x += entity.transform.velocity.x * dt;
  }

  setGravity(gravity: number): void {
    this.gravity = gravity;
  }

  destroy(): void {}
}
