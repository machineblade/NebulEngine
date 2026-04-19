# NebulEngine v1.2 + gizmo-fix — test plan

Scope: validate the three things the user explicitly asked for, running on `main` (commits `227d512` v1.2 merge + `9bfe90d` gizmo-fix merge).

App under test: `http://localhost:8080/index.html` (local static serve of `main`).

Initial state: demo scene auto-spawns 5 entities. Relevant one is **Player** (cyan circle) at canvas coords `(200, 200)`
(`src/core/Engine.js:606`). Gizmo arrows are 60 px long along the X (blue, `Engine.js:297-305`) and Y (red, `Engine.js:307-315`) axes from the selected entity. Rotation ring is at `(-80 px)` up (`Engine.js:319-330`). Body-drag listener attaches in `_bindCanvasEvents` and short-circuits when the gizmo owns the drag (`Engine.js:477-484`).

---

## Test A — Blue X-arrow moves Player along X **only**  (fixes PR #3 regression)

Steps
1. Left-click the Player circle (~`200, 200` canvas-local). Selection gizmo appears: blue arrow to the right, red arrow up, orange ring above.
2. Left-press on the blue X-arrow tip (~`+55 px right of Player`), drag `+120 px right` horizontally, release.

Pass criteria
- Player's inspector **X** field increases by roughly `+120` (e.g. 200 → ~320).
- Player's inspector **Y** field is unchanged (within ±1 px of its starting value, i.e. ~200).
- No "wild" flicker: entity follows the cursor smoothly, does not jump elsewhere or oscillate.

Broken-implementation signal: if `_bodyDrag` is not cancelled on gizmo pointerdown (pre-#3 bug), Y will also change and the entity will trail the pointer freely in 2D instead of being rail-constrained to X.

---

## Test B — Hold-click on entity body = free X+Y drag  (user bug #3)

Steps
1. Click an empty part of the canvas to deselect (gizmo disappears).
2. Left-press directly on the **Enemy_01** red square (~`500, 150`), drag diagonally down-left by roughly `(-150, +100)` px, release.

Pass criteria
- Enemy_01 inspector X decreases by ~150 (e.g. 500 → ~350).
- Enemy_01 inspector Y increases by ~100 (e.g. 150 → ~250).
- Entity visibly tracks the cursor in real time with the engine **STOPPED**
  (pre-v1.2 bug: nothing rendered until PLAY).

Broken-implementation signal: if `SpriteComponent.syncGraphics()` is missing, the sprite position would not update on screen until PLAY is pressed.

---

## Test C — Play → drag → Stop reverts to pre-play position  (user bug #2)

Steps
1. Note Player's position in inspector (let this be `(x0, y0)`; expect ~`(200, 200)` if no prior test left it elsewhere — record before starting).
2. Press **▶ PLAY**. Entities begin simulating (physics velocities kick in). Wait ~1 s.
3. While playing, left-press the Player body and drag to a clearly different location (e.g. top-right area of the canvas).
4. Press **⏹ STOP**.

Pass criteria
- Inspector X/Y for Player snap back to `(x0, y0)` within ±2 px.
- Player sprite renders at `(x0, y0)` on screen immediately (no PLAY needed to see it).
- Physics body is at rest (no residual velocity from the sim) — no drift after STOP.

Broken-implementation signal: if `_captureScene()` / `_restoreScene()` is broken or `play()` doesn't snapshot, Player stays at the dragged position after STOP.

---

## Evidence

Recording will be a single continuous screen capture covering A → B → C with `record_annotate` markers per test and per assertion.
