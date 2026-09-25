// Keyboard / mouse input with pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame
    this.mouseButtons = 0;
    this.mousePressed = new Set();
    this.mouseReleased = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.enabled = false;
    this.onLockChange = null;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space' || (e.ctrlKey && e.code !== 'ControlLeft')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.enabled || !this.locked) return;
      this.mouseButtons |= 1 << e.button;
      this.mousePressed.add(e.button);
    });
    document.addEventListener('mouseup', (e) => {
      this.mouseButtons &= ~(1 << e.button);
      this.mouseReleased.add(e.button);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Guard against the occasional huge spike some browsers emit on lock
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true }
    );
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.mouseButtons = 0;
        this.keys.clear();
      }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    if (this.locked) return;
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (p && p.catch) {
      p.catch(() => this.canvas.requestPointerLock?.());
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }
  hit(code) {
    return this.pressed.has(code);
  }
  mouse(button) {
    return (this.mouseButtons & (1 << button)) !== 0;
  }
  mouseHit(button) {
    return this.mousePressed.has(button);
  }

  endFrame() {
    this.pressed.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}
