/**
 * dsh-masterduel — host half.
 *
 * HTTP surface under /dsh-masterduel:
 *   GET  /panel                     self-contained UI
 *   GET  /img?src=...               cached card image proxy
 *   GET  /api/health                MCP status
 *   GET  /api/image-stats           cache size + full-download estimates
 *   POST /api/image-download        start downloading all card images
 *   GET  /api/image-download-status progress
 *   GET  /api/lookup?q=...          card text + MD rarity/banlist
 *   GET  /api/search?...            effect search with MCP filters
 *   GET  /api/semantic?q=...        local natural-language effect search
 *   POST /api/ai-search             model-assisted card search (uses tokens)
 *   GET  /api/related?mode=...      mention / archetype / alias
 *   GET  /api/ranking?mode=...      deck-type ranking (Master Duel Meta)
 *   POST /api/deck                  deck check (MCP text)
 *   POST /api/deck-resolve          YDK/YDKE -> cards
 *   POST /api/deck-graph            local deck stats + banlist issues
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { McpClient, mcpRuntimeInfo } from './mcp-client.js';
import { searchEffects, findCard, loadCards } from './semantic.js';
import { handOdds, generateHandRules } from './hand-odds.js?v=1';

export const name = 'masterduel';
/** webServer for routes; llm + agentDefaultModel for AI search. */
export const inject = ['webServer', 'llm', 'agentDefaultModel'];

const PREFIX = '/dsh-masterduel';
const PANEL_PATH = new URL('./panel.html', import.meta.url);

/** Card-image cache: downloads once, then serves the local file. */
const IMG_CACHE = join(homedir(), '.cache', 'dsh-masterduel', 'images');
const IMG_HOSTS = new Set(['images.ygoprodeck.com', 's3.duellinksmeta.com', 'cdn.233.momobako.com']);

/** Small persisted UI settings (image source, alt-art preference). */
const SETTINGS_PATH = join(homedir(), '.cache', 'dsh-masterduel', 'settings.json');

function readSettings() {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
  return next;
}

function sha1(src) {
  return createHash('sha1').update(src).digest('hex');
}

/** Download one image into the local cache; returns { ok, size }. */
async function cacheImage(src, fetchSrc = src) {
  const hash = sha1(src);
  const metaPath = join(IMG_CACHE, hash + '.json');
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (meta?.file && existsSync(meta.file)) return { ok: true, size: statSync(meta.file).size };
    } catch {
      /* fall through to download */
    }
  }
  try {
    const response = await fetch(fetchSrc, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const type = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = type.includes('webp') ? '.webp' : '.jpg';
    const file = join(IMG_CACHE, hash + ext);
    mkdirSync(IMG_CACHE, { recursive: true });
    writeFileSync(file, buffer);
    writeFileSync(metaPath, JSON.stringify({ file, type }));
    return { ok: true, size: buffer.length };
  } catch (error) {
    return { ok: false, size: 0, error: error.message };
  }
}

async function serveImage(res, url) {
  const src = url.searchParams.get('src') || '';
  let parsed;
  try {
    parsed = new URL(src);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'bad src' });
  }
  if (!IMG_HOSTS.has(parsed.hostname)) return sendJson(res, 403, { ok: false, error: 'host not allowed' });

  const hash = sha1(src);
  const metaPath = join(IMG_CACHE, hash + '.json');
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (meta?.file && existsSync(meta.file)) {
        const buffer = readFileSync(meta.file);
        res.writeHead(200, {
          'content-type': meta.type || 'image/jpeg',
          'cache-control': 'public, max-age=31536000',
          'content-length': buffer.length,
          'x-img-cache': 'hit',
        });
        return res.end(buffer);
      }
    } catch {
      /* fall through to download */
    }
  }

  const result = await cacheImage(src);
  if (result.ok) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      const buffer = readFileSync(meta.file);
      res.writeHead(200, {
        'content-type': meta.type || 'image/jpeg',
        'cache-control': 'public, max-age=31536000',
        'content-length': buffer.length,
        'x-img-cache': 'miss',
      });
      return res.end(buffer);
    } catch {
      /* fall through to redirect */
    }
  }
  res.writeHead(302, { location: src });
  return res.end();
}

/** konamiID -> { normal, alt } Master Duel Meta asset ids (cached on disk). */
const MAP_CACHE = join(homedir(), '.cache', 'dsh-masterduel', 'mdm-map.json');
let mdmMap = null;
let mdmLoading = null;

async function ensureMdmMap() {
  if (mdmMap) return mdmMap;
  if (mdmLoading) return mdmLoading;
  mdmLoading = (async () => {
    try {
      if (existsSync(MAP_CACHE)) {
        const cached = JSON.parse(readFileSync(MAP_CACHE, 'utf8'));
        if (cached?.v === 3 && cached?.at && Date.now() - cached.at < 7 * 24 * 3600 * 1000 && cached.map) {
          mdmMap = new Map(Object.entries(cached.map).map(([key, value]) => [Number(key), value]));
          return mdmMap;
        }
      }
      const map = new Map();
      for (let skip = 0; skip < 60000; skip += 3000) {
        const response = await fetch(
          `https://www.masterduelmeta.com/api/v1/cards?fields=konamiID,_id,alternateArt&limit=3000&skip=${skip}`,
          { signal: AbortSignal.timeout(20_000) },
        );
        const list = await response.json();
        if (!Array.isArray(list) || !list.length) break;
        for (const item of list) {
          const key = Number(item.konamiID);
          if (!Number.isFinite(key) || key <= 0 || !item._id) continue;
          const entry = map.get(key) || {};
          if (item.alternateArt) entry.alt = entry.alt || item._id;
          else entry.normal = entry.normal || item._id;
          map.set(key, entry);
        }
        if (list.length < 3000) break;
      }
      mdmMap = map;
      try {
        mkdirSync(dirname(MAP_CACHE), { recursive: true });
        writeFileSync(MAP_CACHE, JSON.stringify({ v: 3, at: Date.now(), map: Object.fromEntries(map) }));
      } catch {
        /* best-effort cache */
      }
      return mdmMap;
    } catch {
      mdmMap = null;
      return null;
    } finally {
      mdmLoading = null;
    }
  })();
  return mdmLoading;
}

/** Wait for the MDM map, but never longer than 2s. */
async function primeMdm() {
  await Promise.race([ensureMdmMap(), new Promise((resolve) => setTimeout(resolve, 2000))]);
}

/** Local cache size + full-download estimates. */
function imageStats(source = '') {
  const cached = imgStatsCache.get(source);
  if (cached && Date.now() - cached.at < 60_000) return cached.data;
  let count = 0;
  let bytes = 0;
  try {
    for (const entry of readdirSync(IMG_CACHE)) {
      if (entry.endsWith('.json')) continue;
      count += 1;
      bytes += statSync(join(IMG_CACHE, entry)).size;
    }
  } catch {
    /* no cache yet */
  }
  const totalCards = loadCards().length;
  let sourceStats = null;
  if (['ygo', 'cn', 'md'].includes(source)) {
    try {
      const urls = allImageSources(source);
      let cached = 0;
      for (const src of urls) {
        if (existsSync(join(IMG_CACHE, sha1(src) + '.json'))) cached += 1;
      }
      sourceStats = { key: source, cached, total: urls.length };
    } catch {
      /* ignore source stats errors */
    }
  }
  const result = { count, bytes, totalCards, source: sourceStats, estimate: { ygo: totalCards * 160 * 1024, md: totalCards * 60 * 1024, cn: totalCards * 90 * 1024 } };
  imgStatsCache.set(source, { at: Date.now(), data: result });
  return result;
}
const imgStatsCache = new Map();

function pruneImageCache(limitMB) {
  const limit = Number(limitMB) * 1024 * 1024;
  if (!Number.isFinite(limit) || limit <= 0) return { removed: 0, freed: 0, bytes: 0 };
  let files = [];
  let total = 0;
  try {
    for (const entry of readdirSync(IMG_CACHE)) {
      if (entry.endsWith('.json')) continue;
      const file = join(IMG_CACHE, entry);
      const stat = statSync(file);
      files.push({ file, entry, size: stat.size, mtime: stat.mtimeMs });
      total += stat.size;
    }
  } catch {
    return { removed: 0, freed: 0, bytes: 0 };
  }
  if (total <= limit) return { removed: 0, freed: 0, bytes: total };
  files.sort((a, b) => a.mtime - b.mtime);
  let removed = 0;
  let freed = 0;
  const target = limit * 0.85;
  for (const item of files) {
    if (total <= target) break;
    try {
      rmSync(item.file, { force: true });
      rmSync(join(IMG_CACHE, item.entry.replace(/\.[^.]+$/, '') + '.json'), { force: true });
      total -= item.size;
      freed += item.size;
      removed += 1;
    } catch {
      /* skip locked file */
    }
  }
  imgStatsCache.clear();
  return { removed, freed, bytes: total };
}

const download = { running: false, source: null, total: 0, done: 0, downloaded: 0, skipped: 0, fallback: 0, failed: 0, failures: [], bytes: 0, startedAt: 0, finishedAt: 0 };

const IMG_FALLBACK_FILE = join(IMG_CACHE, 'image-fallbacks.json');
const IMG_FAILURES_FILE = join(IMG_CACHE, 'image-failures.json');
let lastFailures = [];
try {
  if (existsSync(IMG_FAILURES_FILE)) {
    lastFailures = JSON.parse(readFileSync(IMG_FAILURES_FILE, 'utf8'));
    if (!Array.isArray(lastFailures)) lastFailures = [];
  }
} catch {
  lastFailures = [];
}
const imageFallbacks = new Map();
try {
  if (existsSync(IMG_FALLBACK_FILE)) {
    for (const [id, info] of Object.entries(JSON.parse(readFileSync(IMG_FALLBACK_FILE, 'utf8')))) {
      imageFallbacks.set(Number(id), info);
    }
  }
} catch {
  /* ignore a broken fallback file */
}

function saveImageFallbacks() {
  try {
    mkdirSync(IMG_CACHE, { recursive: true });
    writeFileSync(IMG_FALLBACK_FILE, JSON.stringify(Object.fromEntries(imageFallbacks)));
  } catch {
    /* ignore write errors */
  }
}

function imageSourceUrl(id, source) {
  if (source === 'cn') return `https://cdn.233.momobako.com/ygopro/pics/${id}.jpg`;
  if (source === 'md') {
    const entry = mdmMap?.get(Number(id));
    if (entry?.normal) return `https://s3.duellinksmeta.com/cards/${entry.normal}_w420.webp`;
    return `https://images.ygoprodeck.com/images/cards/${id}.jpg`;
  }
  if (source === 'ygo_small') return `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`;
  if (source === 'ygo_cropped') return `https://images.ygoprodeck.com/images/cards_cropped/${id}.jpg`;
  return `https://images.ygoprodeck.com/images/cards/${id}.jpg`;
}

function allImageEntries(source) {
  const list = [];
  const seen = new Set();
  for (const { card } of loadCards()) {
    if (!card?.id || seen.has(card.id)) continue;
    seen.add(card.id);
    list.push({ id: Number(card.id), source, src: imageSourceUrl(card.id, source) });
  }
  return list;
}

function imageFallbackCandidates(id, source) {
  const order =
    source === 'cn'
      ? ['ygo', 'ygo_small', 'ygo_cropped', 'md']
      : source === 'ygo'
        ? ['cn', 'ygo_small', 'ygo_cropped', 'md']
        : ['cn', 'ygo', 'ygo_small', 'ygo_cropped'];
  return order.map((key) => ({ source: key, src: imageSourceUrl(id, key) }));
}

function allImageSources(source) {
  return allImageEntries(source).map((entry) => entry.src);
}

async function startImageDownload(source, limit = 0, onlyFailures = false) {
  if (download.running) return download;
  Object.assign(download, { running: true, source, total: 0, done: 0, downloaded: 0, skipped: 0, fallback: 0, failed: 0, failures: [], bytes: 0, startedAt: Date.now(), finishedAt: 0 });
  (async () => {
    try {
      await primeMdm();
      let entries = allImageEntries(source);
      if (onlyFailures && lastFailures.length) {
        const ids = new Set(lastFailures.map((item) => String(item.id)));
        entries = entries.filter((entry) => ids.has(String(entry.id)));
      }
      if (limit > 0) entries.length = Math.min(entries.length, limit);
      download.total = entries.length;
      const nameById = new Map(loadCards().map(({ card }) => [Number(card.id), card.md || card.cn || '']));
      let index = 0;
      const worker = async () => {
        while (index < entries.length) {
          const entry = entries[index];
          index += 1;
          const metaPath = join(IMG_CACHE, sha1(entry.src) + '.json');
          const already = existsSync(metaPath);
          const candidates = [{ source, src: entry.src }, ...imageFallbackCandidates(entry.id, source)];
          let firstError = '';
          const errors = [];
          let result = null;
          let used = null;
          for (let i = 0; i < candidates.length; i += 1) {
            const candidate = candidates[i];
            result = await cacheImage(entry.src, candidate.src);
            if (result.ok) {
              used = candidate;
              break;
            }
            errors.push({ source: candidate.source, error: result.error || 'unavailable' });
            if (i === 0) firstError = result.error || '原图源不可用';
          }
          if (result?.ok) {
            download.done += 1;
            download.bytes += result.size || 0;
            if (already) download.skipped += 1;
            else download.downloaded += 1;
            if (used && used.source !== source) {
              download.fallback += 1;
              imageFallbacks.set(entry.id, { from: source, to: used.source, reason: firstError || '原图源不可用' });
              saveImageFallbacks();
            } else if (used && !already) {
              imageFallbacks.delete(entry.id);
            }
          } else {
            download.failed += 1;
            if (download.failures.length < 100) download.failures.push({ id: entry.id, name: nameById.get(entry.id) || '', source, errors });
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
    } finally {
      download.running = false;
      download.finishedAt = Date.now();
      imgStatsCache.clear();
      pruneImageCache(readSettings().imageCacheLimitMB);
      if (download.failures.length) {
        lastFailures = download.failures.map((item) => ({ ...item, at: Date.now() }));
        try {
          mkdirSync(IMG_CACHE, { recursive: true });
          writeFileSync(IMG_FAILURES_FILE, JSON.stringify(lastFailures));
        } catch {
          /* ignore write errors */
        }
      } else {
        lastFailures = [];
        try { rmSync(IMG_FAILURES_FILE, { force: true }); } catch { /* ignore */ }
      }
      saveImageFallbacks();
    }
  })();
  return download;
}

setInterval(() => {
  try {
    if (!download.running && lastFailures.length && readSettings().autoRetryImages) {
      startImageDownload(lastFailures[0].source || 'cn', 0, true);
    }
  } catch {
    /* ignore auto-retry errors */
  }
}, 10 * 60_000).unref?.();

/** deck.js is loaded lazily; the ?v= suffix busts Node's ESM cache after edits. */
let deckModulePromise;
function deckModule() {
  deckModulePromise ||= import('./deck.js?v=6');
  return deckModulePromise;
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(html),
  });
  res.end(html);
}

async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** True when a "「name」..." line is a real card, not a "fuzzy matches" header. */
function isCardLine(name, rest) {
  if (!name) return false;
  const next = String(rest || '').trim().charAt(0);
  return /[A-Za-z0-9|\[]/.test(next);
}

/** Split MCP text output into card blocks (lookup uses "-----", search one per line).
 * Lookup may prefix a "「query」有 N 张卡匹配…" header line; that is not a card.
 */
function splitCards(text) {
  const raw = String(text || '');
  if (/\n-{5,}\n/.test(raw)) {
    return raw
      .split(/\n-{5,}\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const firstLine = block.split('\n')[0] || '';
        const match = /^「(.+?)」\s*(.*)$/.exec(firstLine);
        return match && isCardLine(match[1], match[2]) ? { name: match[1], body: block } : null;
      })
      .filter(Boolean);
  }
  const cards = [];
  for (const line of raw.split('\n').map((value) => value.trim())) {
    const match = /^「(.+?)」\s*(.*)$/.exec(line);
    if (match && isCardLine(match[1], match[2])) cards.push({ name: match[1], body: line });
  }
  return cards;
}

/** Attach local id, image URLs (YGOPRODeck / MD normal / MD alt) and card details. */
function withImages(cards) {
  return cards.map((card) => {
    const local = findCard(card.name);
    if (!local) return card;
    const entry = mdmMap?.get(Number(local.id));
    return {
      ...card,
      id: local.id,
      image: `https://images.ygoprodeck.com/images/cards/${local.id}.jpg`,
      cnImage: `https://cdn.233.momobako.com/ygopro/pics/${local.id}.jpg`,
      mdImage: entry?.normal ? `https://s3.duellinksmeta.com/cards/${entry.normal}_w420.webp` : undefined,
      altImage: entry?.alt ? `https://s3.duellinksmeta.com/cards/${entry.alt}_w420.webp` : undefined,
      effect: local.descZh || '',
      type: String(local.typesZh || '').split('\n')[0],
      level: local.level || local.link || null,
      atk: local.atk ?? null,
      def: local.def ?? null,
      attr: local.attrEn || '',
      race: local.raceEn || '',
      rarity: local.mdRarity || '',
    };
  });
}

async function callModel(ctx, system, userText, timeoutMs = 45_000) {
  const selection = ctx.agentDefaultModel?.currentSelection?.();
  const llm = ctx.llm;
  if (!selection?.provider || !selection?.model || typeof llm?.stream !== 'function') {
    throw new Error('LLM 不可用（缺少 provider/model 或 llm.stream）');
  }
  const { BlockAssembler, createUserMessage } = await import('@deepseek-ai/dsh-llm');
  const assembler = new BlockAssembler();
  for await (const chunk of llm.stream({
    provider: selection.provider,
    model: selection.model,
    sessionId: 'dsh-masterduel',
    system,
    messages: [createUserMessage({ content: [{ type: 'text', text: userText }], source: { kind: 'user' } })],
    temperature: 0.2,
    signal: AbortSignal.timeout(timeoutMs),
  })) {
    assembler.push(chunk);
  }
  return assembler
    .blocks()
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/**
 * Two model calls: plan (names + phrases) verified against the card database,
 * then a re-rank of the survivors with a short reason per card.
 */
function isAttributeChangeQuery(query) {
  return /属性/.test(query) && /(变成|改变|更改|变换)/.test(query) && /(怪兽|怪)/.test(query);
}

function attributeChangeRelevant(card, query) {
  const body = String(card.body || card.effect || '').replace(/\s+/g, '');
  const type = String(card.type || '');
  if (!body.includes('属性')) return false;
  const changesOther = [
    /(场上|表侧表示).{0,30}(怪兽|怪).{0,30}变成.{0,12}(属性|[光暗炎水风地神]属性)/,
  ].some((pattern) => pattern.test(body));
  if (!changesOther) return false;
  const affectsField = /(场上所有|场上全部|双方场上|场上的表侧表示|场上表侧表示)/.test(body);
  if (/对方/.test(query) && !affectsField) return false;
  if (/对方回合/.test(query) && !/(对方回合|速攻魔法|陷阱)/.test(type + body)) return false;
  return true;
}

function attributeLocalCandidates(query) {
  const result = [];
  for (const { card } of loadCards()) {
    const type = String(card.typesZh || '').split('\n')[0];
    const body = [type, card.descZh || ''].filter(Boolean).join('\n');
    const item = {
      name: card.md || card.cn,
      id: card.id,
      type,
      body,
      effect: card.descZh || '',
      level: card.level,
      atk: card.atk,
      def: card.def,
      rarity: card.mdRarity || '',
      reason: '卡文明确写有场上怪兽属性变化',
    };
    if (attributeChangeRelevant(item, query)) result.push(item);
    if (result.length >= 10) break;
  }
  return result;
}

function isSummonCountQuery(query) {
  return /(上级召唤|通常召唤)/.test(query) && /(次数|增加|最多|[23]次)/.test(query);
}

function summonCountRelevant(card) {
  const body = String(card.body || card.effect || '').replace(/\s+/g, '');
  if (/不能通常召唤/.test(body)) return false;
  return /通常召唤最多[23]次|(增加|追加).{0,8}通常召唤|通常召唤.{0,8}(次数|回数).{0,8}(增加|追加)/.test(body);
}

function summonCountLocalCandidates() {
  const result = [];
  for (const { card } of loadCards()) {
    const type = String(card.typesZh || '').split('\n')[0];
    const body = [type, card.descZh || ''].filter(Boolean).join('\n');
    const item = {
      name: card.md || card.cn,
      id: card.id,
      type,
      body,
      effect: card.descZh || '',
      level: card.level,
      atk: card.atk,
      def: card.def,
      rarity: card.mdRarity || '',
      reason: '卡文明确写有增加通常召唤次数',
    };
    if (summonCountRelevant(item)) result.push(item);
    if (result.length >= 10) break;
  }
  return result;
}

async function aiSearch(ctx, mcp, query) {
  const system = [
    '你是游戏王 Master Duel 的卡库检索助手。',
    '用户会用自然语言描述想要的效果，你需要给出最可能匹配的卡名与卡文片段。',
    '只输出一个 JSON 对象，不要 Markdown、不要解释。',
    '格式：{"names":["中文卡名"],"phrases":["卡文片段"]}',
    'names：你确信存在于 Master Duel 的中文官方卡名，按可能性排序，最多 8 个；不确定的不要写。',
    'phrases：卡文里可能出现的连续片段（用于全文检索），最多 4 个。',
    '注意：上级召唤是通常召唤的一种；用户说“增加上级召唤次数”时，也要考虑卡文写“通常召唤最多2/3次”的卡。',
    '示例：描述「通常召唤次数增加1次」→ {"names":["二重召唤","撕裂时间的绿柱魔瞳"],"phrases":["通常召唤最多2次"]}',
  ].join('\n');

  const text = await callModel(ctx, system, `描述：${query}`);
  if (!text) throw new Error('模型没有返回内容');
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new Error('模型没有返回 JSON');
  const plan = JSON.parse(match[0]);
  const names = Array.isArray(plan.names)
    ? plan.names.filter((value) => typeof value === 'string' && value.trim()).slice(0, 8)
    : [];
  const phrases = Array.isArray(plan.phrases)
    ? plan.phrases.filter((value) => typeof value === 'string' && value.trim()).slice(0, 4)
    : [];

  const merged = new Map();
  const add = (card) => {
    if (card?.name && !merged.has(card.name)) merged.set(card.name, card);
  };
  for (const name of names) {
    try {
      splitCards(await mcp.toolText('lookup_cards', { queries: [name] })).forEach(add);
    } catch {
      /* ignore one bad name */
    }
  }
  for (const phrase of phrases) {
    try {
      splitCards(await mcp.toolText('search_cards', { text: [phrase], limit: 12 })).forEach(add);
    } catch {
      /* ignore */
    }
  }
  if (isAttributeChangeQuery(query)) {
    for (const card of attributeLocalCandidates(query)) merged.set(card.name, card);
  }
  if (isSummonCountQuery(query)) {
    for (const card of summonCountLocalCandidates()) merged.set(card.name, card);
  }

  let cards = [...merged.values()].slice(0, 25);

  let reranked = false;
  if (cards.length > 1) {
    try {
      const list = cards
        .slice(0, 20)
        .map((card, index) => `${index + 1}. ${card.name}：${card.body.replace(/\s+/g, ' ').slice(0, 110)}`)
        .join('\n');
      const rankSystem = [
        '你是游戏王 Master Duel 卡库顾问。',
        '用户描述想要的效果，下面是候选卡。请逐条核对卡文，只保留真正符合的。',
        '不要选择只改变自身属性的卡，也不要因为卡文里出现过某个词就选它；条件必须是卡文明确支持的。',
        '只输出 JSON：{"items":[{"name":"卡名","reason":"不超过30字的匹配理由，必须引用卡文依据"}]}，最多 10 条；宁缺毋滥。',
        '卡名必须来自候选，不要编造。',
      ].join('\n');
      const ranked = await callModel(ctx, rankSystem, `描述：${query}\n候选：\n${list}`);
      const rankedMatch = /\{[\s\S]*\}/.exec(ranked);
      if (rankedMatch) {
        const parsed = JSON.parse(rankedMatch[0]);
        const items = Array.isArray(parsed.items) ? parsed.items : [];
        const byName = new Map(cards.map((card) => [card.name, card]));
        const used = new Set();
        const ordered = [];
        for (const item of items) {
          if (!item || typeof item.name !== 'string') continue;
          const card = byName.get(item.name);
          if (!card || used.has(card.name)) continue;
          used.add(card.name);
          ordered.push({ ...card, reason: typeof item.reason === 'string' ? item.reason.slice(0, 60) : '' });
        }
        if (ordered.length) {
          cards = ordered;
          reranked = true;
        }
      }
    } catch {
      /* keep model-free order */
    }
  }

  if (isAttributeChangeQuery(query)) {
    const local = attributeLocalCandidates(query);
    const known = new Set(cards.map((card) => card.name));
    for (const card of local) {
      if (!known.has(card.name)) {
        known.add(card.name);
        cards.push(card);
      }
    }
    cards = cards.filter((card) => attributeChangeRelevant(card, query)).slice(0, 10);
  }
  if (isSummonCountQuery(query)) {
    const local = summonCountLocalCandidates();
    const known = new Set(cards.map((card) => card.name));
    for (const card of local) {
      if (!known.has(card.name)) {
        known.add(card.name);
        cards.push(card);
      }
    }
    cards = cards.filter((card) => summonCountRelevant(card)).slice(0, 10);
  }

  // Do not present a broad local semantic dump as an AI result. Without a
  // successful model re-rank (or a specific verified filter above), an
  // unverified candidate list is exactly what produces unrelated tail cards.
  const verified = reranked || cards.length === 1 || isAttributeChangeQuery(query) || isSummonCountQuery(query);
  if (!verified) cards = [];
  cards = cards.slice(0, 10);

  return { cards: withImages(cards), plan: { names, phrases, reranked } };
}

/** Deck-type ranking from Master Duel Meta (cached 10 minutes per mode). */
const rankCache = new Map();
const labelCache = new Map();
const DECK_ALIASES = { 'sky striker': '闪刀姬' };

/** Longest Chinese substring appearing in at least half of a group. */
function commonLabel(names) {
  const total = names.length;
  const counts = new Map();
  for (const name of names) {
    const runs = name.match(/[\u4e00-\u9fff]{2,}/g) || [];
    const seen = new Set();
    for (const run of runs) {
      for (let length = 2; length <= Math.min(6, run.length); length += 1) {
        for (let index = 0; index + length <= run.length; index += 1) {
          const gram = run.slice(index, index + length);
          if (!seen.has(gram)) {
            seen.add(gram);
            counts.set(gram, (counts.get(gram) || 0) + 1);
          }
        }
      }
    }
  }
  let best = '';
  let bestCount = 0;
  for (const [gram, count] of counts) {
    if (count < Math.max(3, total * 0.5)) continue;
    if (gram.length > best.length || (gram.length === best.length && count > bestCount)) {
      best = gram;
      bestCount = count;
    }
  }
  return best;
}

function deckLabel(name) {
  const key = String(name || '').toLowerCase();
  if (!key) return '';
  if (labelCache.has(key)) return labelCache.get(key);
  if (Object.hasOwn(DECK_ALIASES, key)) {
    labelCache.set(key, DECK_ALIASES[key]);
    return DECK_ALIASES[key];
  }
  const names = [];
  for (const { card } of loadCards()) {
    if (String(card.archetype || '').toLowerCase() === key) names.push(card.md || card.cn);
  }
  const label = names.length >= 3 ? commonLabel(names.slice(0, 200)) : '';
  labelCache.set(key, label);
  return label;
}

function zhDeckName(name) {
  const exact = deckLabel(name);
  if (exact) return exact;
  const parts = String(name || '').split(/\s+/);
  for (let index = 1; index < parts.length; index += 1) {
    const left = deckLabel(parts.slice(0, index).join(' '));
    const right = deckLabel(parts.slice(index).join(' '));
    if (left && right) return `${left} ${right}`;
  }
  return parts.map((part) => deckLabel(part) || part).join(' ');
}

/** Resolve MDM card ids to konami ids in one batch. */
async function mdmCardInfos(ids) {
  const map = new Map();
  for (let start = 0; start < ids.length; start += 50) {
    const chunk = ids.slice(start, start + 50);
    try {
      const response = await fetch(
        `https://www.masterduelmeta.com/api/v1/cards?_id[$in]=${chunk.join(',')}&fields=name,konamiID`,
        { signal: AbortSignal.timeout(10_000) },
      );
      const list = await response.json();
      for (const item of Array.isArray(list) ? list : []) {
        if (item?._id && item.konamiID) map.set(item._id, Number(item.konamiID));
      }
    } catch {
      /* ignore one chunk */
    }
  }
  return map;
}

async function loadRanking(mode, fresh = false) {
  const key = ['power', 'pop', 'master'].includes(mode) ? mode : 'power';
  const hit = rankCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit;
  await primeMdm();
  const sort = key === 'pop' ? 'popRank' : key === 'master' ? 'masterPopRank' : 'power';
  const response = await fetch(
    `https://www.masterduelmeta.com/api/v1/deck-types?sort=-${sort}&limit=30&fields=name,power,popRank,masterPopRank,card`,
    { signal: AbortSignal.timeout(10_000) },
  );
  const list = await response.json();
  const base = (Array.isArray(list) ? list : []).map((item) => ({
    _id: item._id,
    name: item.name,
    cardId: item.card || null,
    zh: zhDeckName(item.name),
    power: item.power ?? null,
    popRank: item.popRank ?? null,
    masterPopRank: item.masterPopRank ?? null,
  }));
  const konami = await mdmCardInfos(base.map((item) => item.cardId).filter(Boolean));
  const items = base.map((item) => {
    const konamiId = konami.get(item.cardId);
    const entry = konamiId ? mdmMap?.get(konamiId) : null;
    const s3 = item.cardId ? `https://s3.duellinksmeta.com/cards/${item.cardId}_w420.webp` : undefined;
    return {
      ...item,
      image: s3,
      ygoImage: konamiId ? `https://images.ygoprodeck.com/images/cards/${konamiId}.jpg` : s3,
      cnImage: konamiId ? `https://cdn.233.momobako.com/ygopro/pics/${konamiId}.jpg` : undefined,
      mdImage: s3,
      altImage: entry?.alt ? `https://s3.duellinksmeta.com/cards/${entry.alt}_w420.webp` : undefined,
    };
  });
  const result = { at: Date.now(), sort, items };
  rankCache.set(key, result);
  return result;
}

/** Archetype series ranked by MD release date (local card dump has mdRelease). */
async function loadSeriesRanking(order = 'new') {
  const groups = new Map();
  for (const { card } of loadCards()) {
    const archetype = String(card.archetype || '').trim();
    if (!archetype) continue;
    if (!groups.has(archetype)) groups.set(archetype, []);
    groups.get(archetype).push(card);
  }
  const items = [];
  for (const [archetype, cards] of groups) {
    if (cards.length < 2) continue;
    let first = '';
    let last = '';
    let rep = null;
    for (const card of cards) {
      const date = String(card.mdRelease || '');
      if (!date) continue;
      if (!first || date < first) {
        first = date;
        rep = card;
      }
      if (!last || date > last) last = date;
    }
    if (!first || !rep) continue;
    // Series name should reflect the cards as they were when the series debuted,
    // not the later support (whose wording may differ).
    const firstNames = cards
      .filter((card) => String(card.mdRelease || '') === first)
      .map((card) => card.md || card.cn);
    const zh = (firstNames.length >= 3 ? commonLabel(firstNames.slice(0, 200)) : '') || deckLabel(archetype);
    items.push({
      archetype,
      zh,
      count: cards.length,
      first,
      last,
      repName: rep.md || rep.cn,
    });
  }
  items.sort((a, b) =>
    order === 'old'
      ? a.last.localeCompare(b.last) || a.first.localeCompare(b.first)
      : b.last.localeCompare(a.last) || a.first.localeCompare(b.first),
  );
  return items;
}

/** Deck-type name matching: "Monarch" should find "Monarchs". */
function pickDeckType(types, archetype) {
  const arch = String(archetype || '').toLowerCase();
  if (!arch) return null;
  const matches = types.filter((type) => {
    const name = String(type.name || '').toLowerCase();
    if (name === arch) return true;
    return name.split(/\s+/).some((token) => token === arch || token === arch + 's' || token === arch + 'es');
  });
  matches.sort((a, b) => String(a.name).length - String(b.name).length);
  return matches[0] || null;
}

let deckTypesCache = null;
let deckTypesAt = 0;

async function loadDeckTypesList() {
  if (deckTypesCache && Date.now() - deckTypesAt < 3600_000) return deckTypesCache;
  const response = await fetch('https://www.masterduelmeta.com/api/v1/deck-types?fields=name&limit=0', {
    signal: AbortSignal.timeout(10_000),
  });
  const list = await response.json();
  deckTypesCache = Array.isArray(list) ? list : [];
  deckTypesAt = Date.now();
  return deckTypesCache;
}

const breakdownCache = new Map();

async function fetchDeckTypeBreakdown(id) {
  if (breakdownCache.has(id)) return breakdownCache.get(id);
  const response = await fetch(
    `https://www.masterduelmeta.com/api/v1/deck-types?_id=${id}&fields=name,deckBreakdown`,
    { signal: AbortSignal.timeout(10_000) },
  );
  const list = await response.json();
  const deckType = Array.isArray(list) ? list[0] : list;
  const cards = deckType?.deckBreakdown?.cards || [];
  breakdownCache.set(id, cards);
  return cards;
}

const isExtraCardType = (card) => /融合|同调|超量|连接/.test(String(card?.typesZh || '').split('\n')[0] || '');

/** Suggest cards + counts to fill a deck, based on real-deck inclusion rates. */
async function smartFill(deckCards, target = 40) {
  const mainTarget = Math.min(60, Math.max(40, Number(target) || 40));
  const byId = new Map(loadCards().map(({ card }) => [Number(card.id), card]));
  const current = new Map();
  const archetypes = new Map();
  let mainNow = 0;
  let extraNow = 0;
  for (const entry of deckCards) {
    const id = Number(entry.id);
    if (!id) continue;
    const count = Math.max(1, Number(entry.count) || 1);
    current.set(id, (current.get(id) || 0) + count);
    if (entry.section === 'extra') extraNow += count;
    else if (entry.section !== 'side') mainNow += count;
    const card = byId.get(id);
    const archetype = String(card?.archetype || '').trim();
    if (archetype) archetypes.set(archetype, (archetypes.get(archetype) || 0) + count);
  }
  const archetype = [...archetypes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  // Monarch decks normally keep the Extra Deck empty (Domain / Erupt / Awaken).
  const noExtra = /^monarch/i.test(archetype) || archetype.includes('帝王');
  const types = await loadDeckTypesList();
  const deckType = pickDeckType(types, archetype);
  const breakdown = deckType ? await fetchDeckTypeBreakdown(deckType._id) : [];
  const konami = await mdmCardInfos(breakdown.map((item) => item.card).filter(Boolean));

  const candidates = [];
  for (const item of breakdown) {
    const local = byId.get(konami.get(item.card));
    if (!local) continue;
    // Pure-Monarch lists can't use cards that send from / summon with the Extra Deck.
    if (noExtra && /从额外卡组/.test(String(local.descZh || ''))) continue;
    const section = isExtraCardType(local) ? 'extra' : 'main';
    const target = Math.max(1, Math.min(3, Math.round(item.avgAt || 1)));
    const have = current.get(Number(local.id)) || 0;
    if (have >= target) continue;
    candidates.push({
      id: local.id,
      name: local.md || local.cn,
      section,
      count: target - have,
      per: item.per ?? null,
      avgAt: item.avgAt ?? null,
      type: String(local.typesZh || '').split('\n')[0],
    });
  }
  let fallbackUsed = false;
  if (!deckType && archetype) {
    fallbackUsed = true;
    for (const card of byId.values()) {
      if (String(card.archetype || '').trim() !== archetype) continue;
      const section = isExtraCardType(card) ? 'extra' : 'main';
      const have = current.get(Number(card.id)) || 0;
      const target = 3;
      if (have >= target) continue;
      candidates.push({
        id: card.id,
        name: card.md || card.cn,
        section,
        count: target - have,
        per: null,
        avgAt: null,
        type: String(card.typesZh || '').split('\n')[0],
      });
    }
  }

  candidates.sort((a, b) => (b.avgAt || 0) - (a.avgAt || 0) || (b.per || 0) - (a.per || 0));

  const suggestions = [];
  let mainAdd = 0;
  let extraAdd = 0;
  const mainNeed = Math.max(0, mainTarget - mainNow);
  const extraNeed = noExtra ? 0 : Math.max(0, 15 - extraNow);
  for (const candidate of candidates) {
    const need = candidate.section === 'extra' ? extraNeed - extraAdd : mainNeed - mainAdd;
    if (need <= 0) continue;
    const count = Math.min(candidate.count, need);
    if (count <= 0) continue;
    suggestions.push({ ...candidate, count });
    if (candidate.section === 'extra') extraAdd += count;
    else mainAdd += count;
  }

  const enriched = withImages(suggestions.map((item) => ({ name: item.name, body: '' })));
  return {
    archetype,
    deckType: deckType?.name || null,
    target: mainTarget,
    total: { main: mainNow, extra: extraNow },
    need: { main: mainNeed, extra: extraNeed },
    suggestions: suggestions.map((item, index) => ({
      ...item,
      image: enriched[index]?.image,
      cnImage: enriched[index]?.cnImage,
      mdImage: enriched[index]?.mdImage,
      altImage: enriched[index]?.altImage,
      effect: enriched[index]?.effect,
    })),
    note: noExtra
      ? (extraNow > 0 ? '帝王系卡组通常不带额外卡组；当前额外有卡，部分效果可能不生效' : '帝王系卡组通常保持额外卡组为空，已跳过额外建议')
      : fallbackUsed ? '没有找到该系列的主流卡组数据，按同系列卡兜底（建议张数为默认值）'
      : deckType ? `依据 ${deckType.name} 的真实卡组投入率` : '没有找到该系列的主流卡组数据',
  };
}

/** Ask the model for plausible combo lines from the current deck's card texts. */
async function verifyCombo(mcp, deckCards, handNames, tiersOverride = '') {
  const byId = new Map(loadCards().map(({ card }) => [Number(card.id), card]));
  const sections = { main: [], extra: [], side: [] };
  for (const entry of deckCards) {
    const section = ['main', 'extra', 'side'].includes(entry.section) ? entry.section : 'main';
    for (let i = 0; i < (entry.count || 1); i += 1) sections[section].push(String(entry.id));
  }
  const ydk = ['#main', ...sections.main, '#extra', ...sections.extra, '!side', ...sections.side].join('\n');
  const hand = handNames.filter((name) => typeof name === 'string' && name.trim()).slice(0, 5).join(',');
  if (!hand) throw new Error('这条连击没有起手卡');
  const tiers = String(tiersOverride || '').trim() || buildTiers(deckCards, byId);
  const text = await mcp.toolText('plan_hand', { deck: ydk, hand, tiers, seconds: 45 });
  return { text, tiers, hand };
}

/** Card inclusion rates of one deck type (real decks). */
const deckBreakdownCache = new Map();

async function loadDeckBreakdown(id) {
  const cached = deckBreakdownCache.get(id);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.data;
  const response = await fetch(
    `https://www.masterduelmeta.com/api/v1/deck-types?_id=${id}&fields=name,deckBreakdown`,
    { signal: AbortSignal.timeout(10_000) },
  );
  const list = await response.json();
  const deckType = Array.isArray(list) ? list[0] : list;
  const cards = deckType?.deckBreakdown?.cards || [];
  const konami = await mdmCardInfos(cards.map((item) => item.card).filter(Boolean));
  const byId = new Map(loadCards().map(({ card }) => [Number(card.id), card]));
  const items = [];
  for (const item of cards) {
    const local = byId.get(konami.get(item.card));
    if (!local) continue;
    items.push({
      id: local.id,
      name: local.md || local.cn,
      per: item.per ?? null,
      avgAt: item.avgAt ?? null,
      section: isExtraCardType(local) ? 'extra' : 'main',
    });
  }
  const enriched = withImages(items.map((item) => ({ name: item.name, body: '' })));
  const result = {
    name: deckType?.name || '',
    items: items.map((item, index) => ({
      ...item,
      image: enriched[index]?.image,
      cnImage: enriched[index]?.cnImage,
      mdImage: enriched[index]?.mdImage,
      altImage: enriched[index]?.altImage,
    })),
  };
  deckBreakdownCache.set(id, { at: Date.now(), data: result });
  return result;
}

/** Roughly mark cards that can start a play, for hand_odds default rules. */
/** Analyze engine-sampled openings and point out deck problems. */
function extractJsonObject(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to brace matching */
  }
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function analyzeSamples(ctx, deckCards, samples) {
  const byId = new Map(loadCards().map(({ card }) => [Number(card.id), card]));
  const lines = [];
  for (const entry of deckCards) {
    const card = byId.get(Number(entry.id));
    if (!card) continue;
    lines.push(`- ${card.md || card.cn} ×${entry.count || 1}：${String(card.descZh || '').replace(/\s+/g, ' ').slice(0, 200)}`);
    if (lines.length >= 20) break;
  }
  const sampleText = samples
    .slice(0, 5)
    .map((sample, index) => {
      const hand = (sample.hand || []).join('、');
      const label = sample.side || '先手';
      return `【${index + 1}】${label}：${hand || '（概率统计，无具体手牌）'}\n${String(sample.text || '').slice(0, 900)}`;
    })
    .join('\n\n');
  const system = [
    '你是游戏王 Master Duel 的卡组分析师。',
    '下面是同一套卡组的先手/后手实测与概率数据，请找出这套卡组的问题：卡手、展开薄弱、路线依赖、终场弱、资源断档、先后手需求过高等；后手概率数据不含路线模拟，分析时要说明依据有限。',
    '用中文回答；issues 与 suggestions 各至少 2 条；建议要具体到调整哪张卡（加/减几张）并说明理由。',
    '只输出一个 JSON 对象，不要 markdown 代码块、不要解释：{"summary":"一句话总评","issues":[{"title":"问题","detail":"依据","severity":"高|中|低"}],"suggestions":[{"action":"调整描述","reason":"理由","remove":[{"name":"卡名","count":1}],"add":[{"name":"卡名","count":1}]}]}',
    'remove 只能引用卡组里已有的卡；add 用真实卡名；count 1-3；没有增删就省略数组。引用卡名必须真实，不要空泛。',
  ].join('\n');
  const userText = `卡组：\n${lines.join('\n')}\n\n实测结果：\n${sampleText}`;
  let text = await callModel(ctx, system, userText, 90_000);
  let parsed = extractJsonObject(text);
  if (!parsed) {
    const retrySystem = '只输出一个 JSON 对象，不要 markdown 代码块、不要解释。用中文。格式：{"summary":"...","issues":[{"title":"...","detail":"...","severity":"高"}],"suggestions":[{"action":"...","reason":"...","remove":[{"name":"...","count":1}],"add":[{"name":"...","count":1}]}]}。issues 和 suggestions 各至少 2 条。';
    text = await callModel(ctx, retrySystem, userText, 90_000);
    parsed = extractJsonObject(text);
  }
  const raw = String(text || '').slice(0, 3000);
  const parseOps = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((item) => item && typeof item.name === 'string')
      .slice(0, 5)
      .map((item) => ({ name: item.name.slice(0, 30), count: Math.max(1, Math.min(3, Number(item.count) || 1)) }));
  if (!parsed) return { summary: '', issues: [], suggestions: [], raw };
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 200) : '',
    issues: (Array.isArray(parsed.issues) ? parsed.issues : []).slice(0, 6).map((issue) => ({
      title: String(issue.title || '').slice(0, 80),
      detail: String(issue.detail || '').slice(0, 300),
      severity: String(issue.severity || '').slice(0, 2),
    })),
    suggestions: (Array.isArray(parsed.suggestions) ? parsed.suggestions : []).slice(0, 6).map((item) => ({
      action: String(item.action || '').slice(0, 120),
      reason: String(item.reason || '').slice(0, 200),
      remove: parseOps(item.remove),
      add: parseOps(item.add),
    })),
    raw,
  };
}

/** Current Master Duel banlist entries (id → status). */
function readBanlist() {
  const path = join(homedir(), '.cache', 'master-duel-ai-advisor', 'md_banlist.json');
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const current = data.current || { entries: [] };
    return {
      date: current.date || '',
      entries: (current.entries || []).map((entry) => ({ id: Number(entry.id), name: entry.name, status: entry.status })),
    };
  } catch {
    return { date: '', entries: [] };
  }
}

/** Chinese label → archetype, used to link cards whose archetype field is empty. */
let archetypeLabelMap = null;

function getArchetypeLabelMap() {
  if (archetypeLabelMap) return archetypeLabelMap;
  const groups = new Map();
  for (const { card } of loadCards()) {
    const archetype = String(card.archetype || '').trim();
    if (!archetype) continue;
    if (!groups.has(archetype)) groups.set(archetype, []);
    groups.get(archetype).push(card.md || card.cn);
  }
  archetypeLabelMap = new Map();
  for (const [archetype, names] of groups) {
    const label = commonLabel(names.filter(Boolean));
    if (label && label.length >= 2 && !archetypeLabelMap.has(label)) archetypeLabelMap.set(label, archetype);
  }
  return archetypeLabelMap;
}

export function apply(ctx) {
  const mcp = new McpClient();
  const token = randomBytes(16).toString('hex');
  ctx.logger?.info?.(`[dsh-masterduel] MCP: ${mcp.script}`);

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const route = url.pathname.slice(PREFIX.length) || '/';
        try {
          if (route.startsWith('/api/') && req.headers['x-md-token'] !== token) {
            return sendJson(res, 401, { ok: false, error: 'unauthorized' });
          }

          if (req.method === 'GET' && (route === '/panel' || route === '/panel/')) {
            const html = readFileSync(PANEL_PATH, 'utf8').replaceAll('__MD_TOKEN__', token);
            return sendHtml(res, html);
          }

          if (req.method === 'GET' && route === '/img') {
            return serveImage(res, url);
          }

          if (req.method === 'GET' && route === '/api/health') {
            const runtime = mcpRuntimeInfo(mcp.script, mcp.command);
            try {
              await mcp.ensure();
              return sendJson(res, 200, { ok: true, ...runtime });
            } catch (error) {
              return sendJson(res, 200, { ok: false, ...runtime, error: String(error?.message ?? error), lastError: mcp.lastError });
            }
          }

          if (req.method === 'POST' && route === '/api/image-cache/prune') {
            if (download.running) return sendJson(res, 409, { ok: false, error: '正在下载，先等它完成' });
            const limit = Number(readSettings().imageCacheLimitMB) || 0;
            const result = pruneImageCache(limit);
            return sendJson(res, 200, { ok: true, ...result, ...imageStats('') });
          }

          if (req.method === 'DELETE' && route === '/api/image-cache') {
            if (download.running) return sendJson(res, 409, { ok: false, error: '正在下载，先等它完成' });
            let removed = 0;
            try {
              for (const entry of readdirSync(IMG_CACHE)) {
                rmSync(join(IMG_CACHE, entry), { force: true });
                removed += 1;
              }
            } catch {
              /* nothing cached */
            }
            return sendJson(res, 200, { ok: true, removed, ...imageStats() });
          }

          if (req.method === 'GET' && route === '/api/image-stats') {
            const source = url.searchParams.get('source') || '';
            return sendJson(res, 200, { ok: true, ...imageStats(source), download });
          }

          if (req.method === 'GET' && route === '/api/image-fallbacks') {
            const items = [...imageFallbacks.entries()].map(([id, info]) => ({ id, ...info }));
            return sendJson(res, 200, { ok: true, count: items.length, items });
          }

          if (req.method === 'GET' && route === '/api/settings') {
            return sendJson(res, 200, { ok: true, ...readSettings() });
          }

          if (req.method === 'POST' && route === '/api/settings') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const patch = {};
            if (typeof body.imgSource === 'string') patch.imgSource = body.imgSource;
            if (typeof body.alt === 'boolean') patch.alt = body.alt;
            if (typeof body.autoRetryImages === 'boolean') patch.autoRetryImages = body.autoRetryImages;
            if (typeof body.autoCollapseSidebar === 'boolean') patch.autoCollapseSidebar = body.autoCollapseSidebar;
            if (body.lang === 'zh' || body.lang === 'en') patch.lang = body.lang;
            if (Number.isFinite(Number(body.imageCacheLimitMB))) patch.imageCacheLimitMB = Math.max(0, Number(body.imageCacheLimitMB));
            if (Array.isArray(body.searchHistory)) patch.searchHistory = body.searchHistory.filter((item) => typeof item === 'string').slice(0, 10);
            if (Array.isArray(body.buildHistory)) patch.buildHistory = body.buildHistory.filter((item) => typeof item === 'string').slice(0, 10);
            if (Array.isArray(body.savedSearches)) {
              patch.savedSearches = body.savedSearches
                .filter((item) => item && typeof item.name === 'string' && Array.isArray(item.cards))
                .slice(0, 20);
            }
            if (Array.isArray(body.favorites)) {
              patch.favorites = body.favorites
                .filter((item) => item && typeof item.name === 'string')
                .slice(0, 300);
            }
            return sendJson(res, 200, { ok: true, ...writeSettings(patch) });
          }

          if (req.method === 'POST' && route === '/api/image-download') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const source = body.source === 'md' ? 'md' : body.source === 'cn' ? 'cn' : 'ygo';
            const limit = Number(body.limit) > 0 ? Number(body.limit) : 0;
            if (body.onlyFailures && !lastFailures.length) {
              return sendJson(res, 400, { ok: false, error: '没有记录的失败卡图' });
            }
            const state = await startImageDownload(source, limit, Boolean(body.onlyFailures));
            return sendJson(res, 200, { ok: true, ...state });
          }

          if (req.method === 'GET' && route === '/api/image-download-status') {
            const failures = download.running
              ? download.failures
              : download.failures.length
                ? download.failures
                : lastFailures;
            const failed = download.running ? download.failed : download.failed || failures.length;
            return sendJson(res, 200, { ...download, ok: true, failures, failed });
          }

          if (req.method === 'GET' && route === '/api/banlist') {
            return sendJson(res, 200, { ok: true, ...readBanlist() });
          }

          if (req.method === 'GET' && route === '/api/lookup') {
            const q = (url.searchParams.get('q') || '').trim();
            if (!q) return sendJson(res, 400, { ok: false, error: 'q is required' });
            await primeMdm();
            const text = await mcp.toolText('lookup_cards', { queries: [q] });
            const cards = withImages(splitCards(text));
            const stats = cards.length > 1 ? (await deckModule()).statsForNames(cards.map((card) => card.name)) : undefined;
            return sendJson(res, 200, { ok: true, text, cards, stats });
          }

          if (req.method === 'GET' && route === '/api/semantic') {
            const q = (url.searchParams.get('q') || '').trim();
            if (!q) return sendJson(res, 400, { ok: false, error: 'q is required' });
            await primeMdm();
            const cards = withImages(searchEffects(q, { limit: 20 }));
            const stats = cards.length > 1 ? (await deckModule()).statsForNames(cards.map((card) => card.name)) : undefined;
            return sendJson(res, 200, { ok: true, cards, stats });
          }

          if (req.method === 'GET' && route === '/api/search') {
            const params = url.searchParams;
            const args = { limit: Math.min(200, Math.max(1, Number(params.get('limit')) || 60)) };
            const name = (params.get('q') || '').trim();
            if (name) args.name = name;
            const phrases = (params.get('text') || '')
              .split('|')
              .map((value) => value.trim())
              .filter(Boolean);
            if (phrases.length) args.text = phrases;
            const kinds = (params.get('kind') || '')
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean);
            if (kinds.length) args.kind = kinds;
            for (const key of ['race', 'attr', 'level', 'atk', 'def', 'archetype', 'rarity']) {
              const value = (params.get(key) || '').trim();
              if (value) args[key] = value;
            }
            if (
              !args.name && !args.text && !args.kind && !args.race && !args.attr && !args.level &&
              !args.atk && !args.def && !args.archetype && !args.rarity
            ) {
              return sendJson(res, 400, { ok: false, error: '至少给一个条件（效果/类型/属性/种族/等级/攻守/字段/稀有度）' });
            }
            await primeMdm();
            const text = await mcp.toolText('search_cards', args);
            const cards = withImages(splitCards(text));
            const stats = cards.length > 1 ? (await deckModule()).statsForNames(cards.map((card) => card.name)) : undefined;
            return sendJson(res, 200, { ok: true, text, cards, stats });
          }

          if (req.method === 'POST' && route === '/api/ai-search') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const q = String(body.q || '').trim();
            if (!q) return sendJson(res, 400, { ok: false, error: 'q is required' });
            await primeMdm();
            const result = await aiSearch(ctx, mcp, q);
            const cards = withImages(result.cards);
            const stats = cards.length > 1 ? (await deckModule()).statsForNames(cards.map((card) => card.name)) : undefined;
            return sendJson(res, 200, { ok: true, ...result, cards, stats });
          }

          if (req.method === 'GET' && route === '/api/related') {
            const q = (url.searchParams.get('q') || '').trim();
            const mode = url.searchParams.get('mode') || 'mention';
            if (!q) return sendJson(res, 400, { ok: false, error: 'q is required' });
            await primeMdm();

            if (mode === 'archetype') {
              const card = findCard(q);
              const archetype = card?.archetype?.trim();
              const selfName = card?.md || card?.cn || q;
              const collected = new Map();

              if (archetype) {
                const text = await mcp.toolText('search_cards', { archetype, limit: 60 });
                for (const item of withImages(splitCards(text))) {
                  if (item.name !== selfName) collected.set(item.name, item);
                }
              }

              // Cards whose text quotes a group term (e.g. 「帝王」) belong together even
              // when their archetype field is empty, like 源帝从骑特塞拉.
              const labelMap = getArchetypeLabelMap();
              const terms = [...new Set((String(card?.descZh || '').match(/「([^」]{2,10})」/g) || []).map((hit) => hit.slice(1, -1)))]
                .filter((term) => !/^(这个卡名|自己|对方|卡名|怪兽|魔法|陷阱)$/.test(term));
              if (archetype) {
                for (const [label, arch] of labelMap) {
                  if (arch === archetype && !terms.includes(label)) terms.push(label);
                }
              }
              let termLabel = '';
              if (terms.length) {
                for (const term of terms.slice(0, 4)) {
                  let targetArchetype = '';
                  for (const [label, arch] of labelMap) {
                    if (term === label || term.includes(label) || label.includes(term)) {
                      targetArchetype = arch;
                      termLabel = label;
                      break;
                    }
                  }
                  if (targetArchetype) {
                    try {
                      const text = await mcp.toolText('search_cards', { archetype: targetArchetype, limit: 60 });
                      for (const item of withImages(splitCards(text))) {
                        if (item.name !== selfName) collected.set(item.name, item);
                      }
                    } catch { /* ignore one group */ }
                  }
                  const hits = [];
                  for (const { card: other } of loadCards()) {
                    if (!other || other.id === card?.id) continue;
                    if (String(other.descZh || '').includes('「' + term + '」')) {
                      hits.push(other);
                      if (hits.length >= 40) break;
                    }
                  }
                  if (hits.length) {
                    const enriched = withImages(
                      hits.map((other) => ({
                        name: other.md || other.cn,
                        body: [`「${other.md || other.cn}」${other.mdRarity ? ' ' + other.mdRarity : ''}`, other.typesZh, other.descZh].filter(Boolean).join('\n'),
                        id: other.id,
                        image: other.id ? `https://images.ygoprodeck.com/images/cards/${other.id}.jpg` : undefined,
                        effect: other.descZh || '',
                      })),
                    );
                    for (const item of enriched) {
                      if (item.name !== selfName && !collected.has(item.name)) collected.set(item.name, item);
                    }
                    if (!termLabel) termLabel = term;
                    break;
                  }
                }
              }

              const cards = [...collected.values()].filter((item) => {
                // Random vanilla monsters that only carry the label in their name are not
                // really related (e.g. 水陆的帝王 for 帝王).
                if (/通常/.test(String(item.type || ''))) return false;
                return true;
              });
              if (!cards.length) return sendJson(res, 200, { ok: true, mode, archetype: archetype || null, cards: [], text: '这张卡没有字段' });
              return sendJson(res, 200, {
                ok: true,
                mode,
                archetype: archetype || termLabel || null,
                label: termLabel || archetype || null,
                cards,
                text: `相关字段 / 系列：${cards.length} 张`,
              });
            }

            if (mode === 'alias') {
              const card = findCard(q);
              if (!card) return sendJson(res, 200, { ok: true, mode, cards: [], text: '没有找到这张卡' });
              const english = String(card.en || '').trim();
              const base = String(card.treatedAs || '').trim();
              const alias = [];
              for (const { card: other } of loadCards()) {
                if (other === card) continue;
                const treated = String(other.treatedAs || '').trim();
                if ((english && treated === english) || (base && (other.en === base || treated === base))) {
                  alias.push({
                    name: other.md || other.cn,
                    body: [`「${other.md || other.cn}」${other.mdRarity ? ' ' + other.mdRarity : ''}`, other.typesZh, other.descZh]
                      .filter(Boolean)
                      .join('\n'),
                    id: other.id,
                    image: other.id ? `https://images.ygoprodeck.com/images/cards/${other.id}.jpg` : undefined,
                    effect: other.descZh || '',
                  });
                }
              }
              const text = alias.length ? `同名 / 规则上当作：${alias.length} 张` : '没有同名卡';
              return sendJson(res, 200, { ok: true, mode, cards: alias.slice(0, 40), text });
            }

            const primary = await mcp.toolText('search_cards', { text: [`「${q}」`], limit: 40 });
            const text = /共 0 张/.test(primary)
              ? await mcp.toolText('search_cards', { text: [q], limit: 40 })
              : primary;
            return sendJson(res, 200, { ok: true, mode: 'mention', text, cards: withImages(splitCards(text)) });
          }

          if (req.method === 'GET' && route === '/api/deck-breakdown') {
            const id = (url.searchParams.get('id') || '').trim();
            if (!id) return sendJson(res, 400, { ok: false, error: 'id is required' });
            const data = await loadDeckBreakdown(id);
            return sendJson(res, 200, { ok: true, ...data });
          }

          if (req.method === 'GET' && route === '/api/series-ranking') {
            const order = url.searchParams.get('order') === 'new' ? 'new' : 'old';
            const items = await loadSeriesRanking(order);
            // Prefer the Chinese name other rankings use for the same deck type.
            const zhMap = new Map();
            try {
              const deckTypes = await loadRanking('pop');
              for (const entry of deckTypes.items) {
                if (entry.name) zhMap.set(String(entry.name).toLowerCase(), entry.zh);
              }
            } catch {
              /* offline: fall back to the local label */
            }
            const cards = withImages(items.slice(0, 120).map((item) => ({ name: item.repName, body: '' })));
            return sendJson(res, 200, {
              ok: true,
              order,
              items: items.slice(0, 120).map((item, index) => ({
                ...item,
                zh: zhMap.get(item.archetype.toLowerCase()) || item.zh,
                image: cards[index]?.image,
                cnImage: cards[index]?.cnImage,
                mdImage: cards[index]?.mdImage,
              })),
            });
          }

          if (req.method === 'GET' && route === '/api/ranking') {
            const mode = url.searchParams.get('mode') || 'power';
            const fresh = url.searchParams.get('fresh') === '1';
            const data = await loadRanking(mode, fresh);
            return sendJson(res, 200, { ok: true, mode: data.sort, at: data.at, items: data.items });
          }

          if (req.method === 'POST' && route === '/api/deck') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const deck = String(body.deck || '').trim();
            if (!deck) return sendJson(res, 400, { ok: false, error: 'deck is required' });
            const text = await mcp.toolText('import_deck', { deck });
            return sendJson(res, 200, { ok: true, text });
          }

          if (req.method === 'POST' && route === '/api/deck-resolve') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const deck = String(body.deck || '').trim();
            if (!deck) return sendJson(res, 400, { ok: false, error: 'deck is required' });
            const { parseDeck } = await deckModule();
            const { sections, unknown } = parseDeck(deck);
            const cards = [];
            for (const section of ['main', 'extra', 'side']) {
              for (const entry of sections[section]) {
                const card = entry.card;
                if (!card) continue;
                const [enriched] = withImages([{ name: card.md || card.cn, body: '' }]);
                cards.push({
                  id: card.id,
                  name: card.md || card.cn,
                  count: entry.count,
                  section,
                  type: card.typesZh || '',
                  image: enriched?.image,
                  cnImage: enriched?.cnImage,
                  mdImage: enriched?.mdImage,
                  altImage: enriched?.altImage,
                  effect: enriched?.effect,
                });
              }
            }
            return sendJson(res, 200, { ok: true, cards, unknown });
          }

          if (req.method === 'POST' && route === '/api/smart-fill') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const cards = Array.isArray(body.cards) ? body.cards : [];
            if (!cards.length) return sendJson(res, 400, { ok: false, error: '卡组还是空的，先加一张核心卡' });
            const result = await smartFill(cards, Number(body.target) || 40);
            return sendJson(res, 200, { ok: true, ...result });
          }

          if (req.method === 'POST' && route === '/api/analyze-sample') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const deckCards = Array.isArray(body.deck) ? body.deck : [];
            const samples = Array.isArray(body.samples) ? body.samples : [];
            if (!deckCards.length || !samples.length) return sendJson(res, 400, { ok: false, error: '缺少卡组或实测结果' });
            const result = await analyzeSamples(ctx, deckCards, samples);
            return sendJson(res, 200, { ok: true, ...result });
          }

          if (req.method === 'POST' && route === '/api/cards-by-ids') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean).slice(0, 200) : [];
            const byId = new Map(loadCards().map(({ card }) => [Number(card.id), card]));
            const cards = ids
              .map((id) => {
                const card = byId.get(id);
                if (!card) return null;
                return {
                  id: card.id,
                  name: card.md || card.cn,
                  type: String(card.typesZh || '').split('\n')[0],
                  level: card.level || card.link || null,
                  atk: card.atk ?? null,
                  def: card.def ?? null,
                  rarity: card.mdRarity || '',
                  effect: card.descZh || '',
                  attr: card.attrEn || '',
                  race: card.raceEn || '',
                  image: `https://images.ygoprodeck.com/images/cards/${card.id}.jpg`,
                  cnImage: `https://cdn.233.momobako.com/ygopro/pics/${card.id}.jpg`,
                };
              })
              .filter(Boolean);
            return sendJson(res, 200, { ok: true, cards });
          }

          if (req.method === 'POST' && route === '/api/generate-hand-rules') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const deck = String(body.deck || '').trim();
            if (!deck) return sendJson(res, 400, { ok: false, error: 'deck is required' });
            const result = await generateHandRules(ctx, deck, { loadCards, deckModule, callModel });
            return sendJson(res, 200, { ok: true, ...result });
          }

          if (req.method === 'POST' && route === '/api/hand-odds') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const deck = String(body.deck || '').trim();
            if (!deck) return sendJson(res, 400, { ok: false, error: 'deck is required' });
            const result = await handOdds(deck, String(body.rules || ''), mcp, { loadCards, deckModule });
            return sendJson(res, 200, { ok: true, ...result });
          }

          if (req.method === 'POST' && route === '/api/verify-combo') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const deckCards = Array.isArray(body.deck) ? body.deck : [];
            const hand = Array.isArray(body.hand) ? body.hand : [];
            if (!deckCards.length) return sendJson(res, 400, { ok: false, error: '卡组是空的' });
            const result = await verifyCombo(mcp, deckCards, hand, String(body.tiers || ''));
            return sendJson(res, 200, { ok: true, ...result });
          }

          if (req.method === 'POST' && route === '/api/deck-graph') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const deck = String(body.deck || '').trim();
            if (!deck) return sendJson(res, 400, { ok: false, error: 'deck is required' });
            const { analyzeDeck } = await deckModule();
            return sendJson(res, 200, analyzeDeck(deck));
          }

          return sendJson(res, 404, { ok: false, error: `unknown route: ${route}` });
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
        }
      },
    });
    return () => {
      try { dispose?.(); } catch { /* already disposed */ }
      mcp.close();
    };
  });
}
