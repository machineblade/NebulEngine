// ============================================================
//  src/scene/SceneManager.js — Scene & Entity Registry
// ============================================================

export class SceneManager {
  constructor (events, logger) {
    this.events   = events;
    this.logger   = logger;
    this._stage   = null;
    this._w       = 800;
    this._h       = 500;
    this._entities = new Map();   // id → Entity
    this._engine  = null;
    this._world   = null;
    this._walls   = [];
  }

  init (stage, w, h) {
    this._stage = stage;
    this._w = w;
    this._h = h;
    this._engine = Matter.Engine.create();
    this._world = this._engine.world;
    this._world.gravity.x = 0;
    // Default world gravity strength — scripts can override via
    // `this.world.settings.gravity.strength = N` (see Engine._scriptWorld).
    this._world.gravity.y = 1;
    this._createBounds(w, h);
    this._registerCollisionEvents();
  }

  /**
   * Set the Matter world's vertical gravity. 0 = zero-G (default), 1 ≈ Earth.
   * Per-entity `PhysicsComponent.gravity` still stacks on top; fixed bodies
   * (isStatic) ignore gravity as Matter does by default.
   */
  setGravityY (y) {
    if (!this._world) return;
    const v = Number.isFinite(y) ? y : 0;
    this._world.gravity.y = v;
  }

  getGravityY () {
    return this._world ? this._world.gravity.y : 0;
  }

  /**
   * Bridge Matter collisionStart/End events into each entity's script hook.
   *   onCollide(selfEntity, otherEntity, pair)
   *   onSeparate(selfEntity, otherEntity, pair)
   * Ignores pairs where either body isn't linked to an entity (walls).
   */
  _registerCollisionEvents () {
    if (!this._engine || typeof Matter === 'undefined') return;
    const dispatch = (hookName) => (event) => {
      for (const pair of event.pairs) {
        const a = pair.bodyA?.plugin?.entity ?? null;
        const b = pair.bodyB?.plugin?.entity ?? null;
        if (!a || !b) continue;
        this._invokeScriptHook(a, hookName, b, pair);
        this._invokeScriptHook(b, hookName, a, pair);
      }
    };
    Matter.Events.on(this._engine, 'collisionStart', dispatch('onCollide'));
    Matter.Events.on(this._engine, 'collisionEnd',   dispatch('onSeparate'));
  }

  _invokeScriptHook (entity, hookName, other, pair) {
    const sc = entity.getComponent?.('script');
    const fn = sc?._script?.[hookName];
    if (typeof fn !== 'function') return;
    try {
      fn.call(sc._script, entity, other, pair);
    } catch (err) {
      const msg = `[${entity.name}] script.${hookName}: ${err.message}`;
      if (sc?._logger) sc._logger.error(msg);
      else             console.error(msg, err);
    }
  }

  _createBounds (w, h) {
    if (!this._world) return;

    for (const wall of this._walls) {
      Matter.World.remove(this._world, wall, true);
    }

    const thickness = 80;
    const wallOptions = {
      isStatic: true,
      restitution: 1,
      friction: 0,
      frictionStatic: 0,
      label: 'scene-wall',
    };

    this._walls = [
      Matter.Bodies.rectangle(w / 2, -thickness / 2, w, thickness, wallOptions),
      Matter.Bodies.rectangle(w / 2, h + thickness / 2, w, thickness, wallOptions),
      Matter.Bodies.rectangle(-thickness / 2, h / 2, thickness, h, wallOptions),
      Matter.Bodies.rectangle(w + thickness / 2, h / 2, thickness, h, wallOptions),
    ];

    Matter.World.add(this._world, this._walls);
  }

  onResize (w, h) {
    this._w = w;
    this._h = h;
    this._createBounds(w, h);
  }

  bounds () { return { w: this._w, h: this._h }; }

  addEntity (entity) {
    this._entities.set(entity.id, entity);

    const sprite = entity.getComponent('sprite');
    const physics = entity.getComponent('physics');
    if (physics && sprite) {
      physics.initBody(this._world, sprite);
    }

    this.events.emit('scene:entityAdded', entity);
  }

  hitTest (x, y) {
    const entities = [...this._entities.values()].reverse();
    for (const entity of entities) {
      const sprite = entity.getComponent('sprite');
      if (!sprite || !entity.active) continue;
      const dx = x - sprite.x;
      const dy = y - sprite.y;
      const cos = Math.cos(-sprite.rotation);
      const sin = Math.sin(-sprite.rotation);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;

      // Account for the sprite's visual scale — the PIXI Graphics is
      // scaled in syncGraphics, so hitTest must match the rendered size.
      const sx = sprite.scaleX ?? 1;
      const sy = sprite.scaleY ?? 1;
      switch (sprite.shape) {
        case 'rect':
        case 'square':
        case 'rsquare':
          if (Math.abs(lx) <= (sprite.w * sx) / 2 && Math.abs(ly) <= (sprite.h * sy) / 2) return entity;
          break;
        case 'diamond':
        case 'star':
        case 'rstar':
        case 'circle':
        default: {
          // Non-uniform scale on a circular shape → use an elliptical test so
          // clicks still land on the visible silhouette.
          const rx = (sprite.r || Math.max(sprite.w, sprite.h) / 2) * sx;
          const ry = (sprite.r || Math.max(sprite.w, sprite.h) / 2) * sy;
          if (rx > 0 && ry > 0 && ((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry)) <= 1) return entity;
        }
      }
    }
    return null;
  }

  removeEntity (id) {
    const entity = this._entities.get(id);
    if (!entity) return;

    const spr = entity.getComponent('sprite');
    if (spr) spr.detach(this._stage);
    entity.destroy();
    this._entities.delete(id);
    this.events.emit('scene:entityRemoved', entity);
  }

  getEntity (id) { return this._entities.get(id) || null; }
  getAllEntities () { return [...this._entities.values()]; }
  entityCount () { return this._entities.size; }

  update (dt, elapsed) {
    if (this._engine) {
      Matter.Engine.update(this._engine, dt * 1000);
    }

    const bounds = { w: this._w, h: this._h };
    for (const entity of this._entities.values()) {
      entity.update(dt, elapsed, bounds);
    }
    this.events.emit('scene:updated', { dt, elapsed, entityCount: this._entities.size });
  }

  reset () {
    if (this._engine) {
      Matter.Engine.update(this._engine, 0);
    }
  }

  clear () {
    for (const id of [...this._entities.keys()]) {
      this.removeEntity(id);
    }
    this.events.emit('scene:cleared');
  }
}
