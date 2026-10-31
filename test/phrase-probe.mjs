import { McpClient } from '../lib/mcp-client.js';

const mcp = new McpClient();
for (const phrase of ['2次通常召唤', '通常召唤的次数', '追加通常召唤', '通常召唤', '召唤次数']) {
  const text = await mcp.toolText('search_cards', { text: [phrase], limit: 8 });
  const lines = String(text).split('\n').filter((line) => line.startsWith('「'));
  console.log('\nQ:', phrase, '=>', lines.length, 'cards');
  for (const line of lines.slice(0, 5)) console.log('  ', line.slice(0, 90));
}
mcp.close();
process.exit(0);
