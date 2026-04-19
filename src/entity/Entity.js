// ============================================================
//  src/entity/Entity.js — Base Entity (ECS-style)
// ============================================================

let _nextId = 1;

export function resetEntityIds () { _nextId = 1; }

export class Entity {
  constructor (name = 'Entity', tags = []) {
    this.id         = _nextId++;
    this.name       = name;
    this.tags       = new Set(tags);
    this.active     = true;
    this._components = new Map();
    this.createdAt  = Date.now();
  }

  // ── Components ─────────────────────────────────────────────
  addComponent (key, component) {
    component._entity = this;
    this._components.set(key, component);
    if (component.onAttach) component.onAttach(this);
    return this;
  }

  getComponent (key) { return this._components.get(key) || null; }

  removeComponent (key) {
    const c = this._components.get(key);
    if (c?.onDetach) c.onDetach(this);
    this._components.delete(key);
  }

  hasTag  (tag) { return this.tags.has(tag); }
  addTag  (tag) { this.tags.add(tag); }
  removeTag (tag) { this.tags.delete(tag); }

  // ── Lifecycle ──────────────────────────────────────────────
  update (dt, elapsed, bounds) {
    if (!this.active) return;
    for (const comp of this._components.values()) {
      if (comp.update) comp.update(dt, elapsed, bounds);
    }
  }

  destroy () {
    for (const comp of this._components.values()) {
      if (comp.onDetach) comp.onDetach(this);
    }
    this._components.clear();
  }

  toJSON () {
    const sprite  = this.getComponent('sprite');
    const physics = this.getComponent('physics');
    return {
      id:        this.id,
      name:      this.name,
      tags:      [...this.tags],
      transform: sprite?.toJSON  ? sprite.toJSON()  : null,
      physics:   physics?.toJSON ? physics.toJSON() : null,
    };
  }
}