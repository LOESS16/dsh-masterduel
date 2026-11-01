# dsh-masterduel

Master Duel panel for DeepSeek Harness: card lookup, AI-assisted effect
search, related cards, a deck builder with favorites and drag-and-drop, and
deck check, backed by the
[`master-duel-ai-advisor`](https://github.com/BettTer/master-duel-ai-advisor)
MCP server.

The panel has four tabs:

- **查卡**: card name / passcode / effect search, filters (attribute, race,
  level, ATK/DEF, rarity, banlist), grid or list view, sort, search history,
  recent-card thumbnails, related cards (text mention / same archetype / alias)
  with one-click add to deck, and card images (YGOPRODeck, Master Duel Chinese,
  or Master Duel Meta alt art) with automatic source fallback and retry.
  AI 智能查卡 supports highlighted query/loading state, abort, strict re-rank
  (attribute-change and extra-Normal-Summon queries get local card-text
  verification), and named snapshots of results.
- **构建**: three-column main/extra/side builder with deck stats, type dots,
  level/ATK/DEF badges, per-card favorite ☆, collapsible favorites panel with
  drag-to-deck, drag-and-drop between main/extra/side (one copy per drag),
  smart fill from real-deck inclusion rates, opening-hand testing through the
  EDOPro engine (先手实测, 5 cards, 3/5/10 hands or a specified hand, sorted by
  value, with auto tiers), exact 先手 5 / 后手 6 opening probabilities through
  hand_odds (先后手概率, with editable auto rules), AI review of those samples,
  manual saves (export / import / diff / two-save compare), undo, and YDK / YDKE
  export.
- **排行**: deck-type rankings (power / tournament / ladder), series by release
  date, real-deck breakdown with main/extra filters, click-through to a deck.
- **卡组检查**: YDK / YDKE / card-list checking with stat cards, a full card
  list, distributions with percentages, banlist dates, report export, and
  `?tab=deck&deck=…` deep links.


This is a host plugin that serves a self-contained panel under
`/dsh-masterduel/panel` and proxies the MCP tools. The client entry appears in
the DSH sidebar and opens the same panel.

## Layout

```
package.json          dsh.bundle.patch -> cordis.patch.yml
cordis.patch.yml      insert entry id=dsh-masterduel
lib/index.js          host: routes + MCP lifecycle
lib/mcp-client.js     stdio JSON-RPC client (initialize / tools/call)
lib/hand-odds.js      hand_odds rules + AI-generated starter rules
lib/panel.html        self-contained UI (no build step)
test/smoke.mjs        standalone check: lookup + related
```

## Requirements

- DSH Desktop 0.2.x, Node 22.13+
- The MCP server unpacked at `~/.dsh/mcp/master-duel-ai-advisor`
  (default), or set `DSH_MASTERDUEL_MCP` to another `dist/mcp.mjs`.
- Node: discovered from the DSH resources directory; override with
  `DSH_MASTERDUEL_NODE` when needed.
- Network on first run: the MCP downloads ~30 MB of card data; the route
  planner (not used by this panel yet) needs ~60 MB more.
- If the machine reaches the internet through a local proxy, the DSH host
  process needs `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY`/`HTTP_PROXY`.
- The panel shows a red banner when the MCP script or Node cannot be found,
  with both paths and a copy button.

## Offline install

If GitHub is unavailable, use the distributed `dsh-masterduel-0.3.0.zip`
(SHA256 in `SHA256.txt` next to it) and follow `INSTALL.md`. It contains the
same `package.json`, `lib/`, `cordis.patch.yml`, README, LICENSE and install notes.

## Install (manual, no build)

1. Copy this directory to the desktop profile's `node_modules`:

   ```powershell
   Copy-Item -Recurse .\dsh-masterduel "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-masterduel"
   ```

2. Add the entry to the profile patch (`~/.dsh/profiles/desktop/cordis.patch.yml`):

   ```yaml
   - insert:
       - id: dsh-masterduel
         name: 'dsh-masterduel'
   ```

   Keep a backup first; the desktop profile is managed by the Electron app.

3. Restart DSH completely, then either open **设置 → 游戏王 MD** (the
   hand-written client bundle in `lib/client.js` embeds the panel), or open:

   `http://127.0.0.1:<当前端口>/dsh-masterduel/panel`

   The port is the GUI URL shown in the runtime context.

The client half is a plain side-effect script (`window.__ModuleLoader__.load`),
so there is no build step; React comes from the host's shared module table.

Alternative (if the profile is not Electron-managed):

```powershell
dsh plugin --profile desktop add <absolute path to this directory>
```

## API

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/dsh-masterduel/panel` | — | HTML |
| GET | `/dsh-masterduel/api/health` | — | `{ ok, script, error? }` |
| GET | `/dsh-masterduel/api/lookup` | `q` | `{ ok, text, cards[] }` |
| GET | `/dsh-masterduel/api/search` | `q` / `text` / `kind` / `attr` / `race` / `level` / `atk` / `def` / `archetype` / `rarity` / `limit` (≤200) | `{ ok, text, cards[], stats }`; the panel shows 60 and offers 「显示更多」 to 200 |
| GET | `/dsh-masterduel/api/semantic` | `q` (natural-language effect) | `{ ok, cards[] }` |
| POST | `/dsh-masterduel/api/ai-search` | `{ q }` | `{ ok, cards[], plan }` — two LLM calls (plan + rerank), uses tokens |
| GET | `/dsh-masterduel/api/related` | `q`, `mode=mention\|archetype\|alias` | related cards: text mention, same archetype (grouped by monster/spell/trap in the UI), or alias/treated-as |
| GET | `/dsh-masterduel/img` | `src` (remote image URL) | cached card image; downloads once into `~/.cache/dsh-masterduel/images` |
| GET | `/dsh-masterduel/api/image-stats` | `source?` | local cache size + per-source cached/missing counts + full-download estimates |
| GET | `/dsh-masterduel/api/image-fallbacks` | — | cards whose image came from a fallback source, with original source and reason |
| POST | `/dsh-masterduel/api/image-download` | `{ source: ygo\|cn\|md, limit? }` | start background full download |
| GET | `/dsh-masterduel/api/image-download-status` | — | progress of the running download |
| GET | `/dsh-masterduel/api/banlist` | — | current Master Duel banlist entries |
| GET | `/dsh-masterduel/api/deck-breakdown` | `id` (deck-type id) | card inclusion rates from real decks |
| GET | `/dsh-masterduel/api/series-ranking` | `order=new\|old` | archetype series ranked by mdRelease (local dump) |
| GET | `/dsh-masterduel/api/ranking` | `mode=power\|pop\|master` | top deck types, cached 10 min |
| POST | `/dsh-masterduel/api/deck` | `{ deck }` | `{ ok, text }` |
| POST | `/dsh-masterduel/api/deck-resolve` | `{ deck }` | parsed cards with section + image |
| POST | `/dsh-masterduel/api/deck-graph` | `{ deck }` | deck stats + distributions + card list (ids) + banlist issues |
| POST | `/dsh-masterduel/api/smart-fill` | `{ cards: [{id,count,section}], target? }` | suggested cards + counts from real-deck inclusion rates |
| POST | `/dsh-masterduel/api/hand-odds` | `{ deck, rules? }` | exact 先手 5 / 后手 6 opening odds via `hand_odds`; auto starters from main-deck text when `rules` is empty |
| POST | `/dsh-masterduel/api/generate-hand-rules` | `{ deck }` | model-generated `卡名：条件 → 能动` rules for `hand_odds` (uses tokens; validated against deck names) |
| POST | `/dsh-masterduel/api/cards-by-ids` | `{ ids }` | minimal card rows (type/level/ATK/DEF/images) for enriching old saved decks |
| POST | `/dsh-masterduel/api/verify-combo` | `{ deck, hand, tiers? }` | EDOPro engine route + end board for one opening hand |
| POST | `/dsh-masterduel/api/analyze-sample` | `{ deck, samples, issues? }` | AI review of sampled hands (needs an LLM; returns summary/issues/suggestions) |
| GET/POST | `/dsh-masterduel/api/settings` | — / `{ searchHistory, buildHistory }` | persisted panel settings (≤10 entries each) |

## Language

UI defaults to Chinese, with no automatic language dialog. Use the header
selector to switch to English (beta): navigation, main controls, filters and
empty states are translated, while card names/card text and some long dynamic
messages stay in the source language. The choice is stored in `settings.json`
(`lang`) and survives DSH restarts.

## Tests

```sh
node --test test/deck.test.mjs test/hand-odds.test.mjs
node scripts/verify-package.mjs   # package file list/version sanity
node --check lib/index.js         # and hand-odds / mcp-client / deck
```

Tests use a small `test/fixtures/cards.json` via `DSH_MASTERDUEL_CARDS`,
so they run without the 16 MB downloaded card database.
The GitHub Actions workflow (`.github/workflows/ci.yml`) runs tests, syntax
checks, the package verifier, and `npm pack --dry-run` on Windows.

The panel also has a CDP smoke script for local regression (not shipped).

## Security

- Every `/api/*` route requires a per-process random token in the `X-MD-Token`
  header. The panel HTML (served by us) embeds the token; the shell page itself
  is public but contains no data.
- Routes are local-only; CORS is not enabled, so other web pages cannot read
  the panel or its responses.
- The plugin spawns a child process and forwards data to the MCP server; it
  never touches the Master Duel client.
- The MCP server is AGPL-3.0; this plugin calls it as a separate process and
  does not bundle its code.

## Legal

- This is an unofficial community tool. It is not affiliated with, endorsed
  by, or sponsored by Konami, Yu-Gi-Oh!, or Master Duel.
- Card images, card text, names, and related assets belong to their respective
  owners (Konami and the image/DB sites). This package does **not** bundle card
  images, card text, rankings, or deck data. The panel fetches them from
  third-party sources at the user's request and caches images locally on the
  user's own machine.
- Do not deploy the image proxy as a public service or redistribute cached
  images/data; respect the terms and robots policies of each source.
- The optional MCP server (`master-duel-ai-advisor`) is AGPL-3.0-or-later. It
  is a separate process and is not bundled with this plugin; install it
  separately and follow its license.
- AI features send deck/card text to the configured model provider only when
  the user explicitly triggers them.

## Roadmap

- Native client plugin (settings section) wrapping the same routes.
- Related-card modes: same archetype, reverse mentions, fusion materials.
- Deck editor and route planner visualisation.
- Cache related-card lookups.
