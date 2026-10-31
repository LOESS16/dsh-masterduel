/**
 * Standalone smoke test: boot the host plugin against a fake ctx, serve the
 * routes on a random port, and hit them with fetch.
 *
 *   node test/smoke.mjs
 *
 * Needs the MCP server present and network access on first run.
 */
import http from 'node:http';
import { apply } from '../lib/index.js';

const routes = [];
const fakeCtx = {
  logger: { info: (message) => console.error('[host]', message) },
  webServer: {
    register(config) {
      routes.push(config);
      return () => {};
    },
  },
  effect(fn) {
    fn();
  },
};

apply(fakeCtx);

const server = http.createServer((req, res) => {
  for (const route of routes) {
    if (req.url?.startsWith(route.path)) {
      route.handler(req, res);
      return;
    }
  }
  res.writeHead(404).end('no route');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/dsh-masterduel`;

async function get(path, init) {
  const res = await fetch(base + path, init);
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, body };
}

try {
  const panel = await get('/panel');
  console.log('panel:', panel.status, String(panel.body).slice(0, 40).replace(/\n/g, ' '));

  const health = await get('/api/health');
  console.log('health:', health.status, JSON.stringify(health.body));

  const lookup = await get('/api/lookup?q=' + encodeURIComponent('灰流丽'));
  console.log('lookup:', lookup.status, 'cards=', lookup.body.cards?.length, 'text=', String(lookup.body.text).slice(0, 80).replace(/\n/g, ' '));

  const related = await get('/api/related?q=' + encodeURIComponent('青眼白龙'));
  console.log('related:', related.status, 'cards=', related.body.cards?.length, 'first=', related.body.cards?.[0]?.name);

  const started = Date.now();
  const deck = await get('/api/deck', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deck: '3 灰流丽\n3 增殖的Z\n3 青眼白龙' }),
  });
  console.log('deck:', deck.status, `(${Date.now() - started}ms)`, String(deck.body.text).split('\n').slice(0, 3).join(' | ').slice(0, 200));
} catch (error) {
  console.error('FAILED:', error);
  process.exitCode = 1;
} finally {
  server.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
