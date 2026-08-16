import { createWsMinecraftConnection } from './adapters/ws-minecraft-connection.js';
import { createBlockHandService } from './application/blockhand-service.js';
import { createBuildService } from './application/build-service.js';
import type { MinecraftConnection } from './ports/minecraft-connection.js';

export interface RuntimeConfig {
  readonly host: string;
  readonly port: number;
  readonly commandTimeoutMs: number;
  readonly eventBufferSize: number;
  readonly maxBuildBlocks: number;
  readonly stepDelayMs: number;
  readonly debugFrames: boolean;
  readonly negotiateEncryption: boolean;
}

const DEFAULTS: RuntimeConfig = {
  host: '127.0.0.1',
  port: 19131,
  commandTimeoutMs: 10_000,
  eventBufferSize: 500,
  maxBuildBlocks: 200_000,
  stepDelayMs: 100,
  debugFrames: false,
  negotiateEncryption: true,
};

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function readRuntimeConfig(): RuntimeConfig {
  const host = process.env['MINECRAFT_EDU_WS_HOST']?.trim();
  return {
    host: host === undefined || host === '' ? DEFAULTS.host : host,
    port: readInt('MINECRAFT_EDU_WS_PORT', DEFAULTS.port, 1, 65_535),
    commandTimeoutMs: readInt('MINECRAFT_EDU_COMMAND_TIMEOUT_MS', DEFAULTS.commandTimeoutMs, 500, 120_000),
    eventBufferSize: readInt('MINECRAFT_EDU_EVENT_BUFFER', DEFAULTS.eventBufferSize, 10, 20_000),
    maxBuildBlocks: readInt('MINECRAFT_EDU_MAX_BUILD_BLOCKS', DEFAULTS.maxBuildBlocks, 1, 5_000_000),
    stepDelayMs: readInt('MINECRAFT_EDU_STEP_DELAY_MS', DEFAULTS.stepDelayMs, 0, 5_000),
    debugFrames: process.env['MINECRAFT_EDU_DEBUG_FRAMES'] === '1',
    // 預設嘗試握手。Education 的「需要加密的 WebSocket」開啟時這是必要的，
    // 關閉時握手失敗也只會退回明文，所以預設開著沒有壞處。
    negotiateEncryption: process.env['MINECRAFT_EDU_ENCRYPTION'] !== '0',
  };
}

export function composeRuntime(version: string, config: RuntimeConfig, connection?: MinecraftConnection) {
  const activeConnection =
    connection ??
    createWsMinecraftConnection({
      host: config.host,
      port: config.port,
      commandTimeoutMs: config.commandTimeoutMs,
      eventBufferSize: config.eventBufferSize,
      debugFrames: config.debugFrames,
      negotiateEncryption: config.negotiateEncryption,
    });

  const service = createBlockHandService(activeConnection, {
    version,
    defaultStepDelayMs: config.stepDelayMs,
  });

  const build = createBuildService(activeConnection, { maxBuildBlocks: config.maxBuildBlocks });

  return { connection: activeConnection, service, build };
}
