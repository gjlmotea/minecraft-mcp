import { describe, expect, it } from 'vitest';

import { MinecraftBridgeError } from '../../src/domain/contracts.js';
import { generateShape } from '../../src/domain/build/shapes.js';

const ORIGIN = { x: 0, y: 64, z: 0 };

const keyOf = (point: { x: number; y: number; z: number }): string =>
  `${String(point.x)},${String(point.y)},${String(point.z)}`;

/** 測試自己算一次點到線段的距離，不共用實作，否則等於拿 bug 驗 bug。 */
function distanceToSegment(
  point: { x: number; y: number; z: number },
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) / lengthSquared;
    t = Math.min(1, Math.max(0, t));
  }
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t), point.z - (from.z + dz * t));
}

describe('generateShape', () => {
  it('line 連接兩點且首尾正確', () => {
    const points = generateShape({
      kind: 'line',
      from: { x: 0, y: 64, z: 0 },
      to: { x: 5, y: 64, z: 0 },
    });
    expect(points).toHaveLength(6);
    expect(points[0]).toEqual({ x: 0, y: 64, z: 0 });
    expect(points.at(-1)).toEqual({ x: 5, y: 64, z: 0 });
  });

  it('同一點的 line 只回一格', () => {
    expect(generateShape({ kind: 'line', from: ORIGIN, to: ORIGIN })).toHaveLength(1);
  });

  it('實心 box 的方塊數等於體積', () => {
    const points = generateShape({
      kind: 'box',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 2, y: 2, z: 2 },
      hollow: false,
    });
    expect(points).toHaveLength(27);
  });

  it('空心 box 只留外殼', () => {
    const points = generateShape({
      kind: 'box',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 2, y: 2, z: 2 },
      hollow: true,
    });
    // 3×3×3 減去正中央那一格。
    expect(points).toHaveLength(26);
    expect(points.some((p) => p.x === 1 && p.y === 1 && p.z === 1)).toBe(false);
  });

  it('sphere 的每一格都在半徑內', () => {
    const radius = 6;
    const points = generateShape({ kind: 'sphere', center: ORIGIN, radius, hollow: false });
    expect(points.length).toBeGreaterThan(800);
    for (const point of points) {
      const dx = point.x - ORIGIN.x;
      const dy = point.y - ORIGIN.y;
      const dz = point.z - ORIGIN.z;
      expect(dx * dx + dy * dy + dz * dz).toBeLessThanOrEqual((radius + 0.5) ** 2);
    }
  });

  it('空心 sphere 比實心少很多方塊，且中心是空的', () => {
    const solid = generateShape({ kind: 'sphere', center: ORIGIN, radius: 8, hollow: false });
    const hollow = generateShape({ kind: 'sphere', center: ORIGIN, radius: 8, hollow: true });
    expect(hollow.length).toBeLessThan(solid.length / 2);
    expect(hollow.some((p) => p.x === ORIGIN.x && p.y === ORIGIN.y && p.z === ORIGIN.z)).toBe(false);
  });

  it('cylinder 的高度沿指定軸展開', () => {
    const points = generateShape({
      kind: 'cylinder',
      center: ORIGIN,
      radius: 3,
      height: 10,
      axis: 'y',
      hollow: false,
    });
    const ys = new Set(points.map((p) => p.y));
    expect(ys.size).toBe(10);
    expect(Math.min(...ys)).toBe(64);
    expect(Math.max(...ys)).toBe(73);
  });

  it('cylinder 換軸時展開方向跟著換', () => {
    const points = generateShape({
      kind: 'cylinder',
      center: ORIGIN,
      radius: 2,
      height: 7,
      axis: 'x',
      hollow: false,
    });
    expect(new Set(points.map((p) => p.x)).size).toBe(7);
  });

  it('cone 底部比頂部寬', () => {
    const points = generateShape({
      kind: 'cone',
      center: ORIGIN,
      radius: 8,
      height: 8,
      axis: 'y',
      hollow: false,
    });
    const bottom = points.filter((p) => p.y === 64).length;
    const top = points.filter((p) => p.y === 71).length;
    expect(bottom).toBeGreaterThan(top);
  });

  it('disk 是單層平面', () => {
    const points = generateShape({
      kind: 'disk',
      center: ORIGIN,
      radius: 5,
      axis: 'y',
      hollow: false,
    });
    expect(new Set(points.map((p) => p.y))).toEqual(new Set([64]));
  });

  it('空心 disk 是圓環，中心被挖空', () => {
    const ring = generateShape({ kind: 'disk', center: ORIGIN, radius: 6, axis: 'y', hollow: true });
    expect(ring.some((p) => p.x === 0 && p.z === 0)).toBe(false);
  });

  it('torus 產生封閉環且不含中心', () => {
    const points = generateShape({
      kind: 'torus',
      center: ORIGIN,
      majorRadius: 8,
      minorRadius: 2,
      axis: 'y',
    });
    expect(points.length).toBeGreaterThan(100);
    expect(points.some((p) => p.x === 0 && p.y === 64 && p.z === 0)).toBe(false);
  });

  it('helix 沿軸爬升且不重複座標', () => {
    const points = generateShape({
      kind: 'helix',
      center: ORIGIN,
      radius: 5,
      height: 20,
      turns: 2,
      axis: 'y',
      thickness: 1,
    });
    const keys = new Set(points.map((p) => `${String(p.x)},${String(p.y)},${String(p.z)}`));
    expect(keys.size).toBe(points.length);
    expect(new Set(points.map((p) => p.y)).size).toBe(20);
  });

  it('helix 加粗會增加方塊數', () => {
    const thin = generateShape({
      kind: 'helix',
      center: ORIGIN,
      radius: 5,
      height: 20,
      turns: 2,
      axis: 'y',
      thickness: 1,
    });
    const thick = generateShape({
      kind: 'helix',
      center: ORIGIN,
      radius: 5,
      height: 20,
      turns: 2,
      axis: 'y',
      thickness: 3,
    });
    expect(thick.length).toBeGreaterThan(thin.length);
  });

  it('尺寸為零或負數會被擋下', () => {
    expect(() =>
      generateShape({ kind: 'sphere', center: ORIGIN, radius: 0, hollow: false }),
    ).toThrow(MinecraftBridgeError);
  });

  it('過長的線段會被擋下', () => {
    expect(() =>
      generateShape({ kind: 'line', from: { x: 0, y: 0, z: 0 }, to: { x: 99_999, y: 0, z: 0 } }),
    ).toThrow(/超過上限/);
  });
});

describe('generateShape：curve', () => {
  const has = (points: readonly { x: number; y: number; z: number }[], target: { x: number; y: number; z: number }) =>
    points.some((point) => point.x === target.x && point.y === target.y && point.z === target.z);

  it('曲線通過每一個控制點——這是它跟折線最重要的差別', () => {
    const control = [
      { x: 0, y: 64, z: 0 },
      { x: 10, y: 68, z: 4 },
      { x: 20, y: 64, z: 0 },
    ];
    const points = generateShape({ kind: 'curve', points: control, thickness: 1, closed: false });
    for (const target of control) {
      expect(has(points, target), `缺少控制點 ${JSON.stringify(target)}`).toBe(true);
    }
  });

  it('中段會偏離直線，證明真的有平滑而不是直接連線', () => {
    const straight = generateShape({
      kind: 'line',
      from: { x: 0, y: 64, z: 0 },
      to: { x: 20, y: 64, z: 0 },
    });
    const curved = generateShape({
      kind: 'curve',
      points: [
        { x: 0, y: 64, z: 0 },
        { x: 10, y: 70, z: 0 },
        { x: 20, y: 64, z: 0 },
      ],
      thickness: 1,
      closed: false,
    });
    const highest = Math.max(...curved.map((point) => point.y));
    expect(highest).toBeGreaterThanOrEqual(70);
    expect(Math.max(...straight.map((point) => point.y))).toBe(64);
  });

  it('封閉曲線會繞回起點附近，開放曲線不會', () => {
    const control = [
      { x: 0, y: 64, z: 0 },
      { x: 12, y: 64, z: 0 },
      { x: 12, y: 64, z: 12 },
      { x: 0, y: 64, z: 12 },
    ];
    const closed = generateShape({ kind: 'curve', points: control, thickness: 1, closed: true });
    const open = generateShape({ kind: 'curve', points: control, thickness: 1, closed: false });
    // 封閉版必須補出第四段（從最後一點回到第一點），所以格數更多。
    expect(closed.length).toBeGreaterThan(open.length);
    // 回程段落在 x ≤ 0 那一側（Catmull-Rom 的張力會讓它略為外凸，所以不能
    // 寫死座標）。開放版永遠不會有那一段。
    const onReturnLeg = (point: { x: number; z: number }) => point.x <= 0 && point.z === 6;
    expect(closed.some(onReturnLeg)).toBe(true);
    expect(open.some(onReturnLeg)).toBe(false);
  });

  it('加粗會變多但不重複', () => {
    const thin = generateShape({
      kind: 'curve',
      points: [
        { x: 0, y: 64, z: 0 },
        { x: 16, y: 64, z: 0 },
      ],
      thickness: 1,
      closed: false,
    });
    const thick = generateShape({
      kind: 'curve',
      points: [
        { x: 0, y: 64, z: 0 },
        { x: 16, y: 64, z: 0 },
      ],
      thickness: 3,
      closed: false,
    });
    expect(thick.length).toBeGreaterThan(thin.length);
    const keys = new Set(thick.map((point) => `${point.x},${point.y},${point.z}`));
    expect(keys.size).toBe(thick.length);
  });

  it('少於 2 個控制點直接拒絕', () => {
    expect(() =>
      generateShape({ kind: 'curve', points: [ORIGIN], thickness: 1, closed: false }),
    ).toThrow(MinecraftBridgeError);
  });
});

describe('generateShape：revolution', () => {
  const widthAt = (points: readonly { x: number; y: number; z: number }[], y: number) => {
    const layer = points.filter((point) => point.y === y);
    if (layer.length === 0) return 0;
    return Math.max(...layer.map((point) => point.x)) - Math.min(...layer.map((point) => point.x)) + 1;
  };

  it('半徑隨輪廓變化——這是 cylinder 與 cone 都做不到的', () => {
    const points = generateShape({
      kind: 'revolution',
      center: ORIGIN,
      axis: 'y',
      hollow: false,
      profile: [
        { along: 0, radius: 6 },
        { along: 5, radius: 2 },
        { along: 10, radius: 7 },
      ],
    });
    const bottom = widthAt(points, 64);
    const waist = widthAt(points, 69);
    const top = widthAt(points, 74);
    expect(waist).toBeLessThan(bottom);
    expect(waist).toBeLessThan(top);
  });

  it('相鄰輪廓點之間會線性內插，不是階梯', () => {
    const points = generateShape({
      kind: 'revolution',
      center: ORIGIN,
      axis: 'y',
      hollow: false,
      profile: [
        { along: 0, radius: 2 },
        { along: 10, radius: 12 },
      ],
    });
    const widths = [0, 2, 4, 6, 8, 10].map((offset) => widthAt(points, 64 + offset));
    for (let index = 1; index < widths.length; index += 1) {
      expect(widths[index]).toBeGreaterThan(widths[index - 1]!);
    }
  });

  it('hollow 只留殼層，中心是空的', () => {
    const solid = generateShape({
      kind: 'revolution',
      center: ORIGIN,
      axis: 'y',
      hollow: false,
      profile: [
        { along: 0, radius: 8 },
        { along: 6, radius: 8 },
      ],
    });
    const shell = generateShape({
      kind: 'revolution',
      center: ORIGIN,
      axis: 'y',
      hollow: true,
      profile: [
        { along: 0, radius: 8 },
        { along: 6, radius: 8 },
      ],
    });
    expect(shell.length).toBeLessThan(solid.length);
    const centreInShell = shell.some((point) => point.x === 0 && point.z === 0 && point.y === 67);
    expect(centreInShell).toBe(false);
  });

  it('輪廓點順序顛倒結果相同，呼叫端不必自己排序', () => {
    const ascending = generateShape({
      kind: 'revolution',
      center: ORIGIN,
      axis: 'y',
      hollow: false,
      profile: [
        { along: 0, radius: 3 },
        { along: 8, radius: 9 },
      ],
    });
    const descending = generateShape({
      kind: 'revolution',
      center: ORIGIN,
      axis: 'y',
      hollow: false,
      profile: [
        { along: 8, radius: 9 },
        { along: 0, radius: 3 },
      ],
    });
    expect(descending.length).toBe(ascending.length);
  });

  it('負半徑與過大半徑都拒絕', () => {
    expect(() =>
      generateShape({
        kind: 'revolution',
        center: ORIGIN,
        axis: 'y',
        hollow: false,
        profile: [
          { along: 0, radius: -1 },
          { along: 4, radius: 3 },
        ],
      }),
    ).toThrow(MinecraftBridgeError);
    expect(() =>
      generateShape({
        kind: 'revolution',
        center: ORIGIN,
        axis: 'y',
        hollow: false,
        profile: [
          { along: 0, radius: 3 },
          { along: 4, radius: 999 },
        ],
      }),
    ).toThrow(MinecraftBridgeError);
  });
});

/**
 * 以下五個形狀是第二批加入的。測試重點放在「新形狀沒有偷改舊形狀」與
 * 「參數的語意真的是說明寫的那個意思」——尺寸類的 bug 在遊戲裡看得出來，
 * 語意類的 bug 看不出來，只會蓋出一個看似合理但不是你要的東西。
 */
describe('tube（任意方向圓柱）', () => {
  it('兩端點相同時等於同半徑的球，逐格相同', () => {
    const tube = generateShape({ kind: 'tube', from: ORIGIN, to: ORIGIN, radius: 3, hollow: false });
    const sphere = generateShape({ kind: 'sphere', center: ORIGIN, radius: 3, hollow: false });
    expect(new Set(tube.map(keyOf))).toEqual(new Set(sphere.map(keyOf)));
  });

  it('每一格都在半徑內，斜向也成立', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: 10, y: 74, z: 10 };
    const radius = 2;
    const points = generateShape({ kind: 'tube', from, to, radius, hollow: false });
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(distanceToSegment(point, from, to)).toBeLessThanOrEqual(radius + 0.5 + 1e-9);
    }
  });

  it('比同半徑同長度的 cylinder 多，因為兩端是半球不是切平', () => {
    const tube = generateShape({
      kind: 'tube',
      from: { x: 0, y: 64, z: 0 },
      to: { x: 0, y: 70, z: 0 },
      radius: 3,
      hollow: false,
    });
    const cylinder = generateShape({
      kind: 'cylinder',
      center: { x: 0, y: 64, z: 0 },
      radius: 3,
      height: 7,
      axis: 'y',
      hollow: false,
    });
    expect(tube.length).toBeGreaterThan(cylinder.length);
  });

  it('空心是封閉殼層：兩端的蓋子也在，管子不是通的', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: 0, y: 74, z: 0 };
    const hollow = generateShape({ kind: 'tube', from, to, radius: 4, hollow: true });
    const solid = generateShape({ kind: 'tube', from, to, radius: 4, hollow: false });
    expect(hollow.length).toBeLessThan(solid.length);
    // 端點正上方的蓋子必須留著，否則就成了開口的管。
    expect(hollow.some((point) => point.x === 0 && point.z === 0 && point.y === to.y + 4)).toBe(true);
    // 中段的軸心是內部，應該被挖掉。
    expect(hollow.some((point) => point.x === 0 && point.z === 0 && point.y === 69)).toBe(false);
  });

  it('半徑非正數會拒絕', () => {
    expect(() =>
      generateShape({ kind: 'tube', from: ORIGIN, to: ORIGIN, radius: 0, hollow: false }),
    ).toThrow(MinecraftBridgeError);
  });
});

describe('wedge（楔形斜面）', () => {
  const from = { x: 0, y: 64, z: 0 };
  const to = { x: 4, y: 68, z: 0 };

  it('起點端滿高、終點端剩一格，總數是等差級數', () => {
    const points = generateShape({
      kind: 'wedge',
      from,
      to,
      rise: 'y',
      run: 'x',
      reversed: false,
      hollow: false,
    });
    // 5+4+3+2+1
    expect(points).toHaveLength(15);
    expect(points.filter((point) => point.x === 0)).toHaveLength(5);
    expect(points.filter((point) => point.x === 4)).toHaveLength(1);
  });

  it('reversed 把高的那一端換到另一邊', () => {
    const points = generateShape({
      kind: 'wedge',
      from,
      to,
      rise: 'y',
      run: 'x',
      reversed: true,
      hollow: false,
    });
    expect(points).toHaveLength(15);
    expect(points.filter((point) => point.x === 4)).toHaveLength(5);
    expect(points.filter((point) => point.x === 0)).toHaveLength(1);
  });

  it('斜面上的整數格不會因為浮點誤差被判在外面', () => {
    const points = generateShape({
      kind: 'wedge',
      from: { x: 0, y: 64, z: 0 },
      to: { x: 6, y: 70, z: 0 },
      rise: 'y',
      run: 'x',
      reversed: false,
      hollow: false,
    });
    // 斜率剛好 1，(x, 64 + 6 - x) 這條稜線每一格都該在。
    for (let step = 0; step <= 6; step += 1) {
      expect(points.some((point) => point.x === step && point.y === 64 + 6 - step)).toBe(true);
    }
  });

  it('上升與下降不能是同一個軸', () => {
    expect(() =>
      generateShape({ kind: 'wedge', from, to, rise: 'y', run: 'y', reversed: false, hollow: false }),
    ).toThrow(MinecraftBridgeError);
  });
});

describe('arch（半圓拱）', () => {
  it('開口寬度是 2×radius−1，拱圈厚度就是 thickness', () => {
    const points = generateShape({
      kind: 'arch',
      center: ORIGIN,
      radius: 5,
      thickness: 2,
      depth: 1,
      span: 'x',
      rise: 'y',
      legHeight: 0,
    });
    const springing = points
      .filter((point) => point.y === ORIGIN.y)
      .map((point) => point.x)
      .sort((left, right) => left - right);
    expect(springing).toEqual([-6, -5, 5, 6]);
    // 起拱線上 x=-4..4 共 9 格是開口，2×5−1。
    expect(springing.filter((x) => Math.abs(x) < 5)).toHaveLength(0);
  });

  it('拱腳的寬度與拱圈在起拱線的落點完全對齊', () => {
    const points = generateShape({
      kind: 'arch',
      center: ORIGIN,
      radius: 5,
      thickness: 2,
      depth: 1,
      span: 'x',
      rise: 'y',
      legHeight: 4,
    });
    const at = (y: number) =>
      points
        .filter((point) => point.y === y)
        .map((point) => point.x)
        .sort((left, right) => left - right);
    expect(at(ORIGIN.y - 4)).toEqual(at(ORIGIN.y));
    // 再往下一格就沒有了。
    expect(at(ORIGIN.y - 5)).toEqual([]);
  });

  it('半整數半徑也對齊——拱圈與拱腳必須用同一個內緣判定', () => {
    // 整數半徑下「>= radius」與「>= radius - 0.5」在整數格上結果相同，
    // 抓不到用錯內緣的實作；半整數半徑才會把兩者分開。
    const points = generateShape({
      kind: 'arch',
      center: ORIGIN,
      radius: 5.5,
      thickness: 2,
      depth: 1,
      span: 'x',
      rise: 'y',
      legHeight: 3,
    });
    const at = (y: number) =>
      points
        .filter((point) => point.y === y)
        .map((point) => point.x)
        .sort((left, right) => left - right);
    expect(at(ORIGIN.y)).toContain(5);
    expect(at(ORIGIN.y - 3)).toEqual(at(ORIGIN.y));
  });

  it('depth 是沿第三軸的進深，每一層都一樣', () => {
    const points = generateShape({
      kind: 'arch',
      center: ORIGIN,
      radius: 4,
      thickness: 1,
      depth: 3,
      span: 'x',
      rise: 'y',
      legHeight: 0,
    });
    const layers = new Map<number, number>();
    for (const point of points) layers.set(point.z, (layers.get(point.z) ?? 0) + 1);
    expect([...layers.keys()].sort((left, right) => left - right)).toEqual([0, 1, 2]);
    expect(new Set(layers.values()).size).toBe(1);
  });

  it('三個軸向組合都能擺，方塊數一致', () => {
    const counts = (['x', 'z'] as const).map(
      (span) =>
        generateShape({
          kind: 'arch',
          center: ORIGIN,
          radius: 4,
          thickness: 1,
          depth: 2,
          span,
          rise: 'y',
          legHeight: 2,
        }).length,
    );
    expect(new Set(counts).size).toBe(1);
  });

  it('跨距與上升不能是同一個軸', () => {
    expect(() =>
      generateShape({
        kind: 'arch',
        center: ORIGIN,
        radius: 4,
        thickness: 1,
        depth: 1,
        span: 'y',
        rise: 'y',
        legHeight: 0,
      }),
    ).toThrow(MinecraftBridgeError);
  });
});

describe('stairs（階梯）', () => {
  it('懸空踏板每階只有一格，實心會補滿到起點高度', () => {
    const base = {
      kind: 'stairs',
      from: ORIGIN,
      direction: 'x+',
      steps: 4,
      width: 1,
      stepRise: 1,
      stepRun: 1,
    } as const;
    expect(generateShape({ ...base, solid: false })).toHaveLength(4);
    // 1+2+3+4
    expect(generateShape({ ...base, solid: true })).toHaveLength(10);
  });

  it('每階的高度與前進距離照著 stepRise／stepRun 走', () => {
    const points = generateShape({
      kind: 'stairs',
      from: ORIGIN,
      direction: 'x+',
      steps: 3,
      width: 2,
      stepRise: 2,
      stepRun: 2,
      solid: false,
    });
    expect(points).toHaveLength(3 * 2 * 2 * 2);
    // 第 3 階（index 2）的踏面頂端在 y+5，起點在 x+4。
    expect(points.some((point) => point.x === 4 && point.y === ORIGIN.y + 5)).toBe(true);
    expect(points.every((point) => point.x <= 5)).toBe(true);
  });

  it('負方向真的往負座標走', () => {
    const points = generateShape({
      kind: 'stairs',
      from: ORIGIN,
      direction: 'z-',
      steps: 3,
      width: 1,
      stepRise: 1,
      stepRun: 1,
      solid: false,
    });
    expect(Math.min(...points.map((point) => point.z))).toBe(ORIGIN.z - 2);
    expect(Math.max(...points.map((point) => point.z))).toBe(ORIGIN.z);
  });

  it('階數不是正整數會拒絕', () => {
    expect(() =>
      generateShape({
        kind: 'stairs',
        from: ORIGIN,
        direction: 'x+',
        steps: 0,
        width: 1,
        stepRise: 1,
        stepRun: 1,
        solid: false,
      }),
    ).toThrow(MinecraftBridgeError);
  });
});

describe('prism（正 n 角柱）', () => {
  it('sides=4 rotation=0 與同尺寸的 box 逐格相同', () => {
    const prism = generateShape({
      kind: 'prism',
      center: ORIGIN,
      radius: 5,
      height: 3,
      sides: 4,
      rotation: 0,
      axis: 'y',
      hollow: false,
    });
    const box = generateShape({
      kind: 'box',
      from: { x: ORIGIN.x - 5, y: ORIGIN.y, z: ORIGIN.z - 5 },
      to: { x: ORIGIN.x + 5, y: ORIGIN.y + 2, z: ORIGIN.z + 5 },
      hollow: false,
    });
    expect(new Set(prism.map(keyOf))).toEqual(new Set(box.map(keyOf)));
  });

  it('邊數愈多愈接近同半徑的 cylinder', () => {
    const cylinder = generateShape({
      kind: 'cylinder',
      center: ORIGIN,
      radius: 8,
      height: 1,
      axis: 'y',
      hollow: false,
    }).length;
    const gap = (sides: number) =>
      Math.abs(
        generateShape({
          kind: 'prism',
          center: ORIGIN,
          radius: 8,
          height: 1,
          sides,
          rotation: 0,
          axis: 'y',
          hollow: false,
        }).length - cylinder,
      );
    expect(gap(12)).toBeLessThan(gap(3));
  });

  it('rotation 會轉出不同的一組方塊，但數量不變', () => {
    const make = (rotation: number) =>
      generateShape({
        kind: 'prism',
        center: ORIGIN,
        radius: 6,
        height: 1,
        sides: 6,
        rotation,
        axis: 'y',
        hollow: false,
      });
    const upright = make(0);
    const turned = make(30);
    expect(turned).toHaveLength(upright.length);
    const before = new Set(upright.map(keyOf));
    expect(turned.every((point) => before.has(keyOf(point)))).toBe(false);
  });

  it('邊數超出 3–12 會拒絕', () => {
    for (const sides of [2, 13, 6.5]) {
      expect(() =>
        generateShape({
          kind: 'prism',
          center: ORIGIN,
          radius: 5,
          height: 5,
          sides,
          rotation: 0,
          axis: 'y',
          hollow: false,
        }),
      ).toThrow(MinecraftBridgeError);
    }
  });
});

describe('pyramid 的邊數推廣', () => {
  it('sides=4 rotation=0 的每一層都是正方形，維持舊行為', () => {
    const points = generateShape({
      kind: 'pyramid',
      center: ORIGIN,
      baseRadius: 5,
      height: 6,
      sides: 4,
      rotation: 0,
      hollow: false,
    });
    const bottom = points.filter((point) => point.y === ORIGIN.y);
    expect(bottom).toHaveLength(11 * 11);
    const top = points.filter((point) => point.y === ORIGIN.y + 5);
    expect(top.length).toBeGreaterThan(0);
    expect(top.length).toBeLessThan(bottom.length);
  });

  it('每一層都比下面一層小或相等，收成尖的', () => {
    const points = generateShape({
      kind: 'pyramid',
      center: ORIGIN,
      baseRadius: 8,
      height: 8,
      sides: 6,
      rotation: 0,
      hollow: false,
    });
    const perLevel = new Map<number, number>();
    for (const point of points) perLevel.set(point.y, (perLevel.get(point.y) ?? 0) + 1);
    const levels = [...perLevel.keys()].sort((left, right) => left - right);
    for (let index = 1; index < levels.length; index += 1) {
      expect(perLevel.get(levels[index]!)!).toBeLessThanOrEqual(perLevel.get(levels[index - 1]!)!);
    }
  });
});
