// Unit tests for Entity — verifies the ECS-style component lifecycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Entity, resetEntityIds } from '../src/entity/Entity.js';

test('new entities receive monotonically increasing ids', () => {
  resetEntityIds();
  const a = new Entity('A');
  const b = new Entity('B');
  assert.equal(a.id, 1);
  assert.equal(b.id, 2);
});

test('addComponent sets _entity back-reference and calls onAttach', () => {
  resetEntityIds();
  const e = new Entity('E');
  let attachedWith = null;
  const comp = {
    onAttach (entity) { attachedWith = entity; },
  };
  e.addComponent('probe', comp);
  assert.equal(comp._entity, e);
  assert.equal(attachedWith, e);
  assert.equal(e.getComponent('probe'), comp);
});

test('update forwards to each component.update (active only)', () => {
  resetEntityIds();
  const e = new Entity('E');
  const calls = [];
  e.addComponent('a', { update (dt) { calls.push(['a', dt]); } });
  e.addComponent('b', { update (dt) { calls.push(['b', dt]); } });
  e.update(0.016, 0, { w: 100, h: 100 });
  assert.deepEqual(calls, [['a', 0.016], ['b', 0.016]]);

  calls.length = 0;
  e.active = false;
  e.update(0.016, 0, { w: 100, h: 100 });
  assert.deepEqual(calls, []);
});

test('destroy detaches every component and clears the registry', () => {
  resetEntityIds();
  const e = new Entity('E');
  let detached = 0;
  e.addComponent('x', { onDetach () { detached++; } });
  e.addComponent('y', { onDetach () { detached++; } });
  e.destroy();
  assert.equal(detached, 2);
  assert.equal(e.getComponent('x'), null);
  assert.equal(e.getComponent('y'), null);
});

test('tag helpers are set-backed', () => {
  resetEntityIds();
  const e = new Entity('E', ['player']);
  assert.ok(e.hasTag('player'));
  e.addTag('fast');
  assert.ok(e.hasTag('fast'));
  e.removeTag('player');
  assert.ok(!e.hasTag('player'));
});

test('toJSON includes identity, tags, transform, and physics', () => {
  resetEntityIds();
  const e = new Entity('Hero', ['player']);
  e.addComponent('sprite',  { toJSON: () => ({ x: 1, y: 2 }) });
  e.addComponent('physics', { toJSON: () => ({ gravity: 5 }) });
  const j = e.toJSON();
  assert.equal(j.name, 'Hero');
  assert.deepEqual(j.tags, ['player']);
  assert.deepEqual(j.transform, { x: 1, y: 2 });
  assert.deepEqual(j.physics, { gravity: 5 });
});
