// ============================================================
//  src/entity/SpriteComponent.js — PixiJS Visual Component
//  Renders shapes: circle, square, rsquare (rounded square),
//  star, rstar (rounded star). `rect`/`diamond` kept for legacy.
// ============================================================

export class SpriteComponent {
  constructor (cfg = {}) {
    this._entity  = null;
    this.x        = cfg.x     || 100;
    this.y        = cfg.y     || 100;
    this.rotation = cfg.rotation || 0;
    this.color    = cfg.color || 0xffffff;
    this.shape    = cfg.shape || 'circle';
    this.r        = cfg.r     || 16;
    this.w        = cfg.w     || 32;
    this.h        = cfg.h     || 32;
    this.alpha    = cfg.alpha !== undefined ? cfg.alpha : 1;
    this.scaleX   = cfg.scaleX !== undefined ? cfg.scaleX : 1;
    this.scaleY   = cfg.scaleY !== undefined ? cfg.scaleY : 1;

    this._gfx    = null;
    this._stage  = null;
  }

  attach (stage) {
    this._stage = stage;
    this._gfx   = new PIXI.Graphics();
    this._draw();
    stage.addChild(this._gfx);
  }

  detach (stage) {
    if (this._gfx) {
      stage.removeChild(this._gfx);
      this._gfx.destroy();
      this._gfx = null;
    }
  }

  _drawShape (g) {
    switch (this.shape) {
      case 'square':
        g.drawRect(-this.w / 2, -this.h / 2, this.w, this.h);
        break;

      case 'rect':      // legacy alias for rounded square
      case 'rsquare':
        g.drawRoundedRect(-this.w / 2, -this.h / 2, this.w, this.h, Math.min(this.w, this.h) * 0.25);
        break;

      case 'diamond': {
        const r = this.r;
        g.drawPolygon([ 0, -r,  r, 0,  0, r,  -r, 0 ]);
        break;
      }

      case 'star':
      case 'rstar': {
        this._drawStar(g, this.shape === 'rstar');
        break;
      }

      default: // circle
        g.drawCircle(0, 0, this.r);
    }
  }

  /**
   * 5-pointed star.
   * sharp = classic polygon; rounded = same points, softened with
   * quadratic curves so edges arc slightly outward (inner vertices are
   * pushed out) and tips are blunted.
   */
  _drawStar (g, rounded) {
    const pts   = 5;
    const outer = this.r;
    const inner = this.r * (rounded ? 0.6 : 0.45);
    const verts = [];
    for (let i = 0; i < pts * 2; i++) {
      const rad  = (i * Math.PI) / pts - Math.PI / 2;
      const dist = i % 2 === 0 ? outer : inner;
      verts.push(Math.cos(rad) * dist, Math.sin(rad) * dist);
    }
    if (!rounded) {
      g.drawPolygon(verts);
      return;
    }
    // Rounded star: draw with quadraticCurveTo through every other vertex
    // for a softer silhouette. Pixi's quadraticCurveTo takes a single
    // control point, so we alternate vertex → control → vertex.
    g.moveTo(verts[0], verts[1]);
    for (let i = 0; i < pts * 2; i++) {
      const cx = verts[i * 2];
      const cy = verts[i * 2 + 1];
      const nx = verts[((i + 1) % (pts * 2)) * 2];
      const ny = verts[((i + 1) % (pts * 2)) * 2 + 1];
      g.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
    }
    g.closePath();
  }

  _draw () {
    const g = this._gfx;
    if (!g) return;
    g.clear();
    g.beginFill(this.color, this.alpha);
    this._drawShape(g);
    g.endFill();
    // Outline glow
    g.lineStyle(1.5, 0xffffff, 0.25);
    this._drawShape(g);
  }

  update (dt) {
    this.syncGraphics();
  }

  /**
   * Push x/y/rotation straight to the PIXI Graphics object.
   * Safe to call when the engine loop isn't running — the PIXI ticker
   * still renders, so editor edits appear immediately.
   */
  syncGraphics () {
    if (!this._gfx) return;
    this._gfx.x        = this.x;
    this._gfx.y        = this.y;
    this._gfx.rotation = this.rotation;
    this._gfx.scale.set(this.scaleX, this.scaleY);
  }

  /** Axis-aligned half-extent in local (pre-rotation) space. Used by the
   *  selection gizmo to place scale handles at the sprite's bounding box. */
  halfExtents () {
    const isRect = this.shape === 'rect' || this.shape === 'square' || this.shape === 'rsquare';
    const hx = (isRect ? this.w / 2 : this.r) * this.scaleX;
    const hy = (isRect ? this.h / 2 : this.r) * this.scaleY;
    return { hx, hy };
  }

  setColor (color) {
    this.color = color;
    this._draw();
  }

  setAlpha (a) {
    this.alpha = a;
    if (this._gfx) this._gfx.alpha = a;
  }

  /** Pulse the alpha briefly (e.g. on hit) */
  flash (duration = 0.15) {
    if (!this._gfx) return;
    this._gfx.alpha = 0.3;
    setTimeout(() => { if (this._gfx) this._gfx.alpha = this.alpha; }, duration * 1000);
  }

  onAttach () {}
  onDetach () {}

  toJSON () {
    return {
      x: this.x,
      y: this.y,
      rotation: this.rotation,
      alpha: this.alpha,
      color: this.color,
      shape: this.shape,
      r: this.r,
      w: this.w,
      h: this.h,
      scaleX: this.scaleX,
      scaleY: this.scaleY,
    };
  }
}
