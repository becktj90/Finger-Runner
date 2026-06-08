export class Input {
  keys = new Set<string>();
  // Pointer steering for touch/mouse
  pointerActive = false;
  pointerX = 0;
  pointerY = 0;
  boostHeld = false;
  private el: HTMLElement;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;

  constructor(el: HTMLElement) {
    this.el = el;
    this.onKeyDown = (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (
        ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)
      ) {
        e.preventDefault();
      }
      if (k === " ") this.boostHeld = true;
    };
    this.onKeyUp = (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === " ") this.boostHeld = false;
    };
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    el.addEventListener("pointerdown", this.handlePointer);
    el.addEventListener("pointermove", this.handleMove);
    el.addEventListener("pointerup", this.handleUp);
    el.addEventListener("pointercancel", this.handleUp);
  }

  private handlePointer = (e: PointerEvent) => {
    this.pointerActive = true;
    this.updatePointer(e);
  };
  private handleMove = (e: PointerEvent) => {
    if (this.pointerActive) this.updatePointer(e);
  };
  private handleUp = () => {
    this.pointerActive = false;
  };
  private updatePointer(e: PointerEvent) {
    const rect = this.el.getBoundingClientRect();
    this.pointerX = e.clientX - rect.left;
    this.pointerY = e.clientY - rect.top;
  }

  down(...k: string[]): boolean {
    return k.some((x) => this.keys.has(x));
  }

  setBoostButton(held: boolean) {
    this.boostHeld = held;
  }

  destroy() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.el.removeEventListener("pointerdown", this.handlePointer);
    this.el.removeEventListener("pointermove", this.handleMove);
    this.el.removeEventListener("pointerup", this.handleUp);
    this.el.removeEventListener("pointercancel", this.handleUp);
  }
}
