/**
 * Deck parsing + local analysis for the graph view.
 *
 * Accepts a YDK file body, a YDKE string, or a plain card list. Resolves ids
 * and names against the cached card dump, then computes type / attribute /
 * race / level / rarity distributions and banlist violations.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadCards, findCard } from './semantic.js';

const BANLIST_PATH = join(homedir(), '.cache', 'master-duel-ai-advisor', 'md_banlist.json');

const ATTR_ZH = { LIGHT: '光', DARK: '暗', FIRE: '炎', WATER: '水', WIND: '风', EARTH: '地', DIVINE: '神' };
const RACE_ZH = {
  Dragon: '龙', Spellcaster: '魔法师', Zombie: '不死', Fiend: '恶魔', Pyro: '炎', Aqua: '水', Thunder: '雷',
  Rock: '岩石', Machine: '机械', Fish: '鱼', Dinosaur: '恐龙', Insect: '昆虫', Beast: '兽',
  'Beast-Warrior': '兽战士', Warrior: '战士', Fairy: '天使', Reptile: '爬虫类', Psychic: '念动力',
  Wyrm: '幻龙', Cyberse: '电子界', Plant: '植物', 'Winged Beast': '鸟兽', 'Sea Serpent': '海龙',
  'Divine-Beast': '幻神兽', 'Creator God': '创造神',
};
const KIND_ZH = {
  Fusion: '融合', Synchro: '同调', XYZ: '超量', Link: '连接', Ritual: '仪式', Pendulum: '灵摆',
  Tuner: '调整', Normal: '通常', Effect: '效果', Flip: '反转', Gemini: '二重', Spirit: '灵魂',
  Union: '联合', Toon: '卡通',
};
const SPELL_TRAP_ZH = {
  'Quick-Play': '速攻', Continuous: '永续', Field: '场地', Equip: '装备', Counter: '反击', Normal: '通常',
};
const BANLIST_LIMIT = { forbidden: 0, limited1: 1, limited2: 2 };
const BANLIST_ZH = { forbidden: '禁止', limited1: '限制1', limited2: '限制2' };

let index;

function cardIndex() {
  if (index) return index;
  const byId = new Map();
  const byName = new Map();
  for (const { card } of loadCards()) {
    byId.set(Number(card.id), card);
    for (const id of [card.id, ...(card.altIds || [])]) byId.set(Number(id), card);
    for (const name of [card.cn, card.md, card.sc, card.en]) {
      if (name) byName.set(String(name).trim().toLowerCase(), card);
    }
  }
  index = { byId, byName };
  return index;
}

let banlist;
function loadBanlist() {
  if (banlist) return banlist;
  banlist = { current: new Map(), upcoming: new Map(), date: '', upcomingDate: '' };
  if (!existsSync(BANLIST_PATH)) return banlist;
  const data = JSON.parse(readFileSync(BANLIST_PATH, 'utf8'));
  for (const item of data.current?.entries || []) banlist.current.set(Number(item.id), item.status);
  for (const item of data.upcoming?.entries || []) banlist.upcoming.set(Number(item.id), item.status);
  banlist.date = data.current?.date || '';
  banlist.upcomingDate = data.upcoming?.date || '';
  return banlist;
}

function parseTextSections(text) {
  const sections = { main: [], extra: [], side: [] };
  let current = 'main';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#main$/i.test(line)) { current = 'main'; continue; }
    if (/^#extra$/i.test(line)) { current = 'extra'; continue; }
    if (/^!side$/i.test(line)) { current = 'side'; continue; }
    if (line.startsWith('#') || line.startsWith('!')) continue;
    for (const token of line.split(/\s+/)) {
      const id = Number(token);
      if (Number.isInteger(id) && id > 0) sections[current].push(id);
    }
  }
  return sections;
}

function parsePlainList(text) {
  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let count = 1;
    let match = /^(\d+)\s*[x×]?\s*(.+)$/.exec(line);
    if (match) { count = Number(match[1]); line = match[2].trim(); }
    else {
      match = /^(.+?)\s*[x×]\s*(\d+)$/.exec(line);
      if (match) { line = match[1].trim(); count = Number(match[2]); }
    }
    if (line) entries.push({ count, query: line });
  }
  return entries;
}

/**
 * @returns {{ sections: {main: Array<{card: object|null, count: number, key: string}>, extra: ..., side: ...}, unknown: string[] }}
 */
export function parseDeck(input) {
  const text = String(input || '').trim();
  const empty = { main: [], extra: [], side: [] };
  if (!text) return { sections: empty, unknown: [] };

  let rawSections = null;
  let plain = null;

  const ydkeMatch = /^ydke:\/\/([\s\S]*)$/i.exec(text);
  const decodeYdkePart = (part) => {
    if (!part) return [];
    const buffer = Buffer.from(part, 'base64');
    const ids = [];
    for (let i = 0; i + 4 <= buffer.length; i += 4) ids.push(buffer.readUInt32LE(i));
    return ids;
  };

  if (ydkeMatch) {
    const parts = ydkeMatch[1].split('!');
    rawSections = { main: decodeYdkePart(parts[0]), extra: decodeYdkePart(parts[1]), side: decodeYdkePart(parts[2]) };
  } else if (/#main|#extra|!side/i.test(text)) {
    rawSections = parseTextSections(text);
  } else if (/^[A-Za-z0-9_-]{24,}$/.test(text) && !text.includes(' ')) {
    try {
      const decoded = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      if (/#extra|#main|!side/.test(decoded) || /^\d/m.test(decoded)) rawSections = parseTextSections(decoded);
    } catch {
      /* fall through to plain list */
    }
  }
  if (!rawSections) plain = parsePlainList(text);

  const { byId, byName } = cardIndex();
  const sections = { main: [], extra: [], side: [] };
  const unknown = [];

  if (rawSections) {
    for (const section of ['main', 'extra', 'side']) {
      const counts = new Map();
      for (const id of rawSections[section]) counts.set(id, (counts.get(id) || 0) + 1);
      for (const [id, count] of counts) {
        const card = byId.get(id) || null;
        if (!card) unknown.push(String(id));
        sections[section].push({ card, count, key: card ? String(card.id) : String(id) });
      }
    }
  } else {
    for (const { count, query } of plain) {
      const card = byName.get(query.toLowerCase()) || byId.get(Number(query)) || null;
      if (!card) { unknown.push(query); continue; }
      const section = isExtraDeck(card) ? 'extra' : 'main';
      const existing = sections[section].find((entry) => entry.key === String(card.id));
      if (existing) existing.count += count;
      else sections[section].push({ card, count, key: String(card.id) });
    }
  }

  return { sections, unknown };
}

function isExtraDeck(card) {
  const line = Array.isArray(card.typeline) ? card.typeline : [];
  return ['Fusion', 'Synchro', 'XYZ', 'Link'].some((kind) => line.includes(kind));
}

function bump(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function topEntries(map, max = 12) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, max)
    .map(([label, count]) => ({ label, count }));
}

export function statsForNames(names) {
  const kind = new Map();
  const monsterKind = new Map();
  const attr = new Map();
  const race = new Map();
  const level = new Map();
  const rarity = new Map();

  for (const name of names) {
    const card = findCard(name);
    if (!card) continue;
    const line = Array.isArray(card.typeline) ? card.typeline : [];
    const isMonster =
      String(card.typeEn || '').includes('Monster') ||
      line.some((item) => ['Normal', 'Effect', 'Fusion', 'Synchro', 'XYZ', 'Link', 'Ritual'].includes(item));
    if (isMonster) bump(kind, '怪兽', 1);
    else if (String(card.typeEn || '').includes('Spell') || line.includes('Spell')) bump(kind, '魔法', 1);
    else if (String(card.typeEn || '').includes('Trap') || line.includes('Trap')) bump(kind, '陷阱', 1);

    if (isMonster) {
      const kinds = line.filter((item) => KIND_ZH[item]);
      if (kinds.length === 0) bump(monsterKind, '其他', 1);
      else for (const item of kinds.slice(0, 2)) bump(monsterKind, KIND_ZH[item], 1);
      bump(attr, ATTR_ZH[card.attrEn] || card.attrEn || '未知', 1);
      bump(race, RACE_ZH[card.raceEn] || card.raceEn || '未知', 1);
      if (card.link) bump(level, `连接 ${card.link}`, 1);
      else if (card.level) bump(level, `★${card.level}`, 1);
    }
    if (card.mdRarity) bump(rarity, card.mdRarity, 1);
  }

  return [
    { id: 'kind', title: '卡种', items: topEntries(kind) },
    { id: 'monsterKind', title: '类型', items: topEntries(monsterKind) },
    { id: 'attr', title: '属性', items: topEntries(attr) },
    { id: 'race', title: '种族', items: topEntries(race) },
    { id: 'level', title: '等级', items: topEntries(level, 14) },
    { id: 'rarity', title: '稀有度', items: topEntries(rarity) },
  ];
}

export function analyzeDeck(input) {
  const { sections, unknown } = parseDeck(input);
  const banlistData = loadBanlist();
  const issues = [];
  const all = [...sections.main, ...sections.extra, ...sections.side];

  if (unknown.length) issues.push({ level: 'error', text: `无法识别：${unknown.slice(0, 8).join('、')}${unknown.length > 8 ? '…' : ''}` });

  const mainCount = sections.main.reduce((sum, entry) => sum + entry.count, 0);
  const extraCount = sections.extra.reduce((sum, entry) => sum + entry.count, 0);
  const sideCount = sections.side.reduce((sum, entry) => sum + entry.count, 0);

  if (mainCount < 40 || mainCount > 60) issues.push({ level: 'error', text: `主卡组 ${mainCount} 张（需 40–60）` });
  if (extraCount > 15) issues.push({ level: 'error', text: `额外卡组 ${extraCount} 张（上限 15）` });
  if (sideCount > 15) issues.push({ level: 'error', text: `副卡组 ${sideCount} 张（上限 15）` });

  const byName = new Map();
  for (const entry of all) {
    if (!entry.card) continue;
    const name = entry.card.md || entry.card.cn;
    const previous = byName.get(name) || { count: 0, card: entry.card };
    previous.count += entry.count;
    byName.set(name, previous);
  }

  for (const [name, { count, card }] of byName) {
    const allowed = banlistData.current.get(Number(card.id));
    const limit = allowed === undefined ? Infinity : BANLIST_LIMIT[allowed];
    if (count > limit) {
      issues.push({ level: 'error', text: `「${name}」${count} 张，MD ${BANLIST_ZH[allowed] || '限制'}（最多 ${limit}）` });
    }
    const upcoming = banlistData.upcoming.get(Number(card.id));
    if (upcoming && upcoming !== allowed) {
      issues.push({ level: 'warn', text: `「${name}」${banlistData.upcomingDate} 起将变为 ${BANLIST_ZH[upcoming] || upcoming}` });
    }
  }

  const kind = new Map();
  const monsterKind = new Map();
  const attr = new Map();
  const race = new Map();
  const level = new Map();
  const rarity = new Map();

  for (const entry of all) {
    const card = entry.card;
    if (!card) continue;
    const line = Array.isArray(card.typeline) ? card.typeline : [];
    const isMonster = String(card.typeEn || '').includes('Monster') || line.some((item) => ['Normal', 'Effect', 'Fusion', 'Synchro', 'XYZ', 'Link', 'Ritual'].includes(item));
    if (isMonster) bump(kind, '怪兽', entry.count);
    else if (String(card.typeEn || '').includes('Spell') || line.includes('Spell')) bump(kind, '魔法', entry.count);
    else if (String(card.typeEn || '').includes('Trap') || line.includes('Trap')) bump(kind, '陷阱', entry.count);

    if (isMonster) {
      const kinds = line.filter((item) => KIND_ZH[item]);
      if (kinds.length === 0) bump(monsterKind, '其他', entry.count);
      else for (const item of kinds.slice(0, 2)) bump(monsterKind, KIND_ZH[item], entry.count);
      bump(attr, ATTR_ZH[card.attrEn] || card.attrEn || '未知', entry.count);
      bump(race, RACE_ZH[card.raceEn] || card.raceEn || '未知', entry.count);
      if (card.link) bump(level, `连接 ${card.link}`, entry.count);
      else if (card.level) bump(level, `★${card.level}`, entry.count);
    } else {
      for (const item of line) if (SPELL_TRAP_ZH[item]) { bump(monsterKind, SPELL_TRAP_ZH[item], entry.count); break; }
    }
    if (card.mdRarity) bump(rarity, card.mdRarity, entry.count);
  }

  const cards = all.map((entry) => ({
    id: entry.card?.id || 0,
    name: entry.card ? entry.card.md || entry.card.cn : entry.key,
    count: entry.count,
    section: sections.main.includes(entry) ? 'main' : sections.extra.includes(entry) ? 'extra' : 'side',
    rarity: entry.card?.mdRarity || '',
  }));

  const hasMonarch = all.some(
    (entry) => String(entry.card?.archetype || '').toLowerCase() === 'monarch' || /帝王/.test(entry.card?.cn || entry.card?.md || ''),
  );
  if (hasMonarch && extraCount > 0) {
    issues.push({ level: 'warn', text: `帝王系卡组通常需要额外卡组为空，当前额外 ${extraCount} 张，真帝王领域/开岩等效果可能不生效` });
  }

  return {
    ok: true,
    summary: { main: mainCount, extra: extraCount, side: sideCount, unique: all.length },
    sections: [
      { id: 'kind', title: '卡种', items: topEntries(kind) },
      { id: 'monsterKind', title: '类型', items: topEntries(monsterKind) },
      { id: 'attr', title: '属性', items: topEntries(attr) },
      { id: 'race', title: '种族', items: topEntries(race) },
      { id: 'level', title: '等级', items: topEntries(level, 14) },
      { id: 'rarity', title: '稀有度', items: topEntries(rarity) },
    ],
    issues,
    cards,
    banlist: { date: banlistData.date, upcomingDate: banlistData.upcomingDate },
  };
}
