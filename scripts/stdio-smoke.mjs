/**
 * stdio smoke：不需要開遊戲。
 *
 * 驗證真正的 dist 產物能以 stdio 啟動、開得起 WebSocket 監聽、公開完整工具面，
 * 並在未連線時給出可照做的指示而不是靜默失敗。
 */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
// 用高位埠避免撞到真的在跑的橋接。
const port = String(20_000 + Math.floor(Math.random() * 10_000));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  cwd: projectRoot,
  stderr: 'pipe',
  env: {
    ...getDefaultEnvironment(),
    MINECRAFT_EDU_WS_HOST: '127.0.0.1',
    MINECRAFT_EDU_WS_PORT: port,
  },
});

const client = new Client({ name: 'minecraft-edu-stdio-smoke', version: '1.0.0' });

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  assert.equal(names.length, 38, `預期 38 個工具，實際 ${names.length}`);
  for (const required of [
    'mc_status',
    'mc_agent_program',
    'mc_build_shape',
    'mc_build_preview',
    'mc_events_poll',
    'mc_run_command',
  ]) {
    assert.ok(names.includes(required), `缺少工具 ${required}`);
  }

  // 每個工具都必須有標題與描述，否則 MCP Host 無從判斷該不該用。
  for (const tool of tools) {
    assert.ok((tool.description ?? '').length > 10, `${tool.name} 缺少足夠描述`);
  }

  const { resources } = await client.listResources();
  assert.deepEqual(
    resources.map((resource) => resource.uri).sort(),
    ['minecraft-edu://capabilities', 'minecraft-edu://connection'],
  );

  const status = await client.callTool({ name: 'mc_status', arguments: {} });
  assert.equal(status.isError, false);
  assert.equal(status.structuredContent.listening, true, '橋接應該已在監聽');
  assert.equal(status.structuredContent.connected, false, 'smoke 不開遊戲，應為未連線');
  assert.equal(status.structuredContent.connectCommand, `/connect 127.0.0.1:${port}`);

  // 未連線時的錯誤必須帶著可照做的指示。
  const blocked = await client.callTool({
    name: 'mc_set_block',
    arguments: { position: { x: 0, y: 64, z: 0 }, block: 'stone' },
  });
  assert.equal(blocked.isError, true);
  assert.ok(blocked.content[0].text.includes('/connect'), '錯誤訊息應包含連線指示');

  // 純計算的預覽不需要連線也要能算。
  const preview = await client.callTool({
    name: 'mc_build_preview',
    arguments: {
      shape: { kind: 'sphere', center: { x: 0, y: 70, z: 0 }, radius: 10, hollow: true },
      block: 'glass',
    },
  });
  assert.equal(preview.isError, false);
  assert.ok(preview.structuredContent.blockCount > 500);
  assert.ok(
    preview.structuredContent.fillBatches < preview.structuredContent.blockCount,
    '合併後的批次數必須少於方塊數',
  );

  // 政策閘門在沒有遊戲時也要生效。
  const forbidden = await client.callTool({
    name: 'mc_run_command',
    arguments: { command: 'wsserver 10.0.0.1:1234' },
  });
  assert.equal(forbidden.isError, true);

  const catalog = await client.callTool({ name: 'mc_events_catalog', arguments: {} });
  assert.equal(catalog.isError, false);
  assert.ok(catalog.structuredContent.eventNames.includes('PlayerMessage'));

  process.stdout.write(`Minecraft Education MCP stdio smoke passed（${names.length} tools）。\n`);
} finally {
  await client.close();
}
