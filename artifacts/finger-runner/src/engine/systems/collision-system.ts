import { GameSystem, GameState, Entity, Collision } from '../core/types';

export class CollisionSystem implements GameSystem {
  readonly name = 'CollisionSystem';

  private collisions: Collision[] = [];
  private collisionCallbacks: Map<string, (c: Collision) => void> = new Map();

  update(gameState: GameState): void {
    this.collisions = [];
  }

  checkCollisions(entities: Entity[]): Collision[] {
    this.collisions = [];
    
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i];
        const b = entities[j];
        
        if (!a.collider || !b.collider || !a.active || !b.active) continue;

        if (this.rectanglesIntersect(a, b)) {
          const collision: Collision = {
            entityA: a,
            entityB: b,
            normal: { x: 0, y: 0 },
            depth: 0,
          };
          
          this.collisions.push(collision);
          
          const key = `${a.tag}-${b.tag}`;
          const callback = this.collisionCallbacks.get(key);
          if (callback) callback(collision);
        }
      }
    }

    return this.collisions;
  }

  private rectanglesIntersect(a: Entity, b: Entity): boolean {
    if (!a.collider || !b.collider) return false;
    
    const aLeft = a.transform.position.x + a.collider.x;
    const aRight = aLeft + a.collider.width;
    const aTop = a.transform.position.y + a.collider.y;
    const aBottom = aTop + a.collider.height;

    const bLeft = b.transform.position.x + b.collider.x;
    const bRight = bLeft + b.collider.width;
    const bTop = b.transform.position.y + b.collider.y;
    const bBottom = bTop + b.collider.height;

    return aLeft < bRight && aRight > bLeft && aTop < bBottom && aBottom > bTop;
  }

  registerCollisionCallback(tagPair: string, callback: (c: Collision) => void): void {
    this.collisionCallbacks.set(tagPair, callback);
  }

  getLastCollisions(): Collision[] {
    return this.collisions;
  }

  destroy(): void {
    this.collisions = [];
    this.collisionCallbacks.clear();
  }
}
