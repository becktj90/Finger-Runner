import { GameSystem, GameState } from '../core/types';

export interface Animation {
  id: string;
  startTime: number;
  duration: number;
  loop: boolean;
  onUpdate: (progress: number, time: number) => void;
  onComplete?: () => void;
}

export class AnimationSystem implements GameSystem {
  readonly name = 'AnimationSystem';

  private animations: Map<string, Animation> = new Map();

  update(gameState: GameState): void {
    const current = gameState.time;

    for (const [id, anim] of this.animations) {
      const elapsed = current - anim.startTime;
      
      if (elapsed < 0) continue;

      if (elapsed > anim.duration) {
        if (anim.loop) {
          anim.startTime = current;
          anim.onUpdate(0, 0);
        } else {
          anim.onUpdate(1, anim.duration);
          anim.onComplete?.();
          this.animations.delete(id);
        }
        continue;
      }

      const progress = elapsed / anim.duration;
      anim.onUpdate(progress, elapsed);
    }
  }

  createAnimation(
    id: string,
    duration: number,
    onUpdate: (progress: number, time: number) => void,
    options: { loop?: boolean; onComplete?: () => void } = {}
  ): string {
    const anim: Animation = {
      id,
      startTime: 0,
      duration,
      loop: options.loop || false,
      onUpdate,
      onComplete: options.onComplete,
    };

    this.animations.set(id, anim);
    return id;
  }

  startAnimation(id: string, gameTime: number): void {
    const anim = this.animations.get(id);
    if (anim) {
      anim.startTime = gameTime;
    }
  }

  stopAnimation(id: string): void {
    this.animations.delete(id);
  }

  destroy(): void {
    this.animations.clear();
  }
}
