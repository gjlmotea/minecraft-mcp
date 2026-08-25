import { describe, expect, it } from 'vitest';

import { MinecraftBridgeError } from '../../src/domain/contracts.js';
import { generateShape } from '../../src/domain/build/shapes.js';

const ORIGIN = { x: 0, y: 64, z: 0 };

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
