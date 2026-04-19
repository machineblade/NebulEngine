// ============================================================
//  src/core/EventBus.js — Pub/Sub Event System
// ============================================================

export class EventBus {
  constructor () {
    this._listeners = new Map();
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on (event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  /** Unsubscribe a specific listener. */
  off (event, fn) {
    this._listeners.get(event)?.delete(fn);
  }

  /** Emit an event with optional payload. */
  emit (event, payload) {
    const listeners = this._listeners.get(event);
    if (!listeners) return;
    for (const fn of listeners) {
      try { fn(payload); }
      catch (err) { console.error('[EventBus] Error in listener for "' + event + '":', err); }
    }
  }

  /** Subscribe to an event once. */
  once (event, fn) {
    const wrapper = (payload) => { fn(payload); this.off(event, wrapper); };
    this.on(event, wrapper);
  }

  /** Remove all listeners for an event (or all events). */
  clear (event) {
    if (event) this._listeners.delete(event);
    else this._listeners.clear();
  }
}