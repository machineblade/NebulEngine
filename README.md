# NebulEngine v1.3.0

A modular browser-based **game engine** built with **PixiJS** (rendering), **Matter.js** (physics) and **Howler.js** (audio).

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

No build step required. Serve the repo root over HTTP and open `index.html`:

```bash
npm start                    # serves on :8080 via `npx serve`
# or
python3 -m http.server 8080
# or use the VS Code Live Server extension
```

Because the engine uses native ES modules (`type="module"`), the files **must**
be served over HTTP — opening `index.html` directly via `file://` will not
work.

## Editor Controls

| Button        | Action                                                  |
|---------------|---------------------------------------------------------|
| ▶ PLAY       | Start the scene loop                                    |
| ⏸ PAUSE      | Pause / resume the loop                                 |
| ⏹ STOP       | Stop the loop (scene keeps all edits; nothing reverts)  |
| ✥ MOVE       | Show X / Y translate arrows on the selection gizmo      |
| ↻ ROTATE     | Show rotation ring on the selection gizmo               |
| ⇲ SCALE      | Show four corner handles — drag to resize the entity    |
| ▦ GRID       | Toggle the grid overlay                                 |
| SNAP dropdown | Grid size used when repositioning (Off / 10 / 20 / 40 / 80 px) |
| ＋ SPAWN      | Add a random entity                                     |
| 🗑 CLEAR      | Remove all entities                                     |
| 💾 SAVE       | Download the current scene as JSON                      |
| 📂 LOAD       | Load a scene from a JSON file                           |
| 🔊 AUDIO      | Toggle mute                                             |

Click any entity in the **Hierarchy** panel (or in the viewport) to select
it. The **Inspector** panel lets you edit transform, color, alpha, gravity,
bounce, drag and the *fixed* flag in place — changes apply instantly.

### Keyboard shortcuts

| Shortcut                | Action                                  |
|-------------------------|-----------------------------------------|
| `Space`                 | Play / pause                            |
| `Delete` / `Backspace`  | Remove selected entity                  |
| `Ctrl/Cmd + D`          | Duplicate selected entity               |
| `Ctrl/Cmd + Z`          | Undo last transform                     |
| `Ctrl/Cmd + Shift + Z`  | Redo (also `Ctrl/Cmd + Y`)              |
| `Escape`                | Deselect                                |
| `0`                     | Reset viewport zoom / pan               |
| `Alt + L`               | Toggle gizmo local / global space       |
| Mouse wheel             | Zoom in / out (centered on cursor)      |
| Middle-mouse drag       | Pan the viewport                        |
| Left-click + drag body  | Free-drag selected entity in X + Y      |
| Drag gizmo X/Y arrow    | Axis-constrained drag                   |
| Drag gizmo rotation ring| Rotate the entity                       |
| `Q` / `W` / `E`         | Select Move / Rotate / Scale tool       |
| `G`                     | Toggle grid overlay                     |
| `Shift` + drag          | Force snap / rotation 15° / non-uniform scale |

Shortcuts are ignored while focus is inside the script editor or an inspector
field, so typing code never accidentally triggers the engine.

### Play ↔ Edit

Pressing **STOP** halts the simulation loop but leaves every entity exactly
where it is — nothing is reverted. If you want to roll back a change, use
`Ctrl/Cmd + Z`.

### Script windows

Double-click a script card in the bottom-right **Scripts** panel to open a
floating editor window for that script. Each window is:

- **Draggable** — grab the header and drag anywhere on screen.
- **Resizable** — drag the bottom-right grip.
- **Fullscreen** — click ⬜ in the header, or double-click the header.
- **Minimizable** — click — in the header to collapse to a title bar.
- **Closable** — click ✕ to close. Edits are persisted automatically, so
  re-opening the script brings back the most recent source.

Multiple script windows can be open at once; clicking any window brings it
to the front.

**Rename** a script with `F2` (while it is the active script) or by
right-clicking the card. Double-click is reserved for opening the window.

### Collision hooks

Scripts can react to Matter.js contacts via two optional methods:

```js
({
  onCollide (self, other, pair) {
    if (other.hasTag('enemy')) self.getComponent('sprite').flash();
  },
  onSeparate (self, other, pair) {
    // called once when the contact ends
  },
})
```

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
```

## Tests

Unit tests cover `EventBus`, `MathUtils`, and `Entity`. They run under Node's
built-in test runner — no dependencies, no build step:

```bash
npm test
```

## Changelog

### v1.3.0

- **Floating script editor windows** — double-click a script card to open a
  draggable / resizable / fullscreen / minimizable / closable window with
  the script source. Edits are synced back to the script immediately; the
  previous browser-popup window has been replaced entirely.
- **Transform tool toolbar** — `Move` / `Rotate` / `Scale` buttons, separated
  from the `Play / Pause / Stop` group. Hotkeys `Q` / `W` / `E`. The
  selection gizmo now shows only the handles for the active tool.
- **Scale tool** — four corner handles that resize the entity in local
  space. Uniform by default; hold `Shift` for non-uniform scaling.
- **Grid overlay and snap dropdown** — new `Grid` toggle (hotkey `G`) shows
  a stage-space grid. The adjacent `Snap` dropdown sets the grid step used
  when repositioning (`Off`, `10`, `20`, `40`, `80` px). When snap is on,
  drags snap without needing `Shift`; when it's `Off`, `Shift` still
  snaps on demand.
- **Stop no longer reverts** — Per feedback, the play-time snapshot from
  v1.2 has been removed. Pressing `STOP` now leaves entities exactly where
  they ended up. Undo (`Ctrl/Cmd + Z`) is still available for step-by-step
  rollback.

### v1.2.0

- **Click-and-hold to free-drag entities** in both X and Y — no need to reach
  for the gizmo arrows for simple moves. Hold `Shift` to snap to the grid.
- **Rotation handle** on the selection gizmo (orange ring above the entity).
  Hold `Shift` while rotating for 15° steps.
- **Play ↔ Stop revert** — `STOP` snapshots the edit-time state of every
  entity on `PLAY` and restores it on stop, so playing around with physics
  no longer destroys your authored layout.
- **Edits render immediately while stopped** — dragging the gizmo or editing
  inspector fields updates the canvas even when the simulation isn't running.
- **Undo / redo** for transform edits (drags + inspector).
  `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, and `Ctrl/Cmd+Y`.
- **Collision hooks** — scripts can implement `onCollide(self, other, pair)`
  and `onSeparate(self, other, pair)` and receive Matter contact events.
- **Unit tests** — `npm test` runs Node's built-in test runner across
  `EventBus`, `MathUtils`, and `Entity`.
- **Bug fixes**
  - `_duplicateSelected` now preserves the source entity's rotation.
  - `Shift`-snap during an axis-constrained gizmo drag only snaps the axis
    actually being dragged (previously snapped both and yanked the entity
    off its authored position on the idle axis).

### v1.1.0

- **Editable inspector** — edit name, position, rotation, color, alpha,
  gravity, bounce, drag and the *fixed* flag directly in the panel.
- **Duplicate entity** action (inspector button + `Ctrl/Cmd+D`).
- **Viewport pan / zoom** — mouse wheel to zoom, middle-drag to pan, `0` to
  reset.
- **Grid snap** while dragging the gizmo (hold `Shift`).
- **Keyboard shortcuts** for Play / Pause (`Space`), Delete, Duplicate and
  deselect (`Esc`).
- **Bug fixes**
  - `InputManager.isKeyJustDown` / `isKeyJustUp` now work correctly from
    scripts (the frame-state snapshot used to be taken before input was
    read).
  - `PhysicsComponent.rotate(radsPerSec, dt)` now actually spins at
    `radsPerSec` instead of applying the `dt` factor twice.
  - `STOP` no longer wipes your scene and reloads the demo — the scene is
    preserved so you can inspect it after stopping.
  - Engine keyboard shortcuts (Space, Delete, arrows…) no longer fire
    while you are typing in the script editor or an inspector field.
  - `AudioManager` now degrades gracefully when the Howler.js CDN is
    unavailable instead of throwing on every `playSfx` call.
