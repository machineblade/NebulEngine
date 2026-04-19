// Unit tests for EventBus — run with `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/EventBus.js';

test('on/emit delivers payloads to subscribers', () => {
  const bus = new EventBus();
  const seen = [];
  bus.on('hello', (p) => seen.push(p));
  bus.emit('hello', { n: 1 });
  bus.emit('hello', { n: 2 });
  assert.deepEqual(seen, [{ n: 1 }, { n: 2 }]);
});

test('on returns an unsubscribe function', () => {
  const bus = new EventBus();
  let count = 0;
  const off = bus.on('tick', () => count++);
  bus.emit('tick');
  off();
  bus.emit('tick');
  assert.equal(count, 1);
});

test('once fires exactly once', () => {
  const bus = new EventBus();
  let count = 0;
  bus.once('bang', () => count++);
  bus.emit('bang');
  bus.emit('bang');
  assert.equal(count, 1);
});

test('listener errors are isolated and do not stop other listeners', () => {
  const bus = new EventBus();
  const logs = [];
  const origErr = console.error;
  console.error = () => {};   // silence the intentional error
  try {
    bus.on('x', () => { throw new Error('boom'); });
    bus.on('x', () => logs.push('second-ran'));
    bus.emit('x');
  } finally {
    console.error = origErr;
  }
  assert.deepEqual(logs, ['second-ran']);
});

test('clear(event) removes only that event; clear() removes all', () => {
  const bus = new EventBus();
  let a = 0, b = 0;
  bus.on('a', () => a++);
  bus.on('b', () => b++);
  bus.clear('a');
  bus.emit('a'); bus.emit('b');
  assert.equal(a, 0);
  assert.equal(b, 1);
  bus.clear();
  bus.emit('b');
  assert.equal(b, 1);
});
