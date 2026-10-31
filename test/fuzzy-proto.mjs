import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const file = join(homedir(), '.cache', 'master-duel-ai-advisor', 'cards.json');
const data = JSON.parse(readFileSync(file, 'utf8'));
const cards = data.cards;
console.log('cards:', cards.length);

const norm = (s) => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const bigrams = (s) => {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return [...out];
};

function search(query, limit = 5) {
  const q = norm(query);
  const grams = bigrams(q);
  const textOf = (c) => norm(`${c.cn} ${c.md} ${c.descZh} ${c.en} ${c.descEn}`);
  const df = new Map(grams.map((g) => [g, 0]));
  const prepared = cards.map((c) => textOf(c));
  prepared.forEach((text) => { for (const g of grams) if (text.includes(g)) df.set(g, df.get(g) + 1); });
  const idf = new Map(grams.map((g) => [g, Math.log((cards.length + 1) / ((df.get(g) || 0) + 1))]));
  const total = [...idf.values()].reduce((a, b) => a + b, 0) || 1;

  const scored = cards.map((c, i) => {
    const text = prepared[i];
    let s = 0;
    for (const g of grams) if (text.includes(g)) s += idf.get(g);
    if (text.includes(q)) s += total * 0.5;
    if (norm(c.cn) === q || norm(c.md) === q) s += total;
    return { c, score: s / total };
  }).filter((x) => x.score > 0.05).sort((a, b) => b.score - a.score).slice(0, limit);

  console.log(`\nQ: ${query}`);
  for (const { c, score } of scored) console.log(score.toFixed(3), c.md || c.cn, '|', String(c.descZh).slice(0, 70).replace(/\n/g, ' '));
}

search('我方回合通常召唤次数增加1次');
search('把对方怪兽解放');
search('无效魔法陷阱卡的发动');
search('从墓地特殊召唤');
