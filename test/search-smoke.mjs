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

const params = new URLSearchParams({ text: '从卡组把卡加入手卡', kind: '魔法' });
const res = await fetch(`${base}/api/search?${params}`);
const body = await res.json();
console.log('status:', res.status, 'ok:', body.ok, 'cards:', body.cards?.length);
console.log(body.text.split('\n').slice(0, 3).join('\n').slice(0, 300));

server.close();
process.exit(0);
