# NebulEngine v1.0.0

A modular browser-based **game engine** built with **PixiJS** (rendering) and **Howler.js** (audio).

## Folder Structure

```
game-engine/
├── index.html                  ← Entry point (open this in a browser)
├── styles/
│   └── main.css                ← Editor UI styles
└── src/
    ├── core/
    │   ├── Engine.js           ← Main engine bootstrap & game loop
    │   └── EventBus.js         ← Pub/sub event system
    ├── scene/
    │   └── SceneManager.js     ← Entity registry & scene lifecycle
    ├── entity/
    │   ├── Entity.js           ← Base entity (ECS-style)
    │   ├── SpriteComponent.js  ← PixiJS visual component
    │   ├── PhysicsComponent.js ← Simple physics (velocity, drag, gravity)
    │   └── ScriptComponent.js  ← User behaviour hooks
    ├── audio/
    │   └── AudioManager.js     ← Howler.js audio system (procedural SFX)
    ├── input/
    │   └── InputManager.js     ← Keyboard & mouse input
    ├── ui/
    │   └── UIBridge.js         ← Editor UI ↔ engine bridge
    └── utils/
        ├── Logger.js           ← Engine console logger
        └── MathUtils.js        ← Math helpers
```

## How to Run

Simply open `index.html` in a modern browser — no build step required.

> **Note:** Because this uses ES Modules (`type="module"`), you must serve it from a local HTTP server rather than opening the file directly. Use any of:
> - `npx serve .`
> - `python3 -m http.server 8080`
> - VS Code Live Server extension

## Editor Controls

| Button | Action |
|--------|--------|
| ▶ PLAY | Start the scene loop |
| ⏸ PAUSE | Pause/resume the loop |
| ⏹ STOP | Stop and reset the scene |
| ＋ SPAWN | Add a random entity |
| 🗑 CLEAR | Remove all entities |
| 🔊 AUDIO | Toggle mute |

Click any entity in the **Hierarchy** panel to inspect its live properties in the **Inspector**.

## Architecture

- **Engine** — top-level class that owns all systems and drives the game loop via `requestAnimationFrame`.
- **EventBus** — lightweight pub/sub used for all inter-system communication.
- **SceneManager** — holds the entity registry; calls `entity.update()` each frame.
- **Entity** — ECS-style container; add components with `entity.addComponent(key, component)`.
- **Components** — `SpriteComponent` (PixiJS Graphics), `PhysicsComponent` (velocity/drag/gravity), `ScriptComponent` (custom hooks).
- **AudioManager** — wraps Howler.js; generates procedural WAV tones via Web Audio API (no external audio files needed).
- **PhysicsComponent** — integrates Matter.js bodies for collisions, forces, and world simulation.
- **InputManager** — keyboard/mouse state with `isKeyDown`, `isKeyJustDown`, axis helpers.
- **UIBridge** — keeps the hierarchy list and inspector panel in sync with engine state.
- **Logger** — coloured, timestamped console panel.

## Extending the Engine

### Add a new component
```js
// src/entity/HealthComponent.js
export class HealthComponent {
  constructor (maxHp = 100) { this.hp = this.maxHp = maxHp; }
  takeDamage (amt) { this.hp = Math.max(0, this.hp - amt); }
  isDead () { return this.hp <= 0; }
  update () {}          // called every frame (optional)
  onAttach (entity) {}  // called when added to entity
  onDetach (entity) {}  // called when removed / entity destroyed
}
```

### Attach it to an entity
```js
import { HealthComponent } from './src/entity/HealthComponent.js';
entity.addComponent('health', new HealthComponent(50));
```

### Script a custom behaviour
```js
entity.addComponent('script', new ScriptComponent({
  onStart (entity) { console.log('hello from', entity.name); },
  onUpdate (entity, dt, elapsed, bounds) {
    const ph = entity.getComponent('physics');
    ph.applyForce(0, 200, dt);  // gravity
  },
}));
```# NebulEngine
