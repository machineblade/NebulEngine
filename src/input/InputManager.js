// ============================================================
//  src/input/InputManager.js — Keyboard & Mouse Input
// ============================================================

export class InputManager {
  constructor (events) {
    this.events = events;
    this._keys    = new Set();
    this._prevKeys = new Set();
    this._mouse   = { x: 0, y: 0, buttons: new Set() };

    this._bindListeners();
  }

  _bindListeners () {
    document.addEventListener('keydown', e => {
      this._keys.add(e.code);
      this.events.emit('input:keydown', { code: e.code, key: e.key, altKey: e.altKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey });
    });
    document.addEventListener('keyup', e => {
      this._keys.delete(e.code);
      this.events.emit('input:keyup', { code: e.code, key: e.key, altKey: e.altKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey });
    });
    document.addEventListener('mousemove', e => {
      this._mouse.x = e.clientX;
      this._mouse.y = e.clientY;
    });
    document.addEventListener('mousedown', e => {
      this._mouse.buttons.add(e.button);
      this.events.emit('input:mousedown', { button: e.button, x: e.clientX, y: e.clientY });
    });
    document.addEventListener('mouseup', e => {
      this._mouse.buttons.delete(e.button);
    });
  }

  update () {
    this._prevKeys = new Set(this._keys);
  }

  isKeyDown     (code) { return this._keys.has(code); }
  isKeyJustDown (code) { return this._keys.has(code) && !this._prevKeys.has(code); }
  isKeyJustUp   (code) { return !this._keys.has(code) && this._prevKeys.has(code); }

  isMouseDown  (btn = 0) { return this._mouse.buttons.has(btn); }
  mousePosition ()        { return { x: this._mouse.x, y: this._mouse.y }; }

  /** Axis helpers — returns value in [-1, 1] */
  axisH () {
    const l = this.isKeyDown('ArrowLeft')  || this.isKeyDown('KeyA') ? -1 : 0;
    const r = this.isKeyDown('ArrowRight') || this.isKeyDown('KeyD') ?  1 : 0;
    return l + r;
  }
  axisV () {
    const u = this.isKeyDown('ArrowUp')   || this.isKeyDown('KeyW') ? -1 : 0;
    const d = this.isKeyDown('ArrowDown') || this.isKeyDown('KeyS') ?  1 : 0;
    return u + d;
  }
}