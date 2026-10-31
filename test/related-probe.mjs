import { McpClient } from '../lib/mcp-client.js';

const mcp = new McpClient();
for (const phrase of ['「青眼白龙」', '青眼白龙', '「灰流丽」', '灰流丽']) {
  try {
    const text = await mcp.toolText('search_cards', { text: [phrase], limit: 5 });
    console.log(JSON.stringify(phrase), '=>', String(text).split('\n').slice(0, 3).join(' | ').slice(0, 220));
  } catch (error) {
    console.log(JSON.stringify(phrase), 'ERR', error.message);
  }
}
mcp.close();
process.exit(0);
