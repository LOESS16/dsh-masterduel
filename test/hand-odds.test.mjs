import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { handOdds, generateHandRules } from '../lib/hand-odds.js';
import { analyzeDeck, statsForNames } from '../lib/deck.js';

process.env.DSH_MASTERDUEL_CARDS = fileURLToPath(new URL('./fixtures/cards.json', import.meta.url));

// Fixtures: keep tests independent from the downloaded card database.
const ash = { id: 14558127, md: '灰流丽', descZh: '把这张卡从手卡丢弃才能发动。那个效果无效。' };
const reinforcements = { id: 32807846, md: '增援', descZh: '从卡组把1只4星以下的战士族怪兽加入手卡。' };
const vanilla = { id: 89631139, md: '青眼白龙', descZh: '通常怪兽。' };
const cards = [ash, reinforcements, vanilla];

const fakeDeck = {
  parseDeck: () => ({
    sections: {
      main: cards.map((card) => ({ card, count: 3 })),
      extra: [],
      side: [],
    },
  }),
};

const deps = {
  loadCards: () => cards.map((card) => ({ card })),
  deckModule: async () => fakeDeck,
};

test('handOdds auto-rules include search starters and exclude hand traps', async () => {
  let seenRules = '';
  const mcp = {
    toolText: async (_tool, args) => {
      seenRules = args.rules;
      return '先手 5 张：50.0%\n后手 6 张：60.0%';
    },
  };
  const result = await handOdds('ydk', '', mcp, deps);
  assert.match(seenRules, /增援：→ 能动/);
  assert.doesNotMatch(seenRules, /灰流丽/);
  assert.match(result.text, /后手 6/);
});

test('handOdds returns guidance when no starter is detected', async () => {
  const onlyTraps = {
    parseDeck: () => ({ sections: { main: [{ card: ash, count: 3 }], extra: [], side: [] } }),
  };
  let called = false;
  const result = await handOdds('ydk', '', { toolText: async () => { called = true; return ''; } }, {
    loadCards: () => [{ card: ash }],
    deckModule: async () => onlyTraps,
  });
  assert.equal(called, false);
  assert.match(result.text, /没有自动识别/);
});

test('generateHandRules validates model lines against deck names', async () => {
  const modelText = [
    '- 增援：→ 能动',
    '- 不存在的卡：→ 能动',
    '灰流丽：效果无效 → 能动',
    '说明文字',
  ].join('\n');
  const result = await generateHandRules({}, 'ydk', {
    loadCards: deps.loadCards,
    deckModule: deps.deckModule,
    callModel: async () => modelText,
  });
  assert.equal(result.rules, '增援：→ 能动');
});

// Keep other deck helpers covered here too, so CI fails if the module breaks.
test('deck helpers still parse', () => {
  const result = analyzeDeck('3 灰流丽');
  assert.equal(result.summary.main, 3);
  const stats = statsForNames(['灰流丽']);
  const kind = stats.find((entry) => entry.id === 'kind');
  assert.ok(kind.items.some((item) => item.label === '怪兽' && item.count === 1));
});
