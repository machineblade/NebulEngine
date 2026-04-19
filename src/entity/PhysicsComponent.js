// ============================================================
//  src/entity/PhysicsComponent.js — Matter.js Physics Component
//
//  Unified "pinned" lock (supersedes the old `anchored` + `fixed`):
//    pinned = true  → body is static, velocity is zeroed every tick,
//                     applyImpulse/applyForce become no-ops.
//  Legacy saves/scripts that used `anchored` or `fixed` still work:
//  either sets `pinned = true` and the `anchored`/`fixed` accessors
//  forward to `pinned` on read.
// ============================================================

export class PhysicsComponent {
  constructor (cfg = {}) {
    this._entity     = null;
    this.body        = null;
    this._world      = null;

    this.vx          = cfg.vx          !== undefined ? cfg.vx          : 0;
    this.vy          = cfg.vy          !== undefined ? cfg.vy          : 0;
    this.restitution = cfg.restitution !== undefined ? cfg.restitution : 0.8;
    this.friction    = cfg.friction    !== undefined ? cfg.friction    : 0.1;
    // Matter's default air drag is 0.01; 0.001 lets bodies accelerate naturally
    // under gravity while still damping wild spins.
    this.frictionAir = cfg.frictionAir !== undefined ? cfg.frictionAir : 0.001;
    this.density     = cfg.density     !== undefined ? cfg.density     : 0.001;

    /**
     * Per-entity gravity.
     *   enabled — false ignores BOTH world gravity and `force` (body.gravityScale = 0)
     *   force   — extra downward force applied per step (px/s², stacks on top of world)
     *
     * Legacy scenes wrote `cfg.gravity` as a plain number; we accept that here too.
     */
    this.gravity     = normaliseGravity(cfg.gravity);

    // Pinned = lock in place. Collapses the old `anchored` + `fixed` fields.
    // Either legacy flag being truthy pins the body.
    this.pinned    = !!(cfg.pinned || cfg.anchored || cfg.fixed);

    /** Set false to pause physics for this body without removing the component. */
    this.enabled = true;
  }

  // ── Legacy aliases ────────────────────────────────────────
  // Older scripts/saves use `.anchored` / `.fixed`. Both now forward to `pinned`.
  get anchored () { return this.pinned; }
  set anchored (v) { this.pinned = !!v; }
  get fixed () { return this.pinned; }
  set fixed (v) { this.pinned = !!v; }

  onAttach (entity) {
    this._entity = entity;
  }

  initBody (world, sprite) {
    if (!world || !sprite || typeof Matter === 'undefined') return;

    this._world = world;
    const x = sprite.x;
    const y = sprite.y;
    const opts = {
      restitution: this.restitution,
      friction:    this.friction,
      frictionAir: this.frictionAir,
      density:     this.density,
      isStatic:    this.pinned,
      angle:       sprite.rotation,
      label:       'entity-body',
    };

    switch (sprite.shape) {
      case 'rect':
      case 'square':
      case 'rsquare':
        this.body = Matter.Bodies.rectangle(x, y, sprite.w, sprite.h, opts);
        break;
      case 'diamond':
        this.body = Matter.Bodies.rectangle(x, y, sprite.r * 2, sprite.r * 2, opts);
        Matter.Body.rotate(this.body, Math.PI / 4);
        break;
      case 'star':
      case 'rstar':
        this.body = Matter.Bodies.polygon(x, y, 5, sprite.r, opts);
        break;
      default:
        this.body = Matter.Bodies.circle(x, y, sprite.r, opts);
    }

    // Back-reference so collision-event listeners can look the entity up.
    this.body.plugin = Object.assign(this.body.plugin || {}, { entity: this._entity });

    // Honour per-entity gravity.enabled from the start so a freshly-loaded
    // entity with gravity disabled doesn't spend one tick being yanked by
    // world gravity before update() corrects it.
    this.body.gravityScale = this.gravity && this.gravity.enabled !== false ? 1 : 0;

    Matter.World.add(world, this.body);
    Matter.Body.setVelocity(this.body, { x: this.vx, y: this.vy });
  }

  update (dt) {
    if (!this.body || !this._entity || !this.enabled) return;

    const sprite = this._entity.getComponent('sprite');
    if (!sprite) return;

    // Coerce legacy numeric gravity (set via `ph.gravity = 5` by older scripts)
    // back into the object form so the rest of this method is uniform.
    if (typeof this.gravity !== 'object' || this.gravity === null) {
      this.gravity = normaliseGravity(this.gravity);
    }

    // Sync `pinned` ↔ Matter's isStatic, and zero any motion if pinned.
    if (this.body.isStatic !== !!this.pinned) {
      Matter.Body.setStatic(this.body, !!this.pinned);
    }
    if (this.pinned) {
      Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(this.body, 0);
    }

    // Sync per-entity gravity.enabled ↔ body.gravityScale so toggling it also
    // makes the body ignore world gravity.
    const desiredScale = this.gravity.enabled !== false ? 1 : 0;
    if (this.body.gravityScale !== desiredScale) {
      this.body.gravityScale = desiredScale;
    }

    // Physics is authoritative — write body state back to sprite
    sprite.x        = this.body.position.x;
    sprite.y        = this.body.position.y;
    sprite.rotation = this.body.angle;

    // Pinned bodies get their motion quashed every frame so scripts that
    // accidentally mutated velocity can't drift them off-position.
    if (this.pinned) {
      Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(this.body, 0);
      return;
    }

    if (
      this.gravity.enabled !== false &&
      this.gravity.force   !== 0
    ) {
      // Mirror Matter's own world-gravity model so `force` behaves as a true
      // acceleration (px/s² at gravity.scale = 0.001). Per Matter.Engine, each
      // step does: body.force.y += mass * gravity.y * gravity.scale, which the
      // solver then integrates into velocity — producing real acceleration
      // (more airtime → more speed) rather than a constant nudge per frame.
      const scale = (this._world && this._world.gravity && this._world.gravity.scale) || 0.001;
      Matter.Body.applyForce(this.body, this.body.position, {
        x: 0,
        y: this.gravity.force * this.body.mass * scale,
      });
    }
  }

  // ── Motion helpers ─────────────────────────────────────────

  applyImpulse (fx, fy) {
    if (this.pinned || !this.body) return;
    Matter.Body.setVelocity(this.body, {
      x: this.body.velocity.x + fx,
      y: this.body.velocity.y + fy,
    });
  }

  applyForce (fx, fy, dt) {
    if (this.pinned || !this.body) return;
    Matter.Body.applyForce(this.body, this.body.position, {
      x: fx * dt,
      y: fy * dt,
    });
  }

  /**
   * Set a continuous spin speed.
   * Call once from onStart, or every frame to keep a constant spin.
   * @param {number} radsPerSec  e.g. 2 = one full turn in ~3 seconds
   */
  setRotationSpeed (radsPerSec) {
    if (!this.body) return;
    // Matter steps at ~60fps; convert rad/s to rad/step
    Matter.Body.setAngularVelocity(this.body, radsPerSec / 60);
  }

  /**
   * Spin at a given angular speed — use inside onUpdate.
   * Matter steps at ~60 Hz, so angular-velocity is rad/step. We divide by 60
   * to turn the user's rad/sec value into the right per-step quantity.
   *
   * @param {number} radsPerSec  desired spin speed in radians/second
   * @param {number} [_dt]       accepted for API compatibility; not used
   */
  rotate (radsPerSec, _dt) {
    if (!this.body) return;
    Matter.Body.setAngularVelocity(this.body, radsPerSec / 60);
  }

  speed () {
    if (!this.body) return 0;
    return Math.hypot(this.body.velocity.x, this.body.velocity.y);
  }

  direction () {
    if (!this.body) return 0;
    return Math.atan2(this.body.velocity.y, this.body.velocity.x);
  }

  onDetach () {
    if (this._world && this.body) {
      Matter.World.remove(this._world, this.body);
      this.body = null;
    }
  }

  toJSON () {
    return {
      restitution: this.restitution,
      friction:    this.friction,
      frictionAir: this.frictionAir,
      density:     this.density,
      gravity:     { enabled: this.gravity.enabled !== false, force: this.gravity.force || 0 },
      pinned:      this.pinned,
    };
  }
}

/**
 * Coerce `cfg.gravity` into the canonical `{enabled, force}` form.
 * Accepts:
 *   undefined / null            → { enabled: true,  force: 0 }
 *   number (legacy save format) → { enabled: true,  force: n }
 *   { enabled?, force? } object → normalised with sensible defaults
 */
function normaliseGravity (raw) {
  if (raw === null || raw === undefined) {
    return { enabled: true, force: 0 };
  }
  if (typeof raw === 'number') {
    return { enabled: true, force: Number.isFinite(raw) ? raw : 0 };
  }
  if (typeof raw === 'object') {
    const force   = Number.isFinite(raw.force) ? raw.force : 0;
    const enabled = raw.enabled !== false;
    return { enabled, force };
  }
  return { enabled: true, force: 0 };
}
