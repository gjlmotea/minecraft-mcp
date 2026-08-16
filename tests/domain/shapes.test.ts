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
