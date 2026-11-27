import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAncestry } from '../../ops/release/verify-live-ancestry.mjs';

const graph = { new: ['live', 'new'], live: ['live'] };
const isAncestor = (a, b) => (graph[b] || []).includes(a);

test('newer package that contains production passes', () => {
  assert.equal(checkAncestry({ commit: 'live' }, { commit: 'new', dirty: false }, isAncestor).ok, true);
});
test('older package that lacks production commit fails', () => {
  assert.equal(checkAncestry({ commit: 'new' }, { commit: 'live', dirty: false }, isAncestor).ok, false);
});
test('dirty package fails', () => {
  assert.equal(checkAncestry({ commit: 'live' }, { commit: 'new', dirty: true }, isAncestor).ok, false);
});
test('same commit redeploy passes', () => {
  assert.equal(checkAncestry({ commit: 'live' }, { commit: 'live', dirty: false }, isAncestor).ok, true);
});
test('CI test package is never deployable', () => {
  assert.equal(checkAncestry({ commit: 'live' }, { commit: 'new', dirty: false, deployable: false, ciTestPackage: true }, isAncestor).ok, false);
});
