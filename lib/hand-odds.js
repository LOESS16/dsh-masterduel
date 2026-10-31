// Opening-hand odds and AI-generated starter rules for dsh-masterduel.

export async function handOdds(deck, rules, mcpClient, { loadCards, deckModule }) {
  let rulesText = String(rules || '').trim();
  if (!rulesText) {
    const deckMod = await deckModule();
    const parsed = deckMod.parseDeck(deck);
    const lines = [];
    const byId = new Map(loadCards().map(({ card }) => [Number(card.id), card]));
    for (const entry of parsed.sections?.main || []) {
      const card = entry.card || byId.get(Number(entry.key));
      if (!card) continue;
      const text = String(card.descZh || '');
      if (/效果无效|无效化|把这张卡从手卡丢弃才能发动|从手卡丢弃才能发动/.test(text)) continue;
      if (/从卡组(把|选|将).{0,30}(加入手卡|特殊召唤)|从手卡.{0,20}特殊召唤|从自己的卡组.{0,20}(加入手卡|特殊召唤)/.test(text)) {
        lines.push(`${card.md || card.cn}：→ 能动`);
      }
    }
    rulesText = [...new Set(lines)].slice(0, 30).join('\n');
  }
  if (!rulesText) {
    return {
      text: '没有自动识别到动点规则。\n请在下方规则框按「卡名：→ 能动」每行一条填写，再点「用这些规则重算」。\n（灰流丽/手坑/无效类卡不会被算作动点）',
      rules: '',
    };
  }
  const text = await mcpClient.toolText('hand_odds', { deck, rules: rulesText });
  return { text, rules: rulesText };
}

export async function generateHandRules(ctx, deck, { loadCards, deckModule, callModel }) {
  const deckMod = await deckModule();
  const parsed = deckMod.parseDeck(deck);
  const names = [];
  const seen = new Set();
  const byId = new Map(loadCards().map(({ card }) => [Number(card.id), card]));
  for (const entry of parsed.sections?.main || []) {
    const card = entry.card || byId.get(Number(entry.key));
    if (!card) continue;
    const name = card.md || card.cn;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push({ name, text: String(card.descZh || '').slice(0, 240) });
  }
  if (!names.length) throw new Error('卡组里没有可识别的卡');
  const system = [
    '你是游戏王 Master Duel 的卡组分析师。',
    '目标：为 hand_odds 工具写「动点」规则，判断起手能否展开。',
    '只输出规则行，每行格式：卡名：条件 → 能动',
    '条件写「要 手里 X」「要 墓地有 X」或省略；没有额外条件就写「卡名：→ 能动」。',
    '只列真正能开始展开的卡；手坑、无效、单纯除去不算动点；不要解释、不要编号、不要 markdown。',
    '卡名必须与给出的卡名完全一致，最多 25 行。',
  ].join('\n');
  const userText = names.map((item) => `- ${item.name}：${item.text}`).join('\n');
  const text = await callModel(ctx, system, userText, 60_000);
  const known = new Set(names.map((item) => item.name));
  const textByName = new Map(names.map((item) => [item.name, item.text]));
  const rules = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter((line) => line.includes('：') && line.includes('→'))
    .map((line) => line.replace(/`/g, '').trim())
    .filter((line) => {
      const name = line.split('：')[0].trim();
      if (!known.has(name)) return false;
      const cardText = textByName.get(name) || '';
      return !/效果无效|无效化|把这张卡从手卡丢弃才能发动|从手卡丢弃才能发动/.test(cardText);
    })
    .slice(0, 25);
  return { rules: rules.join('\n'), raw: text };
}
