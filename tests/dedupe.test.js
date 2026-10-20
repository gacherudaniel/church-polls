const test = require('node:test');
const assert = require('node:assert/strict');
const { groupNames, displayName } = require('../docs/assets/dedupe.js');
const { SAMPLE_RESPONSES } = require('../dev/sample-data.js');

const header = SAMPLE_RESPONSES[0];
const column = (title) => {
  const i = header.indexOf(title);
  return SAMPLE_RESPONSES.slice(1).map((r) => r[i]);
};
const byName = (groups, name) => groups.find((g) => g.name === name);

test('case and spacing differences become one group', () => {
  const g = groupNames(['Grace Njeri', 'grace  njeri ', 'GRACE NJERI'], []);
  assert.equal(g.length, 1);
  assert.equal(g[0].count, 3);
  assert.equal(g[0].name, 'Grace Njeri');
});

test('spelling variants are merged', () => {
  const g = groupNames(column('Nominee for Secretary'), []);
  const jo = byName(g, 'Josephine');
  assert.ok(jo, JSON.stringify(g.map((x) => x.name)));
  assert.equal(jo.count, 2); // "Josephine  ", "Josefine"
});

test('a chain of short → long names collapses into the longest', () => {
  const g = groupNames(column('Nominee for Treasurer'), []);
  const samuel = byName(g, 'Samuel Mwangi Kariuki');
  assert.equal(samuel.count, 4); // Samuel Kariuki ×3, Samuel Mwangi Kariuki ×1
  const chair = groupNames(column('Nominee for Chairperson'), []);
  assert.equal(byName(chair, 'Paul Kamau Njoroge').count, 3); // Paul, Paul Njoroge, Paul Kamau Njoroge
  assert.equal(byName(chair, 'Faith Wairimu Kamau').count, 3);
});

test('a short form of a longer name is flagged as a possible match', () => {
  const g = groupNames(column('Nominee for Treasurer'), []);
  assert.deepEqual(byName(g, 'Sam').ambiguous.options, ['Samuel Mwangi Kariuki']);
  const chair = groupNames(column('Nominee for Chairperson'), []);
  assert.deepEqual(byName(chair, 'Kamau').ambiguous.options.sort(), ['Faith Wairimu Kamau', 'Paul Kamau Njoroge']);
});

test('an ambiguous first name is flagged, never merged', () => {
  const g = groupNames(column('Nominee for Vice Secretary'), []);
  const grace = byName(g, 'Grace');
  assert.ok(grace.ambiguous);
  assert.deepEqual(grace.ambiguous.options.sort(), ['Grace Achieng', 'Grace Njeri']);
  assert.equal(byName(g, 'Grace Njeri').count, 1);
  assert.equal(byName(g, 'Grace Achieng').count, 1);
});

test('a surname on its own is flagged as a possible match', () => {
  const g = groupNames(['Rose Akinyi', 'Akinyi'], []);
  assert.equal(g.length, 2);
  assert.deepEqual(byName(g, 'Akinyi').ambiguous.options, ['Rose Akinyi']);
});

test('first-name-only groups get hints from elsewhere on the form', () => {
  const others = [{ name: 'Daniel Kiprop Rotich', position: 'Vice Chairperson' }, { name: 'Tom Ochieng', position: 'Chairperson' }];
  const g = groupNames(['Dan', 'Tom', 'Tom'], others);
  assert.deepEqual(byName(g, 'Dan').hints.map((h) => h.name), ['Daniel Kiprop Rotich']);
  assert.deepEqual(byName(g, 'Tom').hints.map((h) => h.name), ['Tom Ochieng']);
});

test('blank and placeholder answers are ignored', () => {
  assert.deepEqual(groupNames(['', ' ', 'N/A', 'none', '-'], []), []);
});

test('display names are tidied without breaking deliberate capitals', () => {
  assert.equal(displayName('mary wambui'), 'Mary Wambui');
  assert.equal(displayName('ESTHER WANJIRU'), 'Esther Wanjiru');
  assert.equal(displayName("Ann-Marie O'neil"), "Ann-Marie O'neil");
  assert.equal(displayName('Ted McDonald'), 'Ted McDonald');
});
