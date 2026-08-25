import { z } from 'zod';

import {
  AGENT_DIRECTIONS,
  BLOCK_HANDLING_MODES,
  COORDINATE_MODES,
  FILL_MODES,
  TURN_DIRECTIONS,
} from '../domain/contracts.js';
import { AXES } from '../domain/build/shapes.js';

/*
 * 為什麼這裡每個共用片段都是 function 而不是 const？
 *
 * MCP SDK 把 Zod schema 轉成 JSON Schema 時走的是 `zod-to-json-schema`，它會
 * **依物件 identity 去重**：同一個 schema 實例出現在第二個欄位時，輸出的不是
 * 展開後的定義，而是 `{"$ref":"#/properties/<第一個欄位>"}`。
 *
 * 於是 `z.object({ from: coordinateSchema, to: coordinateSchema })` 會產出
 * `"to":{"$ref":"#/properties/from"}`。這是合法的 JSON Schema，但不解析內部
 * $ref 的 MCP Host 會看不出 `to` 是物件，實測會把它當字串送出，server 端
 * 收到後回 `Invalid arguments: expected object, received string`——工具直接不能用。
 *
 * 每次呼叫都建新實例就沒有可去重的對象，JSON Schema 保證自給自足。
 * 巢狀欄位也必須跟著呼叫（例如 shape() 裡的 vec3()），只換掉最外層是不夠的：
 * 去重會下沉到 x/y/z 那一層，反而更難查。
 *
 * tests/server/tool-schemas.test.ts 會擋住任何 $ref 回歸。
 */

/* ────────────────────────── 共用片段 ────────────────────────── */

export const coordinateSchema = () =>
  z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      z: z.number().finite(),
      mode: z
        .enum(COORDINATE_MODES)
        .default('absolute')
        .describe('absolute=世界座標；relative=~ 相對發起者；local=^ 相對面向'),
    })
    .strict();

export const vec3Schema = () =>
  z
    .object({
      x: z.number().int(),
      y: z.number().int(),
      z: z.number().int(),
    })
    .strict();

export const blockNameSchema = () =>
  z.string().trim().min(1).max(80).describe('方塊 ID，例如 stone 或 minecraft:oak_planks');

export const blockStatesSchema = () =>
  z.string().trim().min(2).max(200).describe('選用的方塊狀態，例如 ["stone_type":"granite"]');

export const selectorSchema = () =>
  z.string().trim().min(1).max(120).describe('目標選擇器（@a/@p/@s/@e/@r，可帶 []）或玩家名稱');

export const agentDirectionSchema = () => z.enum(AGENT_DIRECTIONS);
export const turnDirectionSchema = () => z.enum(TURN_DIRECTIONS);
export const axisSchema = () => z.enum(AXES);
export const slotSchema = () => z.number().int().min(1).max(27);
export const quantitySchema = () => z.number().int().min(1).max(64);

/* ────────────────────────── 共用輸出 ────────────────────────── */

export const commandOutcomeSchema = () =>
  z
    .object({
      ok: z.boolean(),
      commandLine: z.string(),
      statusCode: z.number().nullable(),
      statusMessage: z.string().nullable(),
      data: z.record(z.unknown()).nullable(),
      elapsedMs: z.number(),
    })
    .strict();

export const batchOutcomeSchema = () =>
  z
    .object({
      ok: z.boolean(),
      issued: z.number(),
      succeeded: z.number(),
      failed: z.number(),
      firstFailure: commandOutcomeSchema().nullable(),
      outcomes: z.array(commandOutcomeSchema()),
      elapsedMs: z.number(),
    })
    .strict();

export const connectionStatusSchema = () =>
  z
    .object({
      listening: z.boolean(),
      host: z.string(),
      port: z.number(),
      connected: z.boolean(),
      connectCommand: z.string(),
      connectedAt: z.string().nullable(),
      connectionCount: z.number(),
      subscribedEvents: z.array(z.string()),
      bufferedEvents: z.number(),
      commandsIssued: z.number(),
      encrypted: z.boolean(),
    })
    .strict();

export const buildPlanSchema = () =>
  z
    .object({
      shape: z.string(),
      block: z.string(),
      blockStates: z.string().nullable(),
      blockCount: z.number(),
      fillBatches: z.number(),
      bounds: z.object({ min: vec3Schema(), max: vec3Schema() }).strict(),
      savedCommands: z.number(),
    })
    .strict();

/* ────────────────────────── 形狀輸入 ────────────────────────── */

export const shapeSchema = () =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('line'), from: vec3Schema(), to: vec3Schema() }).strict(),
    z
      .object({
        kind: z.literal('box'),
        from: vec3Schema(),
        to: vec3Schema(),
        hollow: z.boolean().default(false),
      })
      .strict(),
    z
      .object({
        kind: z.literal('sphere'),
        center: vec3Schema(),
        radius: z.number().min(1).max(128),
        hollow: z.boolean().default(false),
      })
      .strict(),
    z
      .object({
        kind: z.literal('ellipsoid'),
        center: vec3Schema(),
        radii: z
          .object({
            x: z.number().min(1).max(128),
            y: z.number().min(1).max(128),
            z: z.number().min(1).max(128),
          })
          .strict(),
        hollow: z.boolean().default(false),
      })
      .strict(),
    z
      .object({
        kind: z.literal('cylinder'),
        center: vec3Schema(),
        radius: z.number().min(1).max(128),
        height: z.number().int().min(1).max(384),
        axis: axisSchema().default('y'),
        hollow: z.boolean().default(false),
      })
      .strict(),
    z
      .object({
        kind: z.literal('cone'),
        center: vec3Schema(),
        radius: z.number().min(1).max(128),
        height: z.number().int().min(1).max(384),
        axis: axisSchema().default('y'),
        hollow: z.boolean().default(false),
      })
      .strict(),
    z
      .object({
        kind: z.literal('pyramid'),
        center: vec3Schema(),
        baseRadius: z.number().min(1).max(128),
        height: z.number().int().min(1).max(384),
        hollow: z.boolean().default(false),
      })
      .strict(),
    z
      .object({
        kind: z.literal('disk'),
        center: vec3Schema(),
        radius: z.number().min(1).max(256),
        axis: axisSchema().default('y'),
        hollow: z.boolean().default(false).describe('true 只畫圓環外框'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('torus'),
        center: vec3Schema(),
        majorRadius: z.number().min(2).max(128),
        minorRadius: z.number().min(1).max(64),
        axis: axisSchema().default('y'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('helix'),
        center: vec3Schema(),
        radius: z.number().min(1).max(128),
        height: z.number().int().min(2).max(384),
        turns: z.number().min(0.25).max(64),
        axis: axisSchema().default('y'),
        thickness: z.number().int().min(1).max(7).default(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal('curve'),
        points: z
          .array(vec3Schema())
          .min(2)
          .max(64)
          .describe('曲線會平滑通過每一個控制點，不是折線'),
        thickness: z.number().int().min(1).max(7).default(1),
        closed: z.boolean().default(false).describe('true 時首尾相接成封閉迴圈'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('revolution'),
        center: vec3Schema(),
        axis: axisSchema().default('y'),
        profile: z
          .array(
            z
              .object({
                along: z.number().int().describe('沿軸位置，相對 center'),
                radius: z.number().min(0).max(128).describe('該高度的半徑'),
              })
              .strict(),
          )
          .min(2)
          .max(64)
          .describe('側面輪廓；半徑在相鄰點之間線性內插，可蓋花瓶、塔樓、圓頂'),
        hollow: z.boolean().default(false).describe('true 只留側面殼層'),
      })
      .strict(),
  ]);

/* ────────────────────────── Agent 程式 ────────────────────────── */

export const agentProgramStepSchema = () =>
  z.discriminatedUnion('action', [
    z
      .object({
        action: z.literal('move'),
        direction: agentDirectionSchema(),
        steps: z.number().int().min(1).max(64).default(1),
      })
      .strict(),
    z
      .object({
        action: z.literal('turn'),
        direction: turnDirectionSchema(),
        times: z.number().int().min(1).max(4).default(1),
      })
      .strict(),
    z.object({ action: z.literal('attack'), direction: agentDirectionSchema() }).strict(),
    z.object({ action: z.literal('destroy'), direction: agentDirectionSchema() }).strict(),
    z.object({ action: z.literal('till'), direction: agentDirectionSchema() }).strict(),
    z.object({ action: z.literal('dropAll'), direction: agentDirectionSchema() }).strict(),
    z
      .object({ action: z.literal('place'), slot: slotSchema(), direction: agentDirectionSchema() })
      .strict(),
    z
      .object({
        action: z.literal('collect'),
        item: blockNameSchema().nullable().default(null).describe('null 代表收集全部'),
      })
      .strict(),
    z
      .object({
        action: z.literal('drop'),
        slot: slotSchema(),
        quantity: quantitySchema(),
        direction: agentDirectionSchema(),
      })
      .strict(),
    z
      .object({
        action: z.literal('transfer'),
        sourceSlot: slotSchema(),
        quantity: quantitySchema(),
        destinationSlot: slotSchema(),
      })
      .strict(),
  ]);

export { BLOCK_HANDLING_MODES, FILL_MODES };
