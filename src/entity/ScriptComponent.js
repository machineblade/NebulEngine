// ============================================================
//  src/entity/ScriptComponent.js — User Behaviour Scripting
//  Accepts an object with lifecycle hooks:
//    { onStart, onUpdate, onDestroy }
//
//  All hooks are called with .call(scriptObj, ...) so that
//  `this` inside your script always refers to the script object,
//  letting you store state with this.myVar across frames.
// ============================================================

export class ScriptComponent {
  constructor (script = {}) {
    this._entity  = null;
    this._script  = script;
    this._started = false;
    this._logger  = null;   // injected by Engine after creation
  }

  onAttach (entity) {
    this._entity = entity;
    if (this._script.onAttach) {
      try { this._script.onAttach.call(this._script, entity); }
      catch (err) { this._err('onAttach', err); }
    }
  }

  update (dt, elapsed, bounds) {
    if (!this._started) {
      if (this._script.onStart) {
        try { this._script.onStart.call(this._script, this._entity); }
        catch (err) { this._err('onStart', err); }
      }
      this._started = true;
    }

    if (this._script.onUpdate) {
      try { this._script.onUpdate.call(this._script, this._entity, dt, elapsed, bounds); }
      catch (err) { this._err('onUpdate', err); }
    }
  }

  onDetach (entity) {
    if (this._script.onDestroy) {
      try { this._script.onDestroy.call(this._script, entity); }
      catch (err) { this._err('onDestroy', err); }
    }
  }

  /** Swap the script at runtime (e.g. from the workspace panel). */
  setScript (script) {
    if (this._script.onDestroy) {
      try { this._script.onDestroy.call(this._script, this._entity); }
      catch (err) { this._err('onDestroy', err); }
    }
    this._script  = script;
    this._started = false;
  }

  // ── Internal ───────────────────────────────────────────────
  _err (hook, err) {
    const msg = `[${this._entity?.name ?? '?'}] script.${hook}: ${err.message}`;
    if (this._logger) {
      this._logger.error(msg);
    } else {
      console.error(msg, err);
    }
  }
}