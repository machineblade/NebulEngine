// ============================================================
//  src/input/InputManager.js — Keyboard & Mouse Input
// ============================================================

/** Returns true when the keyboard event originated in an editable DOM field
 *  (textarea, input, contenteditable). We ignore these so typing code in the
 *  script editor doesn't trigger engine shortcuts or script input. */
function _isEditableTarget (target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export class InputManager {
  constructor (events) {
    this.events    = events;
    this._keys     = new Set();
    this._prevKeys = new Set();
    this._mouse    = { x: 0, y: 0, buttons: new Set() };

    this._bindListeners();
  }

  _bindListeners () {
    document.addEventListener('keydown', (e) => {
      if (_isEditableTarget(e.target)) return;
      this._keys.add(e.code);
      this.events.emit('input:keydown', {
        code: e.code, key: e.key,
        altKey: e.altKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey,
      });
    });
    document.addEventListener('keyup', (e) => {
      // Always release a key we know about, even if focus is now in a field —
      // otherwise keys can get "stuck" down.
      this._keys.delete(e.code);
      if (_isEditableTarget(e.target)) return;
      this.events.emit('input:keyup', {
        code: e.code, key: e.key,
        altKey: e.altKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey,
      });
    });
    // Release all keys on window blur to avoid stuck keys after alt-tab.
    window.addEventListener('blur', () => this._keys.clear());

    document.addEventListener('mousemove', (e) => {
      this._mouse.x = e.clientX;
      this._mouse.y = e.clientY;
    });
    document.addEventListener('mousedown', (e) => {
      this._mouse.buttons.add(e.button);
      this.events.emit('input:mousedown', { button: e.button, x: e.clientX, y: e.clientY });
    });
    document.addEventListener('mouseup', (e) => {
      this._mouse.buttons.delete(e.button);
    });
  }

  /**
   * Snapshot the current key state. Must be called at the END of the frame
   * so `isKeyJustDown` / `isKeyJustUp` compare this frame's state against the
   * previous frame's state rather than against themselves.
   */
  update () {
    this._prevKeys = new Set(this._keys);
  }

  isKeyDown     (code) { return this._keys.has(code); }
  isKeyJustDown (code) { return this._keys.has(code) && !this._prevKeys.has(code); }
  isKeyJustUp   (code) { return !this._keys.has(code) && this._prevKeys.has(code); }

  isMouseDown   (btn = 0) { return this._mouse.buttons.has(btn); }
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
