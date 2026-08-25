import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { composeRuntime } from '../../src/composition.js';
import { createMcpServer } from '../../src/server/create-server.js';
import type { FakeConnection } from './fake-connection.js';
import { createFakeConnection } from './fake-connection.js';

/**
 * callTool 的回傳是聯集型別，其中一支沒有 structuredContent，而有的那支型別是 {}。
 * 這裡統一收斂成可索引的形狀，斷言才寫得下去。
 */
function structured(result: unknown): Record<string, unknown> {
  const value = (result as { structuredContent?: unknown }).structuredContent;
  return (value ?? {}) as Record<string, unknown>;
}

const CONFIG = {
  host: '127.0.0.1',
  port: 19131,
  fallbackToRandomPort: true,
  commandTimeoutMs: 1000,
  keepaliveIntervalMs: 30_000,
  eventBufferSize: 100,
  maxBuildBlocks: 200_000,
  stepDelayMs: 0,
  debugFrames: false,
  negotiateEncryption: false,
  classroomGuard: true,
};

async function connect(fake: FakeConnection): Promise<Client> {
  const runtime = composeRuntime('0.1.0-test', CONFIG, fake);
  const server = createMcpServer({
    service: runtime.service,
    build: runtime.build,
    version: '0.1.0-test',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'minecraft-edu-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('MCP 工具面', () => {
  let fake: FakeConnection;
  let client: Client;

  beforeEach(async () => {
    fake = createFakeConnection();
    client = await connect(fake);
  });

  it('註冊了完整的工具面', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual([
      'mc_agent_act',
      'mc_agent_collect',
      'mc_agent_create',
      'mc_agent_inventory',
      'mc_agent_move',
      'mc_agent_place',
      'mc_agent_program',
      'mc_agent_sense',
      'mc_agent_teleport',
      'mc_agent_turn',
      'mc_analyze_symmetry',
      'mc_await_connection',
      'mc_blueprint_preview',
      'mc_build_blueprint',
      'mc_build_preview',
      'mc_build_shape',
      'mc_clone',
      'mc_compare_regions',
      'mc_effect',
      'mc_events_catalog',
      'mc_events_poll',
      'mc_events_subscribe',
      'mc_events_unsubscribe',
      'mc_feedback',
      'mc_fill',
      'mc_gamemode',
      'mc_give',
      'mc_message',
      'mc_player_action',
      'mc_query_target',
      'mc_read_block',
      'mc_run_command',
      'mc_run_commands',
      'mc_set_block',
      'mc_status',
      'mc_structure',
      'mc_summon',
      'mc_teleport',
      'mc_test_block',
      'mc_ticking_area',
      'mc_world_settings',
    ]);
    expect(names).toHaveLength(41);
  });

  it('mc_status 回報連線資訊', async () => {
    const result = await client.callTool({ name: 'mc_status', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(structured(result)['connected']).toBe(true);
    expect(structured(result)['connectCommand']).toBe('/connect 127.0.0.1:19131');
  });

  it('未連線時 mc_status 給出可照做的指示', async () => {
    fake.setConnected(false);
    const result = await client.callTool({ name: 'mc_status', arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).toContain('/connect 127.0.0.1:19131');
    expect(text).toContain('作弊');
  });

  it('mc_set_block 送出正確指令', async () => {
    await client.callTool({
      name: 'mc_set_block',
      arguments: { position: { x: 1, y: 64, z: 2 }, block: 'stone' },
    });
    expect(fake.issued).toContain('setblock 1 64 2 stone');
  });

  it('mc_agent_program 依序展開並送出', async () => {
    const result = await client.callTool({
      name: 'mc_agent_program',
      arguments: {
        steps: [
          { action: 'move', direction: 'forward', steps: 2 },
          { action: 'place', slot: 1, direction: 'down' },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(fake.issued).toEqual([
      'agent move forward',
      'agent move forward',
      'agent place 1 down',
    ]);
    expect(structured(result)['succeeded']).toBe(3);
  });

  it('mc_build_preview 不會送出任何指令', async () => {
    const result = await client.callTool({
      name: 'mc_build_preview',
      arguments: {
        shape: { kind: 'sphere', center: { x: 0, y: 70, z: 0 }, radius: 5, hollow: true },
        block: 'glass',
      },
    });
    expect(result.isError).toBeFalsy();
    expect(fake.issued).toHaveLength(0);
    expect(structured(result)['blockCount']).toBeGreaterThan(0);
    expect(structured(result)['fillBatches']).toBeGreaterThan(0);
  });

  it('mc_build_shape 把球面合併成遠少於方塊數的指令', async () => {
    const result = await client.callTool({
      name: 'mc_build_shape',
      arguments: {
        shape: { kind: 'sphere', center: { x: 0, y: 70, z: 0 }, radius: 8, hollow: false },
        block: 'stone',
      },
    });
    expect(result.isError).toBeFalsy();
    const plan = structured(result)['plan'] as { blockCount: number; fillBatches: number };
    expect(plan.blockCount).toBeGreaterThan(2000);
    expect(plan.fillBatches).toBeLessThan(plan.blockCount / 10);
    expect(fake.issued).toHaveLength(plan.fillBatches);
    expect(fake.issued.every((command) => command.startsWith('fill ') || command.startsWith('setblock '))).toBe(true);
  });

  it('mc_build_blueprint 依方塊種類分組合併', async () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, index) => ({
        position: { x: index, y: 64, z: 0 },
        block: 'stone',
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        position: { x: index, y: 65, z: 0 },
        block: 'glass',
      })),
    ];
    const result = await client.callTool({
      name: 'mc_build_blueprint',
      arguments: { entries },
    });
    expect(result.isError).toBeFalsy();
    expect(fake.issued).toEqual(['fill 0 64 0 4 64 0 stone', 'fill 0 65 0 4 65 0 glass']);
  });

  it('超過單次上限的建造會被擋下且不動工', async () => {
    const runtime = composeRuntime('0.1.0-test', { ...CONFIG, maxBuildBlocks: 10 }, fake);
    const server = createMcpServer({ service: runtime.service, build: runtime.build, version: '0.1.0-test' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const limited = new Client({ name: 'limited', version: '1.0.0' });
    await Promise.all([limited.connect(clientTransport), server.connect(serverTransport)]);

    const result = await limited.callTool({
      name: 'mc_build_shape',
      arguments: {
        shape: { kind: 'box', from: { x: 0, y: 0, z: 0 }, to: { x: 20, y: 20, z: 20 }, hollow: false },
        block: 'stone',
      },
    });
    expect(result.isError).toBe(true);
    expect(fake.issued).toHaveLength(0);
  });

  it('mc_run_command 拒絕會切斷橋接的指令且不送出', async () => {
    const result = await client.callTool({
      name: 'mc_run_command',
      arguments: { command: '/connect 10.0.0.1:1234' },
    });
    expect(result.isError).toBe(true);
    expect(fake.issued).toHaveLength(0);
  });

  it('mc_run_command 拒絕換行串接', async () => {
    const result = await client.callTool({
      name: 'mc_run_command',
      arguments: { command: 'say hi\nkill @a' },
    });
    expect(result.isError).toBe(true);
    expect(fake.issued).toHaveLength(0);
  });

  it('mc_query_target 解析出位置 JSON', async () => {
    const result = await client.callTool({
      name: 'mc_query_target',
      arguments: { target: '@s' },
    });
    expect(structured(result)['details']).toEqual([
      { position: { x: 10, y: 64, z: -5 } },
    ]);
  });

  it('遊戲回報失敗時工具如實反映', async () => {
    fake.failNext('Cheats are not enabled');
    const result = await client.callTool({
      name: 'mc_set_block',
      arguments: { position: { x: 0, y: 64, z: 0 }, block: 'stone' },
    });
    expect(structured(result)['ok']).toBe(false);
    expect(structured(result)['statusMessage']).toBe('Cheats are not enabled');
  });

  it('事件訂閱與輪詢可連續讀取', async () => {
    await client.callTool({ name: 'mc_events_subscribe', arguments: { eventName: 'PlayerMessage' } });
    fake.pushEvent('PlayerMessage', { Message: '哈囉', Sender: 'GJLMoTea' });
    fake.pushEvent('BlockPlaced', { Block: 'stone' });

    const first = await client.callTool({
      name: 'mc_events_poll',
      arguments: { afterCursor: 0, limit: 1 },
    });
    const events = structured(first)['events'] as { eventName: string }[];
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe('PlayerMessage');

    const second = await client.callTool({
      name: 'mc_events_poll',
      arguments: { afterCursor: structured(first)['nextCursor'] as number, limit: 10 },
    });
    const rest = structured(second)['events'] as { eventName: string }[];
    expect(rest).toHaveLength(1);
    expect(rest[0]?.eventName).toBe('BlockPlaced');
  });

  it('未連線時工具回錯誤而不是靜默失敗', async () => {
    fake.setConnected(false);
    const result = await client.callTool({
      name: 'mc_set_block',
      arguments: { position: { x: 0, y: 64, z: 0 }, block: 'stone' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).toContain('/connect');
  });

  it('公開連線與能力兩份 resource', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      'minecraft-edu://capabilities',
      'minecraft-edu://connection',
    ]);
  });
});

/**
 * 課堂防護的 domain 測試只證明「函式判斷正確」，不證明「有接上工具」。
 * 這裡走真正的 MCP 工具面，因為漏接是這種防護最典型的失效方式——
 * 看起來有防護，實際上兩條路都通。
 */
describe('課堂防護接線', () => {
  let fake: FakeConnection;
  let client: Client;

  beforeEach(async () => {
    fake = createFakeConnection();
    client = await connect(fake);
  });

  it('mc_player_action 用 @a 殺人會被擋下', async () => {
    const result = await client.callTool({
      name: 'mc_player_action',
      arguments: { action: 'kill', target: '@a' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).toContain('指名道姓');
  });

  it('mc_player_action 指名道姓時放行', async () => {
    const result = await client.callTool({
      name: 'mc_player_action',
      arguments: { action: 'kill', target: 'LinChihYu' },
    });
    expect(result.isError).toBeFalsy();
  });

  it('mc_run_command 走 raw kill 也被擋下，不能繞過專用工具的防護', async () => {
    const result = await client.callTool({
      name: 'mc_run_command',
      arguments: { command: 'kill @a' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).toContain('MINECRAFT_EDU_CLASSROOM_GUARD=0');
  });

  it('建造指令不受防護影響', async () => {
    const result = await client.callTool({
      name: 'mc_run_command',
      arguments: { command: 'fill 0 64 0 4 64 4 stone' },
    });
    expect(result.isError).toBeFalsy();
  });
});
