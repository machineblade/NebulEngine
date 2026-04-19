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
    this.version    = '1.0.0';
    this.running    = false;
    this.paused     = false;
    this.elapsed    = 0;
    this.lastTime   = 0;
    this._rafId     = null;
    this._selectedEntityId = null;
    this._localSpace = false;
    this._gizmo      = null;

    // core systems
    this.events  = new EventBus();
    this.logger  = new Logger(this.events);
    this.audio   = new AudioManager(this.events, this.logger);
    this.input   = new InputManager(this.events);
    this.scene   = new SceneManager(this.events, this.logger);
    this.ui      = new UIBridge(this, this.events, this.logger);

    // fps tracking
    this._fpsSamples  = [];
    this._fpsEl       = document.getElementById('fps-value');
    this._lastFpsTick = 0;

    this._initPixi();
    this._createSelectionGizmo();
    this._bindEditorButtons();
    this._bindCanvasEvents();
    this._bindEditorShortcuts();
    this._spawnDemoScene();

    this.logger.info('NebulEngine v' + this.version + ' initialized');
  }

  // ── PixiJS Setup ──────────────────────────────────────────
  _initPixi () {
    const wrapper = document.getElementById('canvas-wrapper');
    const W = wrapper.clientWidth  || 800;
    const H = wrapper.clientHeight || 500;

    this.app = new PIXI.Application({
      width:           W,
      height:          H,
      backgroundColor: 0x080c10,
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
    document.getElementById('btn-spawn').addEventListener('click', () => this._spawnRandom());
    document.getElementById('btn-clear').addEventListener('click', () => this._clearScene());
    document.getElementById('btn-mute') .addEventListener('click', () => this._toggleAudio());

    // Save / Load scene JSON
    document.getElementById('btn-save-scene')?.addEventListener('click', () => this._saveScene());
    document.getElementById('btn-load-scene')?.addEventListener('click', () => this._loadScene());
  }

  _bindCanvasEvents () {
    const canvas = this.app.view;
    canvas.style.cursor = 'pointer';

    canvas.addEventListener('pointerdown', (event) => {
      if (this._draggingGizmo) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const entity = this.scene.hitTest(x, y);
      if (entity) this.setSelectedEntity(entity.id);
    });
  }

  _bindEditorShortcuts () {
    window.addEventListener('keydown', (event) => {
      if (event.altKey && event.code === 'KeyL') {
        this._localSpace = !this._localSpace;
        this.events.emit('editor:spaceModeChanged', { local: this._localSpace });
        this.logger.info('Space mode: ' + (this._localSpace ? 'Local' : 'Global'));
        event.preventDefault();
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

    this._gizmo.addChild(arrowX);
    this._gizmo.addChild(arrowY);
    this._gizmo.visible = false;
    this._gizmo.zIndex  = 999;
    this.stage.addChild(this._gizmo);

    this.app.view.addEventListener('pointermove', (e) => this._onGizmoDrag(e));
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
    this._gizmo.rotation = this._localSpace ? sprite.rotation : 0;
  }

  _startGizmoDrag (axis, event) {
    this._draggingGizmo   = true;
    this._dragAxis        = axis;
    this._dragStartPos.x  = event.data.global.x;
    this._dragStartPos.y  = event.data.global.y;
    const entity = this.scene.getEntity(this._selectedEntityId);
    if (entity) {
      const sprite = entity.getComponent('sprite');
      if (sprite) { this._dragEntityStart.x = sprite.x; this._dragEntityStart.y = sprite.y; }
    }
    event.stopPropagation();
  }

  _stopGizmoDrag () { this._draggingGizmo = false; this._dragAxis = null; }

  _onGizmoDrag (event) {
    if (!this._draggingGizmo || !this._dragAxis) return;
    const rect    = this.app.view.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;
    const deltaX   = currentX - this._dragStartPos.x;
    const deltaY   = currentY - this._dragStartPos.y;
    const entity   = this.scene.getEntity(this._selectedEntityId);
    if (!entity) return;
    const sprite  = entity.getComponent('sprite');
    const physics = entity.getComponent('physics');
    if (!sprite) return;

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

    sprite.x = newX; sprite.y = newY;
    if (physics?.body) Matter.Body.setPosition(physics.body, { x: newX, y: newY });
    this._gizmo.position.set(newX, newY);
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
    resetEntityIds();          // ← IDs reset to 1 after every stop
    this._spawnDemoScene();
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

    this.input.update();
    this.scene.update(dt, this.elapsed);
    this._updateSelectionGizmo();
    this.ui.updateStatus(this.scene.entityCount(), this.elapsed);
  }

  // ── Scene Helpers ──────────────────────────────────────────
  _spawnDemoScene () {
    this.scene.clear();

    const configs = [
      { name: 'Player',   color: 0x00e5ff, x: 200, y: 200, shape: 'circle',  r: 20,        physics: { vx: 60,  vy: 40  }, tags: ['player','collider'] },
      { name: 'Enemy_01', color: 0xff3e6c, x: 500, y: 150, shape: 'rect',    w: 30, h: 30, physics: { vx: -40, vy: 60  }, tags: ['enemy'] },
      { name: 'Gem_01',   color: 0xa259ff, x: 350, y: 300, shape: 'diamond', r: 16,        physics: { vx: 80,  vy: -50 }, tags: ['pickup'] },
      { name: 'Platform', color: 0x39ff85, x: 400, y: 420, shape: 'rect',    w: 160, h: 16, physics: { fixed: true },     tags: ['static'] },
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

    // Inject logger so script errors appear in the engine console
    script._logger = this.logger;

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

  _spawnRandom () {
    const shapes = ['circle', 'rect', 'diamond', 'star'];
    const colors = [0x00e5ff, 0xff3e6c, 0xa259ff, 0x39ff85, 0xffd34e, 0xff9c27];
    const bounds = this.scene.bounds();
    const cfg = {
      name:  'Entity_' + Math.floor(Math.random() * 9000 + 1000),
      color: colors[Math.floor(Math.random() * colors.length)],
      x:     MathUtils.randInt(40, bounds.w - 40),
      y:     MathUtils.randInt(40, bounds.h - 40),
      shape: shapes[Math.floor(Math.random() * shapes.length)],
      r:     MathUtils.randInt(10, 24),
      w:     MathUtils.randInt(20, 50),
      h:     MathUtils.randInt(20, 50),
      physics: {
        vx: MathUtils.randRange(-100, 100),
        vy: MathUtils.randRange(-100, 100),
      },
      tags: ['spawned'],
    };
    const entity = this._createEntity(cfg);
    this.audio.playSfx('spawn');
    this.logger.info('Spawned: ' + entity.name + ' [' + cfg.shape + ']');
  }

  _clearScene () {
    this.scene.clear();
    this.audio.playSfx('clear');
    this.logger.warn('Scene cleared');
  }

  _toggleAudio () {
    const muted = this.audio.toggleMute();
    document.getElementById('btn-mute').textContent = muted ? '🔇 MUTED' : '🔊 AUDIO';
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
              r:     cfg.transform?.r     ?? 16,
              w:     cfg.transform?.w     ?? 32,
              h:     cfg.transform?.h     ?? 32,
              alpha: cfg.transform?.alpha ?? 1,
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