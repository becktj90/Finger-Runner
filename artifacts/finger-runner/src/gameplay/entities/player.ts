import { Entity, Vec2 } from '../../engine/core/types';

export class Player implements Entity {
  id = 0;
  active = true;
  tag = 'player';

  transform = {
    position: { x: 175, y: 300 },
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  };

  collider = {
    x: 0,
    y: 0,
    width: 30,
    height: 60,
  };

  jumpForce = -13.5;
  jumpVelocity = 0;
  isGrounded = true;

  onGround(y: number, groundLevel: number): boolean {
    return Math.abs(this.transform.position.y - groundLevel) < 5;
  }

  jump(velocity: number = this.jumpForce): void {
    if (this.isGrounded) {
      this.transform.velocity.y = velocity;
      this.isGrounded = false;
    }
  }

  setPosition(x: number, y: number): void {
    this.transform.position.x = x;
    this.transform.position.y = y;
  }

  getPosition(): Vec2 {
    return this.transform.position;
  }

  getVelocity(): Vec2 {
    return this.transform.velocity;
  }
}
