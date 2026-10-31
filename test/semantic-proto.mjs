import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const cards = JSON.parse(readFileSync(join(homedir(), '.cache', 'master-duel-ai-advisor', 'cards.json'), 'utf8')).cards;

const norm = (s) => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

const ANCHORS = ['通常召唤', '特殊召唤', '反转召唤', '上级召唤', '灵摆召唤', '融合', '同调', '超量', '连接', '仪式', '抽卡', '抽', '墓地', '卡组', '手卡', '除外', '破坏', '无效', '解放', '攻击力', '守备力', '表示形式', '战斗阶段', '主要阶段', '结束阶段', '准备阶段', '魔法', '陷阱', '怪兽', '效果'];

function plan(query) {
  let q = norm(query).replace(/我方|自己|你的|我的|对方/g, (m) => (m === '对方' ? '对方' : ''));
  const anchors = ANCHORS.filter((a) => q.includes(a));
  const numbers = [];
  // “增加 N 次/张/只” → 目标数 N+1
  const inc = /(?:增加|多|追加)([0-9]+|[一二两三四五六七八九十])[次张只]/.exec(q);
  if (inc) {
    const n = CN_NUM[inc[1]] ?? Number(inc[1]);
    numbers.push(n + 1);
  }
  const more = /(?:最多|至多)([0-9]+|[一二两三四五六七八九十])[次张只]/.exec(q);
  if (more) numbers.push(CN_NUM[more[1]] ?? Number(more[1]));
  return { q, anchors, numbers };
}

function snippet(text, anchor) {
  const i = text.indexOf(anchor);
  if (i < 0) return text.slice(0, 60);
  return text.slice(Math.max(0, i - 20), i + 45).replace(/\n/g, ' ');
}

function search(query, limit = 8) {
  const { q, anchors, numbers } = plan(query);
  const primary = anchors[0];
  const scored = [];
  for (const c of cards) {
    const text = norm(`${c.cn} ${c.descZh}`);
    const name = norm(c.cn);
    let score = 0;
    let matched = 0;
    for (const a of anchors) if (text.includes(a)) { score += 1; matched += 1; }
    if (primary && !text.includes(primary)) continue;
    // 数字推理：目标数出现在主锚点附近
    for (const n of numbers) {
      const idx = text.indexOf(primary);
      const window = text.slice(Math.max(0, idx - 8), idx + 20);
      if (window.includes(`最多${n}次`) || window.includes(`${n}次`)) score += 2.5;
      else if (text.includes(`最多${n}次`)) score += 0.8;
    }
    if (name.includes(q)) score += 2;
    if (text.includes(q)) score += 3;
    if (score > 0) scored.push({ c, score, matched });
  }
  scored.sort((a, b) => b.score - a.score || b.matched - a.matched);
  console.log(`\nQ: ${query}  plan=${JSON.stringify({ anchors, numbers })}`);
  for (const { c, score } of scored.slice(0, limit)) {
    console.log(score.toFixed(1), c.md || c.cn, '|', snippet(String(c.descZh), primary || ''));
  }
}

search('我方回合通常召唤次数增加1次');
search('无效魔法陷阱卡的发动');
search('把对方怪兽解放');
search('从卡组把卡加入手卡');
