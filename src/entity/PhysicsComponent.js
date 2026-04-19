// ============================================================
//  src/entity/PhysicsComponent.js — Matter.js Physics Component
//
//  Changes from v1:
//  • enabled flag  — ph.enabled = false freezes this body
//  • setRotationSpeed(rad/s) — clean way to spin from scripts
//  • rotate(rad/s, dt) — shorthand usable in onUpdate
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
    this.frictionAir = cfg.frictionAir !== undefined ? cfg.frictionAir : 0.02;
    this.density     = cfg.density     !== undefined ? cfg.density     : 0.001;
    this.gravity     = cfg.gravity     || 0;
    this.fixed       = cfg.fixed       || false;

    /** Set false to pause physics for this body without removing the component. */
    this.enabled = true;
  }

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
      isStatic:    this.fixed,
      angle:       sprite.rotation,
      label:       'entity-body',
    };

    switch (sprite.shape) {
      case 'rect':
        this.body = Matter.Bodies.rectangle(x, y, sprite.w, sprite.h, opts);
        break;
      case 'diamond':
        this.body = Matter.Bodies.rectangle(x, y, sprite.r * 2, sprite.r * 2, opts);
        Matter.Body.rotate(this.body, Math.PI / 4);
        break;
      case 'star':
        this.body = Matter.Bodies.polygon(x, y, 5, sprite.r, opts);
        break;
      default:
        this.body = Matter.Bodies.circle(x, y, sprite.r, opts);
    }

    Matter.World.add(world, this.body);
    Matter.Body.setVelocity(this.body, { x: this.vx, y: this.vy });
  }

  update (dt) {
    if (!this.body || !this._entity || !this.enabled) return;

    const sprite = this._entity.getComponent('sprite');
    if (!sprite) return;

    // Physics is authoritative — write body state back to sprite
    sprite.x        = this.body.position.x;
    sprite.y        = this.body.position.y;
    sprite.rotation = this.body.angle;

    if (this.gravity !== 0 && !this.fixed) {
      Matter.Body.applyForce(this.body, this.body.position, {
        x: 0,
        y: this.gravity * this.body.mass * dt * 0.001,
      });
    }
  }

  // ── Motion helpers ─────────────────────────────────────────

  applyImpulse (fx, fy) {
    if (this.fixed || !this.body) return;
    Matter.Body.setVelocity(this.body, {
      x: this.body.velocity.x + fx,
      y: this.body.velocity.y + fy,
    });
  }

  applyForce (fx, fy, dt) {
    if (this.fixed || !this.body) return;
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
   * Spin by a delta each frame — use inside onUpdate.
   * This is the correct physics-aware replacement for spr.rotation += x * dt.
   * @param {number} radsPerSec
   * @param {number} dt  delta-time from onUpdate
   */
  rotate (radsPerSec, dt) {
    if (!this.body) return;
    Matter.Body.setAngularVelocity(this.body, radsPerSec * dt);
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
      gravity:     this.gravity,
      fixed:       this.fixed,
    };
  }
}