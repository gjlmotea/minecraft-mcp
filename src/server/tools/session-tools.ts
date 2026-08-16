import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { BlockHandService } from '../../application/blockhand-service.js';
import {
  batchOutcomeSchema,
  commandOutcomeSchema,
  connectionStatusSchema,
} from '../schemas.js';
import { batchToPayload, guard, ok, outcomeToPayload, summarizeBatch, summarizeOutcome } from '../tool-kit.js';

export function registerSessionTools(server: McpServer, service: BlockHandService): void {
  server.registerTool(
    'mc_status',
    {
      title: '讀取橋接與連線狀態',
      description:
        '回報 WebSocket 橋接是否在監聽、Minecraft 是否已連入、遊戲內應輸入的 /connect 指令、已訂閱事件與累計指令數。任何工具失敗時先查這個。無副作用。',
      inputSchema: z.object({}).strict(),
      outputSchema: connectionStatusSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () =>
      guard(async () => {
        const status = service.status();
        return ok(
          { ...status },
          status.connected
            ? `已連線（第 ${String(status.connectionCount)} 次），累計送出 ${String(status.commandsIssued)} 條指令。`
            : `尚未連線。請在 Minecraft Education 聊天列輸入：${status.connectCommand}（世界必須開啟作弊／Cheats）。`,
        );
      }),
  );

  server.registerTool(
    'mc_await_connection',
    {
      title: '等待 Minecraft 連入',
      description:
        '阻塞等待遊戲連上橋接，最多等 timeoutSeconds 秒。逾時不算錯誤，只是回報 connected=false。適合在請使用者輸入 /connect 之後呼叫。',
      inputSchema: z
        .object({ timeoutSeconds: z.number().int().min(1).max(120).default(30) })
        .strict(),
      outputSchema: connectionStatusSchema,
      annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ timeoutSeconds }) =>
      guard(async () => {
        const status = await service.awaitConnection(timeoutSeconds * 1000);
        return ok(
          { ...status },
          status.connected
            ? 'Minecraft 已連上橋接。'
            : `等待 ${String(timeoutSeconds)} 秒後仍未連上。請確認遊戲內已輸入 ${status.connectCommand}，且世界開啟了作弊。`,
        );
      }),
  );

  server.registerTool(
    'mc_run_command',
    {
      title: '執行單一 slash 指令',
      description:
        '送出一條原始 slash 指令，涵蓋本 server 沒有專用工具的功能。只接受單行、不得換行串接，並拒絕 wsserver／connect（那會切斷本橋接）。前導斜線可有可無。',
      inputSchema: z
        .object({
          command: z.string().min(1).max(1024).describe('例如 "time set day" 或 "/give @s diamond 1"'),
        })
        .strict(),
      outputSchema: commandOutcomeSchema.extend({ risk: z.string() }).strict(),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ command }) =>
      guard(async () => {
        const assessment = service.assessRaw(command);
        const outcome = await service.run(assessment.commandLine);
        return ok(
          { ...outcomeToPayload(outcome), risk: assessment.risk },
          summarizeOutcome(outcome),
        );
      }),
  );

  server.registerTool(
    'mc_run_commands',
    {
      title: '依序執行多條 slash 指令',
      description:
        '照順序送出多條原始指令，每條都各自通過政策檢查。適合手動編排的巨集；大量方塊請改用 mc_build_shape 或 mc_build_blueprint，它們會自動合併成最少的 fill。',
      inputSchema: z
        .object({
          commands: z.array(z.string().min(1).max(1024)).min(1).max(200),
          stopOnError: z.boolean().default(true),
          delayMs: z.number().int().min(0).max(5000).default(0),
        })
        .strict(),
      outputSchema: batchOutcomeSchema,
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ commands, stopOnError, delayMs }) =>
      guard(async () => {
        const normalized = commands.map((command) => service.assessRaw(command).commandLine);
        const batch = await service.runMany(normalized, { stopOnError, delayMs });
        return ok(batchToPayload(batch), summarizeBatch(batch, '批次指令'));
      }),
  );
}
