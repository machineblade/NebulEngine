// Unit tests for MathUtils.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MathUtils } from '../src/utils/MathUtils.js';

test('clamp bounds a value between min and max', () => {
  assert.equal(MathUtils.clamp(5, 0, 10), 5);
  assert.equal(MathUtils.clamp(-1, 0, 10), 0);
  assert.equal(MathUtils.clamp(15, 0, 10), 10);
});

test('lerp interpolates linearly', () => {
  assert.equal(MathUtils.lerp(0, 100, 0), 0);
  assert.equal(MathUtils.lerp(0, 100, 1), 100);
  assert.equal(MathUtils.lerp(0, 100, 0.5), 50);
});

test('deg2rad and rad2deg round-trip', () => {
  const deg = 137;
  assert.ok(Math.abs(MathUtils.rad2deg(MathUtils.deg2rad(deg)) - deg) < 1e-9);
});

test('dist computes Euclidean distance', () => {
  assert.equal(MathUtils.dist(0, 0, 3, 4), 5);
});

test('normalize returns a unit vector, or (0,0) for zero input', () => {
  const n = MathUtils.normalize(3, 4);
  assert.ok(Math.abs(Math.hypot(n.x, n.y) - 1) < 1e-9);
  assert.deepEqual(MathUtils.normalize(0, 0), { x: 0, y: 0 });
});

test('mapRange remaps across ranges', () => {
  assert.equal(MathUtils.mapRange(5, 0, 10, 0, 100), 50);
  assert.equal(MathUtils.mapRange(0, 0, 10, 20, 30), 20);
});

test('randInt stays within bounds over many trials', () => {
  for (let i = 0; i < 200; i++) {
    const v = MathUtils.randInt(5, 10);
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 5 && v <= 10);
  }
});
