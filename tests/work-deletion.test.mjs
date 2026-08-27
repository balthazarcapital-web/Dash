import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const context = vm.createContext({ structuredClone, isoNow: () => '2026-08-27T12:00:00Z', uid: () => 'generated', norm: value => String(value).toLowerCase() });
vm.runInContext(source.slice(source.indexOf('function mergeById('), source.indexOf('function newWork(')) + source.slice(source.indexOf('function normalizeWork('), source.indexOf('async function getOrCreateWork(')), context);
const seed = { id: 'obra', clientId: 'client', details: {}, budget: { items: [{ id: 'item' }], actuals: [
  { id: 'manual', itemId: 'item', type: 'Mão de obra', value: 100 },
  { id: 'pedido', itemId: 'item', type: 'Material', value: 200, source: 'Pedido', orderRef: 'order-1' },
  { id: 'keep', itemId: 'item', value: 300 }
] } };

test('deleted manual and order costs stay deleted after published-base recovery', () => {
  const incoming = structuredClone(seed);
  incoming.budget.actuals = incoming.budget.actuals.filter(row => row.id === 'keep');
  const saved = context.normalizeWork(incoming, seed);
  const restored = context.restorePublishedWork(saved, seed).work;
  assert.deepEqual(Array.from(restored.budget.actuals, row => row.id), ['keep']);
  assert.ok(saved.budget.deletedActualKeys.includes('order:order-1'));
  assert.equal(restored.budget.actuals[0].value, 300);
});

test('a removed order can be linked to another item without restoring its old cost', () => {
  const incoming = structuredClone(seed);
  incoming.budget.actuals = incoming.budget.actuals.filter(row => row.id !== 'pedido');
  const deleted = context.normalizeWork(incoming, seed);
  const relinked = structuredClone(deleted);
  relinked.budget.actuals.push({ id: 'new-link', itemId: 'other', value: 200, source: 'Pedido', orderRef: 'order-1' });
  const saved = context.normalizeWork(relinked, deleted);
  const restored = context.restorePublishedWork(saved, seed).work;
  assert.equal(restored.budget.actuals.filter(row => row.orderRef === 'order-1').length, 1);
  assert.equal(restored.budget.actuals.find(row => row.orderRef === 'order-1').itemId, 'other');
});

test('recovering missing budget items preserves deletion markers', () => {
  const incoming = structuredClone(seed);
  incoming.budget.actuals = [];
  const saved = context.normalizeWork(incoming, seed);
  saved.budget.items = [];
  const restored = context.restorePublishedWork(saved, seed).work;
  assert.equal(restored.budget.items.length, 1);
  assert.equal(restored.budget.actuals.length, 0);
  assert.equal(restored.budget.deletedActualKeys.length, 4);
});
