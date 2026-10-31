/**
 * Local, model-free effect search over the Master Duel card dump that the
 * advisor MCP keeps in ~/.cache/master-duel-ai-advisor/cards.json.
 *
 * The MCP tool only does exact phrase matching, which fails for vague
 * descriptions ("通常召唤次数增加1次" vs the real text "通常召唤最多2次").
 * Here we extract anchors, infer numbers (N+1), and score cards by anchor
 * coverage plus proximity of the inferred number to the main anchor.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_CARDS = join(homedir(), '.cache', 'master-duel-ai-advisor', 'cards.json');

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** Effect anchors, with a weight: common words matter less. */
const ANCHORS = [
  ['通常召唤', 1.4], ['特殊召唤', 1.0], ['反转召唤', 1.2], ['上级召唤', 1.2], ['灵摆召唤', 1.2],
  ['融合', 0.8], ['同调', 0.8], ['超量', 0.8], ['连接', 0.6], ['仪式', 0.8],
  ['抽卡', 1.0], ['墓地', 0.6], ['卡组', 0.5], ['手卡', 0.5], ['除外', 0.8],
  ['破坏', 0.6], ['无效', 0.9], ['解放', 1.0], ['攻击力', 0.5], ['守备力', 0.5],
  ['表示形式', 0.8], ['战斗阶段', 0.8], ['主要阶段', 0.8], ['结束阶段', 0.8], ['准备阶段', 0.8],
  ['魔法', 0.4], ['陷阱', 0.4], ['怪兽', 0.3], ['对方', 0.3], ['自己', 0.2],
  ['对方场上', 1.0], ['自己场上', 0.5], ['对方怪兽', 0.9],
  ['效果', 0.2], ['召唤', 0.5],
];

const norm = (value) => String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

let cache;

export function loadCards(env = process.env) {  if (cache) return cache;
  const file = env.DSH_MASTERDUEL_CARDS || DEFAULT_CARDS;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(data.cards)) throw new Error('cards.json: missing cards array');
  cache = data.cards.map((card) => ({
    card,
    text: norm(`${card.cn} ${card.descZh}`),
    name: norm(card.cn),
  }));
  return cache;
}

/** Find a card by exact (then partial) Chinese / MD / English name. */
export function findCard(query) {
  const q = norm(query);
  if (!q) return null;
  const entries = loadCards();
  let partial = null;
  for (const { card, name } of entries) {
    if (name === q || norm(card.md) === q || norm(card.en) === q) return card;
    if (!partial && (name.includes(q) || q.includes(name))) partial = card;
  }
  return partial;
}

export function planQuery(query) {
  const raw = norm(query);
  const opponent = raw.includes('对方');
  const self = !opponent && /自己|我方/.test(raw);
  let q = raw.replace(/我方|我的|你的|自己/g, '');
  const anchors = ANCHORS.filter(([word]) => q.includes(word)).map(([word, weight]) => ({ word, weight }));

  const numbers = [];
  const inc = /(?:增加|多|追加)([0-9]+|[一二两三四五六七八九十])\s*[次张只]/.exec(q);
  if (inc) {
    const delta = CN_NUM[inc[1]] ?? Number(inc[1]);
    if (Number.isFinite(delta)) numbers.push(delta + 1);
  }
  const upTo = /(?:最多|至多)([0-9]+|[一二两三四五六七八九十])[次张只]/.exec(q);
  if (upTo) {
    const value = CN_NUM[upTo[1]] ?? Number(upTo[1]);
    if (Number.isFinite(value)) numbers.push(value);
  }
  return { q, anchors, numbers, opponent, self };
}

function snippet(text, anchor) {
  const index = text.indexOf(anchor);
  if (index < 0) return String(text).slice(0, 80);
  return String(text).slice(Math.max(0, index - 26), index + 64).replace(/\n/g, ' ');
}

export function searchEffects(query, { limit = 20, env = process.env } = {}) {
  const cards = loadCards(env);
  const { q, anchors, numbers, opponent, self } = planQuery(query);
  if (!q) return [];
  if (!anchors.length && !numbers.length) {
    // No known anchor: fall back to a plain substring match on the text.
    return cards
      .filter(({ text }) => text.includes(q))
      .slice(0, limit)
      .map(({ card }) => toResult(card, card.descZh, 1));
  }

  // Document frequency per anchor: rare anchors weigh more, but the rarest one
  // is not required (the user's wording rarely matches the card text exactly).
  const frequency = new Map();
  for (const { word } of anchors) {
    let count = 0;
    for (const { text } of cards) if (text.includes(word)) count += 1;
    frequency.set(word, count);
  }
  anchors.sort((a, b) => frequency.get(a.word) - frequency.get(b.word));
  const primary = anchors[0];
  const required = Math.min(2, anchors.length);

  const scored = [];
  for (const { card, text, name } of cards) {
    let matched = 0;
    let score = 0;
    for (const { word, weight } of anchors) {
      if (!text.includes(word)) continue;
      matched += 1;
      // Rarity factor: an anchor present in few cards is more informative.
      const freq = frequency.get(word) || 1;
      score += weight * Math.log((cards.length + 1) / (freq + 1));
    }
    if (matched < required) continue;
    for (const value of numbers) {
      if (text.includes(`最多${value}次`)) score += 3;
    }
    if (name.includes(q)) score += 4;
    if (text.includes(q)) score += 5;
    // Direction: "把对方怪兽解放" vs "把自己怪兽解放" differ only by who owns
    // the monster; only relevant when the query is about tributing.
    if (anchors.some((anchor) => anchor.word === '解放')) {
      const opp = /把[^。]{0,8}对方[^。]{0,10}怪兽[^。]{0,6}解放/.exec(text);
      if (opponent && opp && !opp[0].includes('自己')) score += 3.5;
      const own = /把[^。]{0,8}自己[^。]{0,10}怪兽[^。]{0,6}解放/.exec(text);
      if (self && own) score += 3.5;
    }
    if (score > 0) scored.push({ card, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  return top.map(({ card }) => {
    const body = [`「${card.md || card.cn}」${card.mdRarity ? ' ' + card.mdRarity : ''}`, card.typesZh, card.descZh]
      .filter(Boolean)
      .join('\n');
    return { name: card.md || card.cn, body, snippet: snippet(card.descZh, primary.word), score: 1 };
  });
}

function toResult(card, desc, score) {
  return {
    name: card.md || card.cn,
    body: [`「${card.md || card.cn}」${card.mdRarity ? ' ' + card.mdRarity : ''}`, card.typesZh, desc].filter(Boolean).join('\n'),
    snippet: snippet(desc, ''),
    score,
  };
}
