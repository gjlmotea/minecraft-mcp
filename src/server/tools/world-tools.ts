import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { BlockHandService } from '../../application/blockhand-service.js';
import { parseQueryTargetDetails } from '../../application/blockhand-service.js';
import { worldCommands } from '../../domain/commands.js';
import { assertPlaceableCoordinate } from '../../domain/coordinates.js';
import { BLOCK_HANDLING_MODES, FILL_MODES } from '../../domain/contracts.js';
import {
  blockNameSchema,
  blockStatesSchema,
  commandOutcomeSchema,
  coordinateSchema,
  selectorSchema,
} from '../schemas.js';
import { guard, ok, outcomeToPayload, summarizeOutcome, toCoordinate } from '../tool-kit.js';

export function registerWorldTools(server: McpServer, service: BlockHandService): void {
  server.registerTool(
    'mc_set_block',
    {
      title: '放置單一方塊',
      description:
        '在指定座標放一個方塊。大量方塊請改用 mc_fill 或 mc_build_shape——逐格呼叫這個工具會非常慢。',
      inputSchema: z
        .object({
          position: coordinateSchema(),
          block: blockNameSchema(),
          blockStates: blockStatesSchema().nullable().default(null),
          handling: z.enum(BLOCK_HANDLING_MODES).nullable().default(null),
        })
        .strict(),
      outputSchema: commandOutcomeSchema(),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
    },
    async ({ position, block, blockStates, handling }) =>
      guard(async () => {
        const coordinate = toCoordinate(position);
        assertPlaceableCoordinate(coordinate, '放置座標');
        const outcome = await service.run(
          worldCommands.setBlock(coordinate, block, blockStates, handling),
        );
        return ok(outcomeToPayload(outcome), summarizeOutcome(outcome));
      }),
  );

  server.registerTool(
    'mc_fill',
    {
      title: '填滿一個長方體',
      description:
        '用同一種方塊填滿 from 到 to 的長方體。Bedrock 單次上限 32768 格；超過請改用 mc_build_shape，它會自動拆批。mode=hollow 只留外殼、outline 只留邊框。',
      inputSchema: z
        .object({
          from: coordinateSchema(),
          to: coordinateSchema(),
          block: blockNameSchema(),
          blockStates: blockStatesSchema().nullable().default(null),
          mode: z.enum(FILL_MODES).nullable().default(null),
          replaceBlock: blockNameSchema().nullable().default(null).describe('只在 mode="replace" 時有效'),
          replaceStates: blockStatesSchema().nullable().default(null),
        })
        .strict(),
      outputSchema: commandOutcomeSchema(),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
    },
    async ({ from, to, block, blockStates, mode, replaceBlock, replaceStates }) =>
      guard(async () => {
        const fromCoordinate = toCoordinate(from);
        const toCoordinateValue = toCoordinate(to);
        assertPlaceableCoordinate(fromCoordinate, '起點');
        assertPlaceableCoordinate(toCoordinateValue, '終點');
        const outcome = await service.run(
          worldCommands.fill(
            fromCoordinate,
            toCoordinateValue,
            block,
            blockStates,
            mode,
            replaceBlock,
            replaceStates,
          ),
        );
        return ok(outcomeToPayload(outcome), summarizeOutcome(outcome));
      }),
  );

  server.registerTool(
    'mc_clone',
    {
      title: '複製一塊區域',
      description:
        '把 begin–end 的區域複製到 destination。cloneMode="move" 會把原地清空。適合把手工蓋好的樣板量產。',
      inputSchema: z
        .object({
          begin: coordinateSchema(),
          end: coordinateSchema(),
          destination: coordinateSchema(),
          maskMode: z.enum(['replace', 'masked']).nullable().default(null),
          cloneMode: z.enum(['normal', 'force', 'move']).nullable().default(null),
        })
        .strict(),
      outputSchema: commandOutcomeSchema(),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ begin, end, destination, maskMode, cloneMode }) =>
      guard(async () => {
        const outcome = await service.run(
          worldCommands.clone(
            toCoordinate(begin),
            toCoordinate(end),
            toCoordinate(destination),
            maskMode,
            cloneMode,
          ),
        );
        return ok(outcomeToPayload(outcome), summarizeOutcome(outcome));
      }),
  );

  server.registerTool(
    'mc_test_block',
    {
      title: '檢查某座標是不是指定方塊',
      description: '不改變世界，只回報該座標是否為指定方塊。建造前確認地形、或驗證剛才蓋的東西時用。',
      inputSchema: z
        .object({
          position: coordinateSchema(),
          block: blockNameSchema(),
          blockStates: blockStatesSchema().nullable().default(null),
        })
        .strict(),
      outputSchema: commandOutcomeSchema().extend({ matches: z.boolean() }).strict(),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ position, block, blockStates }) =>
      guard(async () => {
        const outcome = await service.run(
          worldCommands.testForBlock(toCoordinate(position), block, blockStates),
        );
        return ok(
          { ...outcomeToPayload(outcome), matches: outcome.ok },
          outcome.ok ? `符合：該座標是 ${block}。` : `不符合：${outcome.statusMessage ?? '該座標不是指定方塊'}`,
        );
      }),
  );

  server.registerTool(
    'mc_query_target',
    {
      title: '查詢實體位置與朝向',
      description:
        '用選擇器查詢實體的座標、朝向與唯一 ID，回傳已解析的 JSON。這是取得玩家或 Agent 目前位置的正規做法——建造前先問這個，才知道要蓋在哪裡。' +
        '預設用 @p（最近的玩家）而非 @s：WebSocket 送進來的指令沒有實體身分，@s 在部分情況下無法解析。',
      inputSchema: z
        .object({ target: selectorSchema().default('@p') })
        .strict(),
      outputSchema: commandOutcomeSchema().extend({ details: z.unknown() }).strict(),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ target }) =>
      guard(async () => {
        const outcome = await service.run(worldCommands.queryTarget(target));
        const details = parseQueryTargetDetails(outcome);
        return ok(
          { ...outcomeToPayload(outcome), details },
          outcome.ok
            ? `已取得 ${target} 的位置資料。`
            : `查詢失敗：${outcome.statusMessage ?? '找不到目標'}`,
        );
      }),
  );

  server.registerTool(
    'mc_summon',
    {
      title: '生成生物或實體',
      description: '在指定座標生成一個實體，可加名牌。position 留空則生在指令發起者位置。',
      inputSchema: z
        .object({
          entity: blockNameSchema().describe('實體 ID，例如 cow 或 minecraft:villager'),
          position: coordinateSchema().nullable().default(null),
          nameTag: z.string().trim().min(1).max(64).nullable().default(null),
        })
        .strict(),
      outputSchema: commandOutcomeSchema(),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ entity, position, nameTag }) =>
      guard(async () => {
        const outcome = await service.run(
          worldCommands.summon(entity, position === null ? null : toCoordinate(position), nameTag),
        );
        return ok(outcomeToPayload(outcome), summarizeOutcome(outcome));
      }),
  );

  server.registerTool(
    'mc_world_settings',
    {
      title: '調整世界設定',
      description:
        '一次改一項世界設定：time 設定時間（day/night/noon/midnight 或 tick 數）、weather 天氣、gamerule 遊戲規則、difficulty 難度。',
      inputSchema: z
        .object({
          setting: z.enum(['time', 'weather', 'gamerule', 'difficulty']),
          value: z.string().trim().min(1).max(64).describe('time:day｜weather:clear｜difficulty:peaceful｜gamerule 的值'),
          rule: z.string().trim().min(1).max(64).optional().describe('setting="gamerule" 時的規則名稱'),
          durationSeconds: z.number().int().min(0).max(1_000_000).nullable().default(null),
        })
        .strict(),
      outputSchema: commandOutcomeSchema(),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ setting, value, rule, durationSeconds }) =>
      guard(async () => {
        let commandLine: string;
        if (setting === 'time') {
          commandLine = worldCommands.setTime(value);
        } else if (setting === 'weather') {
          const parsed = z.enum(['clear', 'rain', 'thunder']).safeParse(value);
          if (!parsed.success) throw new Error('weather 只接受 clear、rain 或 thunder。');
          commandLine = worldCommands.setWeather(parsed.data, durationSeconds);
        } else if (setting === 'difficulty') {
          const parsed = z.enum(['peaceful', 'easy', 'normal', 'hard']).safeParse(value);
          if (!parsed.success) throw new Error('difficulty 只接受 peaceful、easy、normal 或 hard。');
          commandLine = worldCommands.setDifficulty(parsed.data);
        } else {
          if (rule === undefined) throw new Error('setting="gamerule" 需要提供 rule。');
          commandLine = worldCommands.setGameRule(rule, value);
        }
        const outcome = await service.run(commandLine);
        return ok(outcomeToPayload(outcome), summarizeOutcome(outcome));
      }),
  );

  server.registerTool(
    'mc_structure',
    {
      title: '儲存或載入結構',
      description:
        '把一塊區域存成具名結構，或把已存的結構放回世界。這是把 AI 蓋好的東西保存、量產、帶到別的世界的官方途徑。',
      inputSchema: z
        .object({
          action: z.enum(['save', 'load']),
          name: z.string().trim().min(1).max(64),
          from: coordinateSchema().optional().describe('save 需要'),
          to: coordinateSchema().optional().describe('save 需要'),
          destination: coordinateSchema().optional().describe('load 需要'),
          includeEntities: z.boolean().default(false),
          saveMode: z.enum(['memory', 'disk']).default('disk'),
        })
        .strict(),
      outputSchema: commandOutcomeSchema(),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ action, name, from, to, destination, includeEntities, saveMode }) =>
      guard(async () => {
        let commandLine: string;
        if (action === 'save') {
          if (from === undefined || to === undefined) {
            throw new Error('action="save" 需要 from 與 to。');
          }
          commandLine = worldCommands.saveStructure(
            name,
            toCoordinate(from),
            toCoordinate(to),
            includeEntities,
            saveMode,
          );
        } else {
          if (destination === undefined) throw new Error('action="load" 需要 destination。');
          commandLine = worldCommands.loadStructure(name, toCoordinate(destination));
        }
        const outcome = await service.run(commandLine);
        return ok(outcomeToPayload(outcome), summarizeOutcome(outcome));
      }),
  );

  server.registerTool(
    'mc_ticking_area',
    {
      title: '新增常載區域',
      description:
        '把一塊區域設為常載，讓玩家離開後那裡的機制仍會運作。Agent 要在遠處自動工作時需要這個。',
      inputSchema: z
        .object({
          from: coordinateSchema(),
          to: coordinateSchema(),
          name: z.string().trim().min(1).max(32).nullable().default(null),
        })
        .strict(),
      outputSchema: commandOutcomeSchema(),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ from, to, name }) =>
      guard(async () => {
        const outcome = await service.run(
          worldCommands.addTickingArea(toCoordinate(from), toCoordinate(to), name),
        );
        return ok(outcomeToPayload(outcome), summarizeOutcome(outcome));
      }),
  );
}
