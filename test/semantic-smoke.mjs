import http from 'node:http';
import { apply } from '../lib/index.js';

const routes = [];
apply({
  logger: { info: () => {} },
  webServer: { register(config) { routes.push(config); return () => {}; } },
  effect(fn) { fn(); },
});

const server = http.createServer((req, res) => {
  const route = routes.find((item) => req.url?.startsWith(item.path));
  if (route) route.handler(req, res);
  else res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/dsh-masterduel`;

for (const q of ['我方回合通常召唤次数增加1次', '无效魔法陷阱卡的发动', '把对方怪兽解放']) {
  const res = await fetch(`${base}/api/semantic?q=${encodeURIComponent(q)}`);
  const body = await res.json();
  console.log('\nQ:', q, 'cards:', body.cards?.length);
  for (const card of (body.cards || []).slice(0, 4)) console.log('  ', card.name, '|', card.snippet?.slice(0, 60));
}

server.close();
process.exit(0);
