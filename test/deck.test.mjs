import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseDeck, analyzeDeck, statsForNames } from '../lib/deck.js';

process.env.DSH_MASTERDUEL_CARDS = fileURLToPath(new URL('./fixtures/cards.json', import.meta.url));

const OFFICIAL_YDKE = 'ydke://y+iNAd3uOQI=!/rTFAw==!3e45Ag==!';

test('parseDeck accepts the official YDKE example', () => {
  const parsed = parseDeck(OFFICIAL_YDKE);
  assert.equal(parsed.unknown.length, 0);
  assert.equal(parsed.sections.main.length, 2);
  assert.equal(parsed.sections.extra.length, 1);
  assert.equal(parsed.sections.side.length, 1);
  const total = [...parsed.sections.main, ...parsed.sections.extra, ...parsed.sections.side]
    .reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(total, 4);
});

test('parseDeck ignores pasted deck-count lines', () => {
  for (const text of ['43\n1', '43、1', '43 1', '43\n1\n2']) {
    const parsed = parseDeck(text);
    assert.equal(parsed.unknown.length, 0, `unexpected unknown for ${JSON.stringify(text)}: ${parsed.unknown.join(',')}`);
  }
});

test('parseDeck accepts plain card-list text', () => {
  const parsed = parseDeck('3 灰流丽\n1 增援');
  assert.equal(parsed.sections.main.length, 2);
  assert.equal(parsed.sections.main.find((entry) => entry.card?.cn === '灰流丽' || entry.card?.md === '灰流丽')?.count, 3);
});

test('analyzeDeck reports main-deck size issues', () => {
  const result = analyzeDeck('3 灰流丽');
  assert.equal(result.ok, true);
  assert.equal(result.summary.main, 3);
  assert.ok(result.issues.some((issue) => issue.text.includes('40')));
});

test('statsForNames groups known cards', () => {
  const stats = statsForNames(['灰流丽', '灰流丽', '增援']);
  assert.ok(Array.isArray(stats));
  const kind = stats.find((entry) => entry.id === 'kind');
  assert.ok(kind);
  assert.ok(kind.items.some((item) => item.label === '怪兽' && item.count === 2));
  assert.ok(kind.items.some((item) => item.label === '魔法' && item.count === 1));
});
