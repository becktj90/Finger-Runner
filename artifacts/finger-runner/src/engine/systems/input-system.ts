import { GameSystem, GameState } from '../core/types';

export interface InputState {
  jumpPressed: boolean;
  pausePressed: boolean;
  customInputs: Map<string, boolean>;
}

export class InputSystem implements GameSystem {
  readonly name = 'InputSystem';

  private inputState: InputState = {
    jumpPressed: false,
    pausePressed: false,
    customInputs: new Map(),
  };

  private jumpCallbacks: Array<() => void> = [];
  private pauseCallbacks: Array<() => void> = [];

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    document.addEventListener('keyup', (e) => this.handleKeyUp(e));
    document.addEventListener('pointerdown', () => this.handlePointerDown());
    document.addEventListener('pointerup', () => this.handlePointerUp());
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      this.inputState.jumpPressed = true;
      this.notifyJump();
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      this.inputState.pausePressed = true;
      this.notifyPause();
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      this.inputState.jumpPressed = false;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      this.inputState.pausePressed = false;
    }
  }

  private handlePointerDown(): void {
    this.inputState.jumpPressed = true;
    this.notifyJump();
  }

  private handlePointerUp(): void {
    this.inputState.jumpPressed = false;
  }

  private notifyJump(): void {
    for (const cb of this.jumpCallbacks) {
      cb();
    }
  }

  private notifyPause(): void {
    for (const cb of this.pauseCallbacks) {
      cb();
    }
  }

  update(): void {}

  onJump(callback: () => void): void {
    this.jumpCallbacks.push(callback);
  }

  onPause(callback: () => void): void {
    this.pauseCallbacks.push(callback);
  }

  getInputState(): InputState {
    return this.inputState;
  }

  destroy(): void {
    this.jumpCallbacks = [];
    this.pauseCallbacks = [];
  }
}
