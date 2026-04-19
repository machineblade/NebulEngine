// ============================================================
//  src/core/Engine.js — NebulEngine Core
// ============================================================

import { EventBus }         from './EventBus.js';
import { SceneManager }     from '../scene/SceneManager.js';
import { AudioManager }     from '../audio/AudioManager.js';
import { InputManager }     from '../input/InputManager.js';
import { UIBridge }         from '../ui/UIBridge.js';
import { Logger }           from '../utils/Logger.js';
import { MathUtils }        from '../utils/MathUtils.js';
import { Entity, resetEntityIds } from '../entity/Entity.js';
import { SpriteComponent }  from '../entity/SpriteComponent.js';
import { PhysicsComponent } from '../entity/PhysicsComponent.js';
import { ScriptComponent }  from '../entity/ScriptComponent.js';

class Engine {
  constructor () {
    this.version    = '1.3.0';
    this.running    = false;
    this.paused     = false;
    this.elapsed    = 0;
    this.lastTime   = 0;
    this._rafId     = null;
    this._selectedEntityId = null;
    this._localSpace = false;
    this._gizmo      = null;

    // Viewport transform (applied to the PIXI stage for pan/zoom)
    this._view      = { x: 0, y: 0, scale: 1 };
    this._panning   = false;
    this._panStart  = { mx: 0, my: 0, vx: 0, vy: 0 };
    this._gridSize  = 20;
    this._gridVisible = false;
    this._snapSize  = 20;   // 0 = off (Shift still snaps ad-hoc)
    this._gridGfx   = null;

    // Active transform tool: 'move' | 'rotate' | 'scale'. Drives which
    // selection-gizmo handles are shown and interactive.
    this._activeTool = 'move';

    // Undo / redo history.
    this._history      = [];
    this._historyIndex = -1;
    this._historyCap   = 50;

    // "Body drag" — click-and-hold anywhere on an entity to free-drag it
    // along both axes without needing the gizmo arrows.
    this._bodyDrag = null;

    // core systems
    this.events  = new EventBus();
    this.logger  = new Logger(this.events);
    this.audio   = new AudioManager(this.events, this.logger);
    this.input   = new InputManager(this.events);
    this.scene   = new SceneManager(this.events, this.logger);
    this.ui      = new UIBridge(this, this.events, this.logger);

    // World proxy exposed to scripts as `this.world`. Scripts can read or
    // write `this.world.settings.gravity.strength` to change vertical world
    // gravity at runtime (1 ≈ Earth, 0 = zero-G, negative = up).
    const engine = this;
    this._scriptWorld = {
      settings: {
        gravity: {
          get strength () { return engine.scene.getGravityY(); },
          set strength (v) {
            const n = Number.isFinite(+v) ? +v : 0;
            engine.scene.setGravityY(n);
          },
        },
      },
    };

    // fps tracking
    this._fpsSamples  = [];
    this._fpsEl       = document.getElementById('fps-value');
    this._lastFpsTick = 0;

    this._initPixi();
    this._createGrid();
    this._createSelectionGizmo();
    this._bindEditorButtons();
    this._bindToolButtons();
    this._bindCanvasEvents();
    this._bindEditorShortcuts();
    this._spawnDemoScene();

    this.logger.info('NebulEngine v' + this.version + ' initialized');
  }

  // ── Viewport Transform ────────────────────────────────────
  _applyView () {
    this.stage.position.set(this._view.x, this._view.y);
    this.stage.scale.set(this._view.scale, this._view.scale);
  }

  _resetView () {
    this._view = { x: 0, y: 0, scale: 1 };
    this._applyView();
  }

  /** Convert a screen-space canvas point into stage (world) space. */
  _screenToStage (sx, sy) {
    return {
      x: (sx - this._view.x) / this._view.scale,
      y: (sy - this._view.y) / this._view.scale,
    };
  }

  /** Snap a value to the given grid size, or the configured default. */
  _snap (v, active, size) {
    if (!active) return v;
    const step = size ?? this._gridSize;
    if (!step) return v;
    return Math.round(v / step) * step;
  }

  /** True when a drag should snap to the grid. Either the snap dropdown
   *  is active, or the user is holding Shift. Returns the step to use,
   *  or 0 if no snapping. */
  _snapStep (event) {
    if (this._snapSize > 0) return this._snapSize;
    if (event?.shiftKey)    return this._gridSize;
    return 0;
  }

  // ── PixiJS Setup ──────────────────────────────────────────
  _initPixi () {
    const wrapper = document.getElementById('canvas-wrapper');
    const W = wrapper.clientWidth  || 800;
    const H = wrapper.clientHeight || 500;

    this.app = new PIXI.Application({
      width:           W,
      height:          H,
      backgroundColor: this._readThemeColor('--canvas-bg', 0x080c10),
      antialias:       true,
      resolution:      window.devicePixelRatio || 1,
      autoDensity:     true,
      view:            document.getElementById('game-canvas'),
    });

    this.stage = this.app.stage;
    this.stage.interactive = true;

    this.scene.init(this.stage, W, H);

    window.addEventListener('resize', () => this._onResize());
    this._onResize();

    this.logger.success('PixiJS renderer started (' + W + 'x' + H + ')');
  }

  /**
   * Parse a CSS custom property (e.g. `--canvas-bg: #080c10`) into a 24-bit
   * integer Pixi understands. Falls back to `defaultHex` if the variable is
   * missing or malformed. Supports `#rgb` and `#rrggbb`.
   */
  _readThemeColor (varName, defaultHex) {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(varName).trim();
    if (!raw) return defaultHex;
    let hex = raw.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length !== 6) return defaultHex;
    const n = parseInt(hex, 16);
    return Number.isFinite(n) ? n : defaultHex;
  }

  /**
   * Pull theme-dependent Pixi colors out of CSS variables and apply them to
   * the renderer + grid. Called on boot and whenever the theme switches.
   */
  _applyThemeColors () {
    const bg = this._readThemeColor('--canvas-bg', 0x080c10);
    if (this.app?.renderer?.background) {
      // Pixi v7 exposes .background.color
      this.app.renderer.background.color = bg;
    }
    this._drawGrid();
  }

  _onResize () {
    const wrapper = document.getElementById('canvas-wrapper');
    const W = wrapper.clientWidth;
    const H = wrapper.clientHeight;
    if (this.app) {
      this.app.renderer.resize(W, H);
      this.scene.onResize(W, H);
    }
  }

  // ── Editor Button Bindings ────────────────────────────────
  _bindEditorButtons () {
    document.getElementById('btn-play') .addEventListener('click', () => this.play());
    document.getElementById('btn-pause').addEventListener('click', () => this.togglePause());
    document.getElementById('btn-stop') .addEventListener('click', () => this.stop());
    document.getElementById('btn-mute') .addEventListener('click', () => this._toggleAudio());

    // Save / Load scene JSON — now surfaced through the hamburger menu,
    // but the ids are preserved so external handlers keep working.
    document.getElementById('btn-save-scene')?.addEventListener('click', () => this._saveScene());
    document.getElementById('btn-load-scene')?.addEventListener('click', () => this._loadScene());

    // Hamburger: toggle open/close; click-outside closes.
    const burger = document.getElementById('btn-hamburger');
    const menu   = document.getElementById('hamburger-menu');
    if (burger && menu) {
      const setOpen = (open) => {
        burger.classList.toggle('open', open);
        menu   .classList.toggle('open', open);
        burger.setAttribute('aria-expanded', String(open));
        menu  .setAttribute('aria-hidden',   String(!open));
      };
      burger.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(!menu.classList.contains('open'));
      });
      document.addEventListener('click', (e) => {
        if (!menu.classList.contains('open')) return;
        if (menu.contains(e.target) || burger.contains(e.target)) return;
        setOpen(false);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && menu.classList.contains('open')) setOpen(false);
      });
    }

  }

  // ── Tool / Grid Toolbar ──────────────────────────────────
  _bindToolButtons () {
    document.querySelectorAll('.tb-tool').forEach(btn => {
      btn.addEventListener('click', () => this.setActiveTool(btn.dataset.tool));
    });

    const gridBtn = document.getElementById('btn-grid-toggle');
    gridBtn?.addEventListener('click', () => this.toggleGrid());

    const snapSel = document.getElementById('sel-grid-snap');
    if (snapSel) {
      this._snapSize = parseInt(snapSel.value, 10) || 0;
      snapSel.addEventListener('change', () => {
        this._snapSize = parseInt(snapSel.value, 10) || 0;
        this._drawGrid();                          // keep grid in sync with snap
        this.logger.info('Snap: ' + (this._snapSize ? this._snapSize + ' px' : 'off'));
      });
    }

    // Theme selector — Default / Dark / Light. Persisted to localStorage and
    // applied to the document element; Pixi canvas bg + grid colors resync.
    const themeSel = document.getElementById('sel-theme');
    if (themeSel) {
      const saved = (() => {
        try { return localStorage.getItem('nebulengine.theme') || 'default'; }
        catch (_) { return 'default'; }
      })();
      themeSel.value = ['default', 'dark', 'light'].includes(saved) ? saved : 'default';
      document.documentElement.setAttribute('data-theme', themeSel.value);
      this._applyThemeColors();

      themeSel.addEventListener('change', () => {
        const t = themeSel.value;
        document.documentElement.setAttribute('data-theme', t);
        try { localStorage.setItem('nebulengine.theme', t); } catch (_) {}
        this._applyThemeColors();
        this.logger.info('Theme: ' + t);
      });
    }
  }

  setActiveTool (tool) {
    if (!['move', 'rotate', 'scale'].includes(tool)) return;
    this._activeTool = tool;
    document.querySelectorAll('.tb-tool').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    this._updateSelectionGizmo();
    this.logger.info('Tool: ' + tool);
  }

  toggleGrid () {
    this._gridVisible = !this._gridVisible;
    if (this._gridGfx) this._gridGfx.visible = this._gridVisible;
    const btn = document.getElementById('btn-grid-toggle');
    btn?.classList.toggle('active', this._gridVisible);
    this._drawGrid();
    this.logger.info('Grid: ' + (this._gridVisible ? 'on' : 'off'));
  }

  _createGrid () {
    this._gridGfx = new PIXI.Graphics();
    this._gridGfx.zIndex = -1;
    this._gridGfx.visible = this._gridVisible;
    // Behind every entity — placed at the bottom of the stage.
    this.stage.addChildAt(this._gridGfx, 0);
    this._drawGrid();
  }

  _drawGrid () {
    const g = this._gridGfx;
    if (!g) return;
    g.clear();
    if (!this._gridVisible) return;
    const step = this._snapSize > 0 ? this._snapSize : this._gridSize;
    const W = this.app.renderer.width  / (window.devicePixelRatio || 1);
    const H = this.app.renderer.height / (window.devicePixelRatio || 1);
    // Span 2x the viewport so panning still shows grid.
    const span = Math.max(W, H) * 2;
    const lineColor = this._readThemeColor('--grid-line', 0x1e2d3d);
    const axisColor = this._readThemeColor('--grid-axis', 0x2e4d6d);
    g.lineStyle(1, lineColor, 0.9);
    for (let x = -span; x <= span; x += step) {
      g.moveTo(x, -span); g.lineTo(x, span);
    }
    for (let y = -span; y <= span; y += step) {
      g.moveTo(-span, y); g.lineTo(span, y);
    }
    // Highlight the origin axes.
    g.lineStyle(1, axisColor, 1);
    g.moveTo(0, -span); g.lineTo(0, span);
    g.moveTo(-span, 0); g.lineTo(span, 0);
  }

  _bindCanvasEvents () {
    const canvas = this.app.view;
    canvas.style.cursor = 'pointer';

    canvas.addEventListener('pointerdown', (event) => {
      if (this._draggingGizmo) return;
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;

      // Middle mouse button: pan the viewport.
      if (event.button === 1) {
        this._panning = true;
        this._panStart = { mx: event.clientX, my: event.clientY, vx: this._view.x, vy: this._view.y };
        canvas.style.cursor = 'grabbing';
        event.preventDefault();
        return;
      }

      const world  = this._screenToStage(sx, sy);
      const entity = this.scene.hitTest(world.x, world.y);
      if (entity) {
        this.setSelectedEntity(entity.id);
        // Start a body-drag: hold left mouse on the entity and move to drag
        // in X+Y at once. A small dead-zone avoids promoting a plain click
        // into a drag. The original x/y is kept so STOP-time revert and
        // undo can restore it.
        if (event.button === 0) {
          const spr = entity.getComponent('sprite');
          if (spr) {
            this._bodyDrag = {
              id:       entity.id,
              startSx:  event.clientX,
              startSy:  event.clientY,
              startX:   spr.x,
              startY:   spr.y,
              moved:    false,
            };
          }
        }
      } else {
        this.setSelectedEntity(null);
      }
    });

    window.addEventListener('pointermove', (event) => {
      if (this._panning) {
        this._view.x = this._panStart.vx + (event.clientX - this._panStart.mx);
        this._view.y = this._panStart.vy + (event.clientY - this._panStart.my);
        this._applyView();
        return;
      }
      if (this._bodyDrag) this._onBodyDrag(event);
    });
    window.addEventListener('pointerup', () => {
      if (this._panning) {
        this._panning = false;
        canvas.style.cursor = 'pointer';
      }
      if (this._bodyDrag) this._endBodyDrag();
    });

    // Wheel zoom, centered on the mouse position so content stays put.
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const before = this._screenToStage(sx, sy);
      const factor = Math.exp(-event.deltaY * 0.0015);
      this._view.scale = Math.max(0.2, Math.min(4, this._view.scale * factor));
      // Keep the point under the cursor fixed.
      this._view.x = sx - before.x * this._view.scale;
      this._view.y = sy - before.y * this._view.scale;
      this._applyView();
    }, { passive: false });
  }

  _bindEditorShortcuts () {
    window.addEventListener('keydown', (event) => {
      // Don't intercept keys while the user is typing in a script editor etc.
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return;

      if (event.altKey && event.code === 'KeyL') {
        this._localSpace = !this._localSpace;
        this.events.emit('editor:spaceModeChanged', { local: this._localSpace });
        this.logger.info('Space mode: ' + (this._localSpace ? 'Local' : 'Global'));
        event.preventDefault();
        return;
      }

      // Space — play / pause toggle.
      if (event.code === 'Space') {
        event.preventDefault();
        if (!this.running) this.play();
        else               this.togglePause();
        return;
      }

      // Delete / Backspace — remove selected entity.
      if (event.code === 'Delete' || event.code === 'Backspace') {
        if (this._selectedEntityId != null) {
          event.preventDefault();
          this._removeSelected();
        }
        return;
      }

      // Ctrl/Cmd+D — duplicate selected entity.
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyD') {
        event.preventDefault();
        this._duplicateSelected();
        return;
      }

      // Ctrl/Cmd+Z — undo,  Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y — redo.
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else                this.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') {
        event.preventDefault();
        this.redo();
        return;
      }

      // Escape — deselect.
      if (event.code === 'Escape') {
        this.setSelectedEntity(null);
        return;
      }

      // 0 — reset viewport.
      if (event.code === 'Digit0' || event.code === 'Numpad0') {
        this._resetView();
        this.logger.info('Viewport reset');
        return;
      }

      // Q / W / E — transform tool. G — toggle grid.
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.code === 'KeyQ') { event.preventDefault(); this.setActiveTool('move');   return; }
        if (event.code === 'KeyW') { event.preventDefault(); this.setActiveTool('rotate'); return; }
        if (event.code === 'KeyE') { event.preventDefault(); this.setActiveTool('scale');  return; }
        if (event.code === 'KeyG') { event.preventDefault(); this.toggleGrid();            return; }
      }
    });
  }

  // ── Selection Gizmo ───────────────────────────────────────
  _createSelectionGizmo () {
    this._gizmo = new PIXI.Container();
    this._draggingGizmo   = false;
    this._dragAxis        = null;
    this._dragStartPos    = { x: 0, y: 0 };
    this._dragEntityStart = { x: 0, y: 0 };

    const arrowX = new PIXI.Graphics();
    arrowX.lineStyle(6, 0x00aaff);
    arrowX.moveTo(0, 0); arrowX.lineTo(60, 0);
    arrowX.moveTo(50, -8); arrowX.lineTo(60, 0); arrowX.lineTo(50, 8);
    arrowX.interactive = true; arrowX.cursor = 'pointer';
    arrowX.hitArea = new PIXI.Rectangle(-10, -15, 80, 30);
    arrowX.on('pointerdown',    (e) => this._startGizmoDrag('x', e));
    arrowX.on('pointerup',      ()  => this._stopGizmoDrag());
    arrowX.on('pointerupoutside', () => this._stopGizmoDrag());

    const arrowY = new PIXI.Graphics();
    arrowY.lineStyle(6, 0xff2b2b);
    arrowY.moveTo(0, 0); arrowY.lineTo(0, -60);
    arrowY.moveTo(-8, -50); arrowY.lineTo(0, -60); arrowY.lineTo(8, -50);
    arrowY.interactive = true; arrowY.cursor = 'pointer';
    arrowY.hitArea = new PIXI.Rectangle(-15, -70, 30, 80);
    arrowY.on('pointerdown',    (e) => this._startGizmoDrag('y', e));
    arrowY.on('pointerup',      ()  => this._stopGizmoDrag());
    arrowY.on('pointerupoutside', () => this._stopGizmoDrag());

    // Rotation handle — an orange ring sitting above the entity. Drag it
    // to rotate. Offset by the entity's bounding radius at render time.
    const rotHandle = new PIXI.Graphics();
    rotHandle.lineStyle(2, 0xff9c27, 1);
    rotHandle.beginFill(0x000000, 0.001);  // invisible fill so it's hittable
    rotHandle.drawCircle(0, -80, 8);
    rotHandle.endFill();
    rotHandle.lineStyle(2, 0xff9c27, 0.5);
    rotHandle.moveTo(0, 0); rotHandle.lineTo(0, -72);
    rotHandle.interactive = true; rotHandle.cursor = 'crosshair';
    rotHandle.hitArea = new PIXI.Circle(0, -80, 12);
    rotHandle.on('pointerdown',    (e) => this._startGizmoDrag('rot', e));
    rotHandle.on('pointerup',      ()  => this._stopGizmoDrag());
    rotHandle.on('pointerupoutside', () => this._stopGizmoDrag());

    // Scale handles — four small green squares at the sprite's bounding-box
    // corners. Dragging a corner scales the sprite uniformly based on the
    // distance from the sprite center vs. the corner's original distance.
    const makeScaleHandle = (sx, sy, id) => {
      const h = new PIXI.Graphics();
      h.lineStyle(2, 0x39ff85, 1);
      h.beginFill(0x0d1117, 1);
      h.drawRect(-5, -5, 10, 10);
      h.endFill();
      h.interactive = true; h.cursor = 'nwse-resize';
      h.hitArea = new PIXI.Rectangle(-8, -8, 16, 16);
      h._scaleSign = { sx, sy };
      h.on('pointerdown',    (e) => this._startGizmoDrag('scale:' + id, e));
      h.on('pointerup',      ()  => this._stopGizmoDrag());
      h.on('pointerupoutside', () => this._stopGizmoDrag());
      return h;
    };
    const scaleTL = makeScaleHandle(-1, -1, 'tl');
    const scaleTR = makeScaleHandle( 1, -1, 'tr');
    const scaleBL = makeScaleHandle(-1,  1, 'bl');
    const scaleBR = makeScaleHandle( 1,  1, 'br');

    this._gizmo.addChild(arrowX);
    this._gizmo.addChild(arrowY);
    this._gizmo.addChild(rotHandle);
    this._gizmo.addChild(scaleTL);
    this._gizmo.addChild(scaleTR);
    this._gizmo.addChild(scaleBL);
    this._gizmo.addChild(scaleBR);

    this._gizmoParts = {
      arrowX, arrowY, rotHandle,
      scale: { tl: scaleTL, tr: scaleTR, bl: scaleBL, br: scaleBR },
    };

    this._gizmo.visible = false;
    this._gizmo.zIndex  = 999;
    this.stage.addChild(this._gizmo);

    this.app.view.addEventListener('pointermove', (e) => this._onGizmoDrag(e));
  }

  /** Position the scale-handle squares at the selected sprite's corners and
   *  toggle visibility of arrows / rotation ring / corners based on the
   *  currently active tool. */
  _layoutGizmoHandles (sprite) {
    const parts = this._gizmoParts;
    if (!parts) return;
    const tool = this._activeTool;
    parts.arrowX.visible    = tool === 'move';
    parts.arrowY.visible    = tool === 'move';
    parts.rotHandle.visible = tool === 'rotate';

    const { hx, hy } = sprite.halfExtents();
    const corners = parts.scale;
    corners.tl.position.set(-hx, -hy); corners.tl.visible = tool === 'scale';
    corners.tr.position.set( hx, -hy); corners.tr.visible = tool === 'scale';
    corners.bl.position.set(-hx,  hy); corners.bl.visible = tool === 'scale';
    corners.br.position.set( hx,  hy); corners.br.visible = tool === 'scale';
  }

  setSelectedEntity (id) {
    if (this._selectedEntityId === id) return;
    this._selectedEntityId = id;
    this.events.emit('ui:entitySelected', id);
  }

  _updateSelectionGizmo () {
    if (!this._gizmo) return;
    const entity = this.scene.getEntity(this._selectedEntityId);
    if (!entity) { this._gizmo.visible = false; return; }
    const sprite = entity.getComponent('sprite');
    if (!sprite) { this._gizmo.visible = false; return; }
    this._gizmo.visible = true;
    this._gizmo.position.set(sprite.x, sprite.y);
    // Scale handles follow the sprite rotation so they track the real
    // bounding box, even when "Global" space is active for arrows.
    const handlesFollow = this._activeTool === 'scale' || this._localSpace;
    this._gizmo.rotation = handlesFollow ? sprite.rotation : 0;
    this._layoutGizmoHandles(sprite);
  }

  _startGizmoDrag (axis, event) {
    // Clicking a gizmo handle also fires the canvas pointerdown (PIXI's
    // stopPropagation doesn't block the native DOM event), which would
    // otherwise initiate a body-drag in parallel and have both handlers
    // fight each other on pointermove. Cancel any pending body-drag.
    this._bodyDrag = null;
    this._draggingGizmo   = true;
    this._dragAxis        = axis;
    this._dragStartPos.x  = event.data.global.x;
    this._dragStartPos.y  = event.data.global.y;
    const entity = this.scene.getEntity(this._selectedEntityId);
    if (entity) {
      const sprite = entity.getComponent('sprite');
      if (sprite) {
        this._dragEntityStart.x   = sprite.x;
        this._dragEntityStart.y   = sprite.y;
        this._dragEntityStart.rot = sprite.rotation;
        this._dragEntityStart.sx  = sprite.scaleX;
        this._dragEntityStart.sy  = sprite.scaleY;
      }
    }
    event.stopPropagation();
  }

  _stopGizmoDrag () {
    if (!this._draggingGizmo) return;
    // Record a single undo entry per drag gesture
    const entity = this.scene.getEntity(this._selectedEntityId);
    const sprite = entity?.getComponent('sprite');
    if (entity && sprite) {
      if (this._dragAxis === 'rot') {
        if (sprite.rotation !== this._dragEntityStart.rot) {
          this._recordHistory({
            kind: 'transform',
            id:   entity.id,
            from: { rotation: this._dragEntityStart.rot },
            to:   { rotation: sprite.rotation },
          });
        }
      } else if (this._dragAxis?.startsWith('scale:')) {
        if (sprite.scaleX !== this._dragEntityStart.sx || sprite.scaleY !== this._dragEntityStart.sy) {
          this._recordHistory({
            kind: 'transform',
            id:   entity.id,
            from: { scaleX: this._dragEntityStart.sx, scaleY: this._dragEntityStart.sy },
            to:   { scaleX: sprite.scaleX,           scaleY: sprite.scaleY },
          });
        }
      } else if (sprite.x !== this._dragEntityStart.x || sprite.y !== this._dragEntityStart.y) {
        this._recordHistory({
          kind: 'transform',
          id:   entity.id,
          from: { x: this._dragEntityStart.x, y: this._dragEntityStart.y },
          to:   { x: sprite.x, y: sprite.y },
        });
      }
    }
    this._draggingGizmo = false;
    this._dragAxis      = null;
  }

  _onGizmoDrag (event) {
    if (!this._draggingGizmo || !this._dragAxis) return;
    const entity  = this.scene.getEntity(this._selectedEntityId);
    if (!entity) return;
    const sprite  = entity.getComponent('sprite');
    const physics = entity.getComponent('physics');
    if (!sprite) return;

    const scale    = this._view.scale || 1;
    const rect     = this.app.view.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    if (this._dragAxis === 'rot') {
      // Rotate the entity so the handle follows the cursor, in world space.
      const world = this._screenToStage(currentX, currentY);
      let ang = Math.atan2(world.y - sprite.y, world.x - sprite.x);
      // Handle offset: 0 rotation should have the handle straight up, so
      // translate cursor-angle (east-up) into sprite-angle (north-up).
      ang += Math.PI / 2;
      if (event.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);  // 15°
      sprite.rotation = ang;
      if (physics?.body) Matter.Body.setAngle(physics.body, ang);
      sprite.syncGraphics();
      this._gizmo.position.set(sprite.x, sprite.y);
      this._layoutGizmoHandles(sprite);
      this._gizmo.rotation = (this._activeTool === 'scale' || this._localSpace) ? sprite.rotation : 0;
      this.events.emit('ui:inspectorDirty', entity.id);
      return;
    }

    if (this._dragAxis?.startsWith('scale:')) {
      const corner = this._dragAxis.slice(6);                  // tl | tr | bl | br
      const sign = { tl: [-1,-1], tr: [ 1,-1], bl: [-1, 1], br: [ 1, 1] }[corner];
      // Cursor in stage space, translated into sprite-local (rotation-compensated).
      const world = this._screenToStage(currentX, currentY);
      const dx = world.x - sprite.x;
      const dy = world.y - sprite.y;
      const cos = Math.cos(sprite.rotation);
      const sin = Math.sin(sprite.rotation);
      const localX =  dx * cos + dy * sin;                     // inverse rotation
      const localY = -dx * sin + dy * cos;
      // Unscaled bounding half-extent per axis.
      const isRect = sprite.shape === 'rect' || sprite.shape === 'square' || sprite.shape === 'rsquare';
      const baseHx = isRect ? sprite.w / 2 : sprite.r;
      const baseHy = isRect ? sprite.h / 2 : sprite.r;
      let nx = (localX * sign[0]) / baseHx;
      let ny = (localY * sign[1]) / baseHy;
      // Uniform scale unless Shift is held (Shift = non-uniform).
      if (!event.shiftKey) {
        const uni = Math.max(Math.abs(nx), Math.abs(ny));
        nx = ny = uni;
      }
      sprite.scaleX = Math.max(0.05, Math.abs(nx));
      sprite.scaleY = Math.max(0.05, Math.abs(ny));
      sprite.syncGraphics();
      this._layoutGizmoHandles(sprite);
      this.events.emit('ui:inspectorDirty', entity.id);
      return;
    }

    // Translation — convert screen-space deltas to world-space through zoom.
    const deltaX = (currentX - this._dragStartPos.x) / scale;
    const deltaY = (currentY - this._dragStartPos.y) / scale;

    let newX = this._dragEntityStart.x;
    let newY = this._dragEntityStart.y;

    if (this._localSpace) {
      const cos = Math.cos(sprite.rotation);
      const sin = Math.sin(sprite.rotation);
      if (this._dragAxis === 'x') { newX += deltaX * cos - deltaY * sin; newY += deltaX * sin + deltaY * cos; }
      else                        { newX += -deltaY * sin; newY += deltaY * cos; }
    } else {
      if (this._dragAxis === 'x') newX += deltaX;
      else                        newY += deltaY;
    }

    // Snap to the configured snap size (dropdown); fall back to the default
    // grid size when Shift is held. Only snap the dragged axis in global
    // mode so a Y drag doesn't yank a non-grid X sideways.
    const step = this._snapStep(event);
    if (step > 0) {
      if (this._localSpace) {
        newX = this._snap(newX, true, step);
        newY = this._snap(newY, true, step);
      } else if (this._dragAxis === 'x') {
        newX = this._snap(newX, true, step);
      } else {
        newY = this._snap(newY, true, step);
      }
    }

    sprite.x = newX; sprite.y = newY;
    if (physics?.body) Matter.Body.setPosition(physics.body, { x: newX, y: newY });
    sprite.syncGraphics();
    this._gizmo.position.set(newX, newY);
    this.events.emit('ui:inspectorDirty', entity.id);
  }

  // ── Body drag (free X+Y hold-click) ───────────────────────
  _onBodyDrag (event) {
    // Belt-and-suspenders: if the gizmo picked up this gesture, bail out so
    // we don't stack a free-drag on top of an axis/rotation drag.
    if (this._draggingGizmo) { this._bodyDrag = null; return; }
    const drag   = this._bodyDrag;
    const entity = this.scene.getEntity(drag.id);
    if (!entity) { this._bodyDrag = null; return; }
    const sprite  = entity.getComponent('sprite');
    const physics = entity.getComponent('physics');
    if (!sprite) return;

    const scale = this._view.scale || 1;
    const dSx = event.clientX - drag.startSx;
    const dSy = event.clientY - drag.startSy;
    if (!drag.moved && Math.hypot(dSx, dSy) < 3) return;   // dead-zone
    drag.moved = true;

    let newX = drag.startX + dSx / scale;
    let newY = drag.startY + dSy / scale;
    const step = this._snapStep(event);
    if (step > 0) {
      newX = this._snap(newX, true, step);
      newY = this._snap(newY, true, step);
    }

    sprite.x = newX; sprite.y = newY;
    if (physics?.body) {
      Matter.Body.setPosition(physics.body, { x: newX, y: newY });
      // Stop the body so the drag doesn't fight the solver mid-play.
      Matter.Body.setVelocity(physics.body, { x: 0, y: 0 });
    }
    sprite.syncGraphics();
    if (this._gizmo) this._gizmo.position.set(newX, newY);
    this.events.emit('ui:inspectorDirty', entity.id);
  }

  _endBodyDrag () {
    const drag = this._bodyDrag;
    this._bodyDrag = null;
    if (!drag || !drag.moved) return;
    const entity = this.scene.getEntity(drag.id);
    const sprite = entity?.getComponent('sprite');
    if (!entity || !sprite) return;
    if (sprite.x !== drag.startX || sprite.y !== drag.startY) {
      this._recordHistory({
        kind: 'transform',
        id:   drag.id,
        from: { x: drag.startX, y: drag.startY },
        to:   { x: sprite.x,    y: sprite.y },
      });
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────
  play () {
    if (this.running && !this.paused) return;
    if (this.paused) { this.paused = false; this._updateEditorState(); return; }

    this.running  = true;
    this.paused   = false;
    this.elapsed  = 0;
    this.lastTime = performance.now();

    this._updateEditorState();
    this.events.emit('engine:play');
    this.audio.playAmbient();
    this.logger.success('Scene started');
    this._loop(this.lastTime);
  }

  togglePause () {
    if (!this.running) return;
    this.paused = !this.paused;
    this._updateEditorState();
    this.events.emit(this.paused ? 'engine:pause' : 'engine:resume');
    this.logger.info(this.paused ? 'Paused' : 'Resumed');
  }

  stop () {
    if (!this.running) return;
    this.running = false;
    this.paused  = false;
    cancelAnimationFrame(this._rafId);
    this.scene.reset();
    this.elapsed = 0;
    this._updateEditorState();
    this.events.emit('engine:stop');
    this.audio.stopAll();
    this.logger.info('Scene stopped');
  }

  // ── Main Loop ──────────────────────────────────────────────
  _loop (now) {
    this._rafId = requestAnimationFrame(t => this._loop(t));
    if (!this.running || this.paused) return;

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.elapsed += dt;

    // FPS display
    this._fpsSamples.push(dt);
    if (this._fpsSamples.length > 60) this._fpsSamples.shift();
    if (now - this._lastFpsTick > 200) {
      const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
      this._fpsEl.textContent = Math.round(1 / avg);
      this._lastFpsTick = now;
    }

    this.scene.update(dt, this.elapsed);
    this._updateSelectionGizmo();
    this.ui.updateStatus(this.scene.entityCount(), this.elapsed);
    // Snapshot at END of frame so isKeyJustDown / isKeyJustUp correctly
    // compare this frame's state against the *previous* frame's state.
    this.input.update();
  }

  // ── Scene Helpers ──────────────────────────────────────────
  _spawnDemoScene () {
    this.scene.clear();

    const configs = [
      { name: 'Player',   color: 0x00e5ff, x: 200, y: 200, shape: 'circle',  r: 20,        physics: { vx: 60,  vy: 40  }, tags: ['player','collider'] },
      { name: 'Enemy_01', color: 0xff3e6c, x: 500, y: 150, shape: 'square',  w: 30, h: 30, physics: { vx: -40, vy: 60  }, tags: ['enemy'] },
      { name: 'Gem_01',   color: 0xa259ff, x: 350, y: 300, shape: 'rsquare', w: 26, h: 26, physics: { vx: 80,  vy: -50 }, tags: ['pickup'] },
      { name: 'Platform', color: 0x39ff85, x: 400, y: 420, shape: 'rsquare', w: 160, h: 16, physics: { pinned: true },   tags: ['static'] },
      { name: 'Star_01',  color: 0xffd34e, x: 100, y: 350, shape: 'star',    r: 18,        physics: { vx: 50,  vy: 70  }, tags: ['pickup'] },
    ];

    for (const cfg of configs) this._createEntity(cfg);
    this.logger.info('Demo scene loaded (' + configs.length + ' entities)');
  }

  _createEntity (cfg) {
    const entity  = new Entity(cfg.name, cfg.tags || []);
    const sprite  = new SpriteComponent(cfg);
    const physics = new PhysicsComponent(cfg.physics || {});
    const script  = new ScriptComponent(this._defaultBehavior(cfg));

    // Inject logger + world proxy so script errors appear in the engine
    // console and scripts can read/write `this.world.settings.gravity.strength`.
    script._logger = this.logger;
    if (script._script && typeof script._script === 'object') {
      script._script.world = this._scriptWorld;
    }

    entity.addComponent('physics', physics);
    entity.addComponent('sprite',  sprite);
    entity.addComponent('script',  script);

    this.scene.addEntity(entity);
    sprite.attach(this.stage);
    return entity;
  }

  _defaultBehavior (cfg) {
    // Default script does nothing — physics drives motion
    return {};
  }

  /**
   * Spawn a new entity at a given position with one of the supported shapes.
   * Used by the hierarchy right-click menu.
   *   shape ∈ 'circle' | 'square' | 'rsquare' | 'star' | 'rstar'
   */
  spawnEntity (shape, opts = {}) {
    const colors = [0x00e5ff, 0xff3e6c, 0xa259ff, 0x39ff85, 0xffd34e, 0xff9c27];
    const bounds = this.scene.bounds();
    const cfg = {
      name:  opts.name  || ('Entity_' + Math.floor(Math.random() * 9000 + 1000)),
      color: opts.color ?? colors[Math.floor(Math.random() * colors.length)],
      x:     opts.x     ?? MathUtils.randInt(60, bounds.w - 60),
      y:     opts.y     ?? MathUtils.randInt(60, bounds.h - 60),
      shape,
      r:     opts.r ?? 18,
      w:     opts.w ?? 32,
      h:     opts.h ?? 32,
      physics: opts.physics || {},
      tags:  opts.tags || ['spawned'],
    };
    const entity = this._createEntity(cfg);
    this.audio.playSfx('spawn');
    this.logger.info('Spawned: ' + entity.name + ' [' + shape + ']');
    this.setSelectedEntity(entity.id);
    return entity;
  }

  // ── Selection helpers ─────────────────────────────────────
  _removeSelected () {
    if (this._selectedEntityId == null) return;
    const entity = this.scene.getEntity(this._selectedEntityId);
    if (!entity) return;
    const name = entity.name;
    this.scene.removeEntity(this._selectedEntityId);
    this.logger.info('Removed: ' + name);
  }

  _duplicateSelected () {
    if (this._selectedEntityId == null) return;
    const src = this.scene.getEntity(this._selectedEntityId);
    if (!src) return;
    const spr = src.getComponent('sprite');
    const ph  = src.getComponent('physics');
    if (!spr) return;
    const cfg = {
      name:     src.name + '_copy',
      tags:     [...src.tags],
      color:    spr.color,
      shape:    spr.shape,
      x:        spr.x + 24,
      y:        spr.y + 24,
      rotation: spr.rotation,
      r:        spr.r,
      w:        spr.w,
      h:        spr.h,
      scaleX:   spr.scaleX,
      scaleY:   spr.scaleY,
      alpha:    spr.alpha,
      physics: ph ? {
        restitution: ph.restitution,
        friction:    ph.friction,
        frictionAir: ph.frictionAir,
        density:     ph.density,
        gravity:     ph.gravity && typeof ph.gravity === 'object'
          ? { enabled: ph.gravity.enabled !== false, force: ph.gravity.force || 0 }
          : { enabled: true, force: typeof ph.gravity === 'number' ? ph.gravity : 0 },
        pinned:      ph.pinned,
        vx:          ph.body?.velocity?.x ?? 0,
        vy:          ph.body?.velocity?.y ?? 0,
      } : {},
    };
    const dup = this._createEntity(cfg);
    this.audio.playSfx('spawn');
    this.setSelectedEntity(dup.id);
    this.logger.info('Duplicated: ' + dup.name);
  }

  // ── Undo / Redo ────────────────────────────────────────────
  _recordHistory (entry) {
    // Drop any "future" redo branch whenever a new action is recorded.
    if (this._historyIndex < this._history.length - 1) {
      this._history.length = this._historyIndex + 1;
    }
    this._history.push(entry);
    if (this._history.length > this._historyCap) {
      this._history.shift();
    } else {
      this._historyIndex = this._history.length - 1;
    }
  }

  _applyTransform (id, t) {
    const entity = this.scene.getEntity(id);
    if (!entity) return;
    const sprite  = entity.getComponent('sprite');
    const physics = entity.getComponent('physics');
    if (!sprite) return;
    if (t.x !== undefined) sprite.x = t.x;
    if (t.y !== undefined) sprite.y = t.y;
    if (t.rotation !== undefined) sprite.rotation = t.rotation;
    if (t.scaleX !== undefined) sprite.scaleX = t.scaleX;
    if (t.scaleY !== undefined) sprite.scaleY = t.scaleY;
    if (physics?.body) {
      if (t.x !== undefined || t.y !== undefined) {
        Matter.Body.setPosition(physics.body, { x: sprite.x, y: sprite.y });
        Matter.Body.setVelocity(physics.body, { x: 0, y: 0 });
      }
      if (t.rotation !== undefined) Matter.Body.setAngle(physics.body, sprite.rotation);
    }
    sprite.syncGraphics();
    this.events.emit('ui:inspectorDirty', id);
  }

  undo () {
    if (this._historyIndex < 0) { this.logger.info('Nothing to undo'); return; }
    const entry = this._history[this._historyIndex--];
    if (entry.kind === 'transform') this._applyTransform(entry.id, entry.from);
    this.logger.info('Undo: ' + entry.kind);
  }

  redo () {
    if (this._historyIndex >= this._history.length - 1) { this.logger.info('Nothing to redo'); return; }
    const entry = this._history[++this._historyIndex];
    if (entry.kind === 'transform') this._applyTransform(entry.id, entry.to);
    this.logger.info('Redo: ' + entry.kind);
  }

  _toggleAudio () {
    const muted = this.audio.toggleMute();
    const btn   = document.getElementById('btn-mute');
    if (btn) {
      const iconEl  = btn.querySelector('.hm-icon');
      const stateEl = btn.querySelector('.hm-state');
      if (iconEl)  iconEl .textContent = muted ? '🔇'    : '🔊';
      if (stateEl) stateEl.textContent = muted ? 'MUTED' : 'ON';
    }
    this.logger.info('Audio ' + (muted ? 'muted' : 'unmuted'));
  }

  // ── Save / Load Scene ──────────────────────────────────────
  _saveScene () {
    const data = this.scene.getAllEntities().map(e => e.toJSON());
    const blob  = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href = url; a.download = 'scene.json'; a.click();
    URL.revokeObjectURL(url);
    this.logger.success('Scene saved to scene.json');
  }

  _loadScene () {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const configs = JSON.parse(e.target.result);
          this.scene.clear();
          resetEntityIds();
          for (const cfg of configs) {
            this._createEntity({
              name:  cfg.name,
              tags:  cfg.tags || [],
              color: cfg.transform?.color ?? 0xffffff,
              x:     cfg.transform?.x     ?? 100,
              y:     cfg.transform?.y     ?? 100,
              shape: cfg.transform?.shape ?? 'circle',
              r:      cfg.transform?.r      ?? 16,
              w:      cfg.transform?.w      ?? 32,
              h:      cfg.transform?.h      ?? 32,
              scaleX: cfg.transform?.scaleX ?? 1,
              scaleY: cfg.transform?.scaleY ?? 1,
              alpha:  cfg.transform?.alpha  ?? 1,
              physics: cfg.physics || {},
            });
          }
          this.logger.success('Scene loaded: ' + configs.length + ' entities');
        } catch (err) {
          this.logger.error('Failed to load scene: ' + err.message);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // ── UI Sync ────────────────────────────────────────────────
  _updateEditorState () {
    const playing = this.running && !this.paused;
    const stopped = !this.running;

    document.getElementById('btn-play') .disabled = playing;
    document.getElementById('btn-pause').disabled = stopped;
    document.getElementById('btn-stop') .disabled = stopped;

    const state = stopped ? 'IDLE' : (this.paused ? 'PAUSED' : 'RUNNING');
    document.getElementById('status-state').textContent = state;
    document.getElementById('status-state').style.color =
      stopped ? 'var(--accent2)' : (this.paused ? 'var(--yellow)' : 'var(--green)');
  }
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
  window.NebulEngine = new Engine();
});