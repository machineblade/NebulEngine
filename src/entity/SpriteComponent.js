// ============================================================
//  src/entity/SpriteComponent.js — PixiJS Visual Component
//  Renders shapes (circle, rect, diamond, star) as Pixi Graphics
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

  _draw () {
    const g = this._gfx;
    if (!g) return;
    g.clear();
    g.beginFill(this.color, this.alpha);

    switch (this.shape) {
      case 'rect':
        g.drawRoundedRect(-this.w / 2, -this.h / 2, this.w, this.h, 3);
        break;

      case 'diamond': {
        const r = this.r;
        g.drawPolygon([ 0, -r,  r, 0,  0, r,  -r, 0 ]);
        break;
      }

      case 'star': {
        const pts = 5;
        const outer = this.r;
        const inner = this.r * 0.45;
        const verts = [];
        for (let i = 0; i < pts * 2; i++) {
          const rad   = (i * Math.PI) / pts - Math.PI / 2;
          const dist  = i % 2 === 0 ? outer : inner;
          verts.push(Math.cos(rad) * dist, Math.sin(rad) * dist);
        }
        g.drawPolygon(verts);
        break;
      }

      default: // circle
        g.drawCircle(0, 0, this.r);
    }

    // Outline glow
    g.endFill();
    g.lineStyle(1.5, 0xffffff, 0.25);
    switch (this.shape) {
      case 'rect': g.drawRoundedRect(-this.w / 2, -this.h / 2, this.w, this.h, 3); break;
      case 'diamond': { const r = this.r; g.drawPolygon([0,-r, r,0, 0,r, -r,0]); break; }
      default: g.drawCircle(0, 0, this.r);
    }
  }

  update (dt) {
    if (!this._gfx) return;
    this._gfx.x        = this.x;
    this._gfx.y        = this.y;
    this._gfx.rotation = this.rotation;
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
    };
  }
}