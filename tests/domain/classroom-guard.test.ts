import { describe, expect, it } from 'vitest';

import { MinecraftBridgeError } from '../../src/domain/contracts.js';
import {
  assertClassroomAllowsTarget,
  assertClassroomAllowsVerb,
  isBroadSelector,
  isPlayerAffectingVerb,
} from '../../src/domain/classroom-guard.js';

/**
 * 這道防護存在的理由是：學生只要能對 AI 說話就能下指令，不必破解橋接。
 * 所以測試重點是**兩條路都要擋**——raw 指令與專用工具。只擋一條等於沒擋。
 */
describe('課堂防護：raw 指令路徑', () => {
  it('拒絕直接作用在玩家身上的動詞', () => {
    for (const verb of ['kill', 'kick', 'op', 'deop', 'clear', 'ability']) {
      expect(() => assertClassroomAllowsVerb(verb, true), verb).toThrow(MinecraftBridgeError);
    }
  });

  it('大小寫不影響判定，不能用 KILL 繞過', () => {
    expect(() => assertClassroomAllowsVerb('KILL', true)).toThrow(MinecraftBridgeError);
    expect(() => assertClassroomAllowsVerb('Kill', true)).toThrow(MinecraftBridgeError);
  });

  it('建造與世界設定類指令不受影響', () => {
    for (const verb of ['fill', 'setblock', 'clone', 'structure', 'time', 'weather', 'summon']) {
      expect(() => assertClassroomAllowsVerb(verb, true), verb).not.toThrow();
    }
  });

  it('錯誤訊息要講清楚怎麼關掉，否則使用者只會覺得工具壞了', () => {
    expect(() => assertClassroomAllowsVerb('kill', true)).toThrow(/MINECRAFT_EDU_CLASSROOM_GUARD=0/u);
  });

  it('關閉防護時全部放行', () => {
    for (const verb of ['kill', 'op', 'clear']) {
      expect(() => assertClassroomAllowsVerb(verb, false), verb).not.toThrow();
    }
  });
});

describe('課堂防護：專用工具路徑', () => {
  it('作用在人身上的動作拒絕群體選擇器——這是「殺光全班」的實際入口', () => {
    for (const selector of ['@a', '@e', '@r', '@p', '@s', '@a[tag=x]']) {
      expect(() => assertClassroomAllowsTarget('kill', selector, true), selector).toThrow(
        MinecraftBridgeError,
      );
    }
  });

  it('指名道姓時放行，合法的課堂管理不受影響', () => {
    expect(() => assertClassroomAllowsTarget('kill', 'LinChihYu', true)).not.toThrow();
    expect(() => assertClassroomAllowsTarget('clear', '學生甲', true)).not.toThrow();
  });

  it('前後空白不能用來繞過選擇器判定', () => {
    expect(() => assertClassroomAllowsTarget('kill', '  @a  ', true)).toThrow(MinecraftBridgeError);
  });

  it('不作用在人身上的動作不受限制，@a 給經驗值仍可用', () => {
    expect(() => assertClassroomAllowsTarget('xp', '@a', true)).not.toThrow();
  });

  it('關閉防護時 @a 放行', () => {
    expect(() => assertClassroomAllowsTarget('kill', '@a', false)).not.toThrow();
  });

  it('錯誤訊息要指出是哪個選擇器被擋，方便老師改', () => {
    expect(() => assertClassroomAllowsTarget('kill', '@a', true)).toThrow(/@a/u);
  });
});

describe('判定輔助', () => {
  it('isPlayerAffectingVerb 只認作用在人身上的動詞', () => {
    expect(isPlayerAffectingVerb('kill')).toBe(true);
    expect(isPlayerAffectingVerb('fill')).toBe(false);
  });

  it('isBroadSelector 認所有 @ 開頭的選擇器', () => {
    expect(isBroadSelector('@a')).toBe(true);
    expect(isBroadSelector('@s')).toBe(true);
    expect(isBroadSelector('Steve')).toBe(false);
  });
});
