/**
 * 幾何產生器：把「一顆半徑 12 的空心球」這種意圖變成方塊座標集合。
 *
 * 設計取捨：實體形狀一律用「內部判定函式 + 外殼鄰居測試」表達，而不是每個形狀
 * 各寫一套空心數學。這樣新增形狀只要寫 inside()，空心行為自動一致，
 * 也不會出現某些形狀空心會破洞、某些不會的老問題。
 */

import type { Vec3 } from '../contracts.js';
import { MinecraftBridgeError } from '../contracts.js';

export const AXES = ['x', 'y', 'z'] as const;
export type Axis = (typeof AXES)[number];

export const SHAPE_KINDS = [
  'line',
  'box',
  'sphere',
  'ellipsoid',
  'cylinder',
  'cone',
  'pyramid',
  'disk',
  'torus',
  'helix',
  'curve',
  'revolution',
  'tube',
  'wedge',
  'arch',
  'stairs',
  'prism',
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export interface LineShape {
  readonly kind: 'line';
  readonly from: Vec3;
  readonly to: Vec3;
}
export interface BoxShape {
  readonly kind: 'box';
  readonly from: Vec3;
  readonly to: Vec3;
  readonly hollow: boolean;
}
export interface SphereShape {
  readonly kind: 'sphere';
  readonly center: Vec3;
  readonly radius: number;
  readonly hollow: boolean;
}
export interface EllipsoidShape {
  readonly kind: 'ellipsoid';
  readonly center: Vec3;
  readonly radii: Vec3;
  readonly hollow: boolean;
}
export interface CylinderShape {
  readonly kind: 'cylinder';
  readonly center: Vec3;
  readonly radius: number;
  readonly height: number;
  readonly axis: Axis;
  readonly hollow: boolean;
}
export interface ConeShape {
  readonly kind: 'cone';
  readonly center: Vec3;
  readonly radius: number;
  readonly height: number;
  readonly axis: Axis;
  readonly hollow: boolean;
}
export interface PyramidShape {
  readonly kind: 'pyramid';
  readonly center: Vec3;
  /** 底面中心到「邊」的距離（內切圓半徑），不是到頂點。 */
  readonly baseRadius: number;
  readonly height: number;
  /** 底面邊數。4 就是傳統方底金字塔，3 是三角錐，6 是六角錐。 */
  readonly sides: number;
  /** 底面繞 Y 軸旋轉幾度，用來對齊某一邊的朝向。 */
  readonly rotation: number;
  readonly hollow: boolean;
}
export interface DiskShape {
  readonly kind: 'disk';
  readonly center: Vec3;
  readonly radius: number;
  readonly axis: Axis;
  readonly hollow: boolean;
}
export interface TorusShape {
  readonly kind: 'torus';
  readonly center: Vec3;
  readonly majorRadius: number;
  readonly minorRadius: number;
  readonly axis: Axis;
}
export interface HelixShape {
  readonly kind: 'helix';
  readonly center: Vec3;
  readonly radius: number;
  readonly height: number;
  readonly turns: number;
  readonly axis: Axis;
  readonly thickness: number;
}

/**
 * 通過控制點的平滑曲線（Catmull-Rom）。
 *
 * 跟 line 的差別：line 是兩點之間的直線，curve 會「穿過」你給的每一個控制點
 * 並在之間補出平滑轉折。拿來蓋河道、道路、藤蔓、纜線這種不該是折線的東西。
 */
export interface CurveShape {
  readonly kind: 'curve';
  readonly points: readonly Vec3[];
  readonly thickness: number;
  /** true 時首尾相接成封閉迴圈。 */
  readonly closed: boolean;
}

/** 旋轉體的側面輪廓取樣點：距軸心半徑，以及沿軸的位置。 */
export interface RevolutionProfilePoint {
  readonly along: number;
  readonly radius: number;
}

/**
 * 旋轉體：把一條側面輪廓繞軸旋轉一圈。
 *
 * 半徑在相鄰輪廓點之間線性內插，所以少數幾個點就能長出花瓶、塔樓、圓頂、
 * 高腳杯這類「圓的但粗細會變」的量體——那是 cylinder 與 cone 都做不到的。
 */
export interface RevolutionShape {
  readonly kind: 'revolution';
  readonly center: Vec3;
  readonly axis: Axis;
  readonly profile: readonly RevolutionProfilePoint[];
  /** true 只留側面殼層，false 每一層都填實。 */
  readonly hollow: boolean;
}

/**
 * 任意方向的圓柱（膠囊）。
 *
 * cylinder 只能對齊 x／y／z 三軸，斜的柱子、樑、管線、樹幹一律做不出來。
 * 這個形狀用「點到線段的距離」判定，所以兩端點愛擺哪就擺哪。
 *
 * 兩端是半球形收尾（膠囊），不是切平的。hollow 給的是**封閉**殼層而不是
 * 開口的管子——外殼判定會把兩端的蓋子一起算進去，所以水流不過去。半徑很小時
 * 殼會吃掉幾乎整根，只在軸心留下一條線。
 */
export interface TubeShape {
  readonly kind: 'tube';
  readonly from: Vec3;
  readonly to: Vec3;
  readonly radius: number;
  readonly hollow: boolean;
}

/**
 * 楔形斜面：一個 box 被斜切成三角形斷面。
 *
 * `run` 軸是斜面下降的方向，`rise` 軸是高度方向，第三軸維持滿寬。起點端是
 * 滿高，終點端剩一格高——所以它是走得上去的坡道，不是收到零的刀鋒。
 * 單斜屋頂、坡道、擋土坡直接用；人字屋頂就是兩個 reversed 相反的楔形對貼。
 */
export interface WedgeShape {
  readonly kind: 'wedge';
  readonly from: Vec3;
  readonly to: Vec3;
  readonly rise: Axis;
  readonly run: Axis;
  /** false 沿 run 軸正向變矮，true 反向。 */
  readonly reversed: boolean;
  readonly hollow: boolean;
}

/**
 * 半圓拱：拱面上的半圓環，沿第三軸擠出進深。
 *
 * `center` 是起拱線的中心（兩隻拱腳連線的中點），拱圈本身是實體、中間的洞
 * 是開口。開口寬度為 2×radius−1。`legHeight` 把兩側直柱往起拱線下方延伸，
 * 城門與橋拱需要它；設 0 就是純粹的半圓。
 */
export interface ArchShape {
  readonly kind: 'arch';
  readonly center: Vec3;
  readonly radius: number;
  readonly thickness: number;
  readonly depth: number;
  readonly span: Axis;
  readonly rise: Axis;
  readonly legHeight: number;
}

export const STAIR_DIRECTIONS = ['x+', 'x-', 'z+', 'z-'] as const;
export type StairDirection = (typeof STAIR_DIRECTIONS)[number];

/**
 * 階梯。一律沿 Y 軸上升，水平前進方向由 `direction` 決定。
 *
 * `from` 是第一階踏面的起點角落：最低、最靠近起點、寬度方向的座標最小那一格。
 * `solid` 決定要不要把每一階往下補滿到起點高度——false 是懸空踏板，true 是
 * 實心梯體（金字塔階梯、看台）。
 */
export interface StairsShape {
  readonly kind: 'stairs';
  readonly from: Vec3;
  readonly direction: StairDirection;
  readonly steps: number;
  readonly width: number;
  readonly stepRise: number;
  readonly stepRun: number;
  readonly solid: boolean;
}

/**
 * 正 n 角柱。
 *
 * `radius` 是中心到**邊**的距離（內切圓半徑）而不是到頂點，所以邊數愈多就
 * 愈接近同半徑的 cylinder——prism 是 cylinder 的推廣，不是另一套東西。
 * sides=4 得到的正方柱寬度與同半徑的 box 一致。
 */
export interface PrismShape {
  readonly kind: 'prism';
  readonly center: Vec3;
  readonly radius: number;
  readonly height: number;
  readonly sides: number;
  readonly rotation: number;
  readonly axis: Axis;
  readonly hollow: boolean;
}

export type ShapeSpec =
  | LineShape
  | BoxShape
  | SphereShape
  | EllipsoidShape
  | CylinderShape
  | ConeShape
  | PyramidShape
  | DiskShape
  | TorusShape
  | HelixShape
  | CurveShape
  | RevolutionShape
  | TubeShape
  | WedgeShape
  | ArchShape
  | StairsShape
  | PrismShape;

/** 掃描體積硬上限，避免呼叫端用一個荒謬半徑把行程撐爆。 */
export const MAX_SCAN_VOLUME = 8_000_000;

interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

type InsideTest = (x: number, y: number, z: number) => boolean;

const SIX_NEIGHBOURS: readonly Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

function axisComponents(
  point: Vec3,
  axis: Axis,
): { readonly along: number; readonly u: number; readonly v: number } {
  if (axis === 'y') return { along: point.y, u: point.x, v: point.z };
  if (axis === 'x') return { along: point.x, u: point.y, v: point.z };
  return { along: point.z, u: point.x, v: point.y };
}

function assertPositive(value: number, label: string, max: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new MinecraftBridgeError('invalid-shape', `${label} 必須是正數，實際收到：${String(value)}`);
  }
  if (value > max) {
    throw new MinecraftBridgeError(
      'invalid-shape',
      `${label} ${String(value)} 超過上限 ${String(max)}。`,
    );
  }
  return value;
}

function scanSolid(bounds: Bounds, inside: InsideTest, hollow: boolean, neighbours: readonly Vec3[]): Vec3[] {
  const spanX = bounds.max.x - bounds.min.x + 1;
  const spanY = bounds.max.y - bounds.min.y + 1;
  const spanZ = bounds.max.z - bounds.min.z + 1;
  const volume = spanX * spanY * spanZ;

  if (volume > MAX_SCAN_VOLUME) {
    throw new MinecraftBridgeError(
      'shape-too-large',
      `形狀掃描體積 ${String(volume)} 超過上限 ${String(MAX_SCAN_VOLUME)}；請縮小尺寸或拆成多次建造。`,
    );
  }

  const points: Vec3[] = [];
  for (let y = bounds.min.y; y <= bounds.max.y; y += 1) {
    for (let z = bounds.min.z; z <= bounds.max.z; z += 1) {
      for (let x = bounds.min.x; x <= bounds.max.x; x += 1) {
        if (!inside(x, y, z)) continue;
        if (hollow) {
          let onShell = false;
          for (const offset of neighbours) {
            if (!inside(x + offset.x, y + offset.y, z + offset.z)) {
              onShell = true;
              break;
            }
          }
          if (!onShell) continue;
        }
        points.push({ x, y, z });
      }
    }
  }
  return points;
}

function planeNeighbours(axis: Axis): readonly Vec3[] {
  if (axis === 'y') {
    return [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ];
  }
  if (axis === 'x') {
    return [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ];
  }
  return [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
  ];
}

function line3d(from: Vec3, to: Vec3): Vec3[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));

  if (steps === 0) return [{ x: from.x, y: from.y, z: from.z }];
  if (steps > 4096) {
    throw new MinecraftBridgeError('shape-too-large', `線段長度 ${String(steps)} 超過上限 4096。`);
  }

  const points: Vec3[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push({
      x: Math.round(from.x + dx * t),
      y: Math.round(from.y + dy * t),
      z: Math.round(from.z + dz * t),
    });
  }
  return points;
}

function thicken(points: readonly Vec3[], thickness: number): Vec3[] {
  if (thickness <= 1) return [...points];
  const radius = (thickness - 1) / 2;
  const limit = radius * radius + 0.25;
  const span = Math.ceil(radius);
  const seen = new Set<string>();
  const result: Vec3[] = [];

  for (const point of points) {
    for (let dy = -span; dy <= span; dy += 1) {
      for (let dz = -span; dz <= span; dz += 1) {
        for (let dx = -span; dx <= span; dx += 1) {
          if (dx * dx + dy * dy + dz * dz > limit) continue;
          const candidate = { x: point.x + dx, y: point.y + dy, z: point.z + dz };
          const key = `${String(candidate.x)},${String(candidate.y)},${String(candidate.z)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push(candidate);
        }
      }
    }
  }
  return result;
}

function dedupe(points: readonly Vec3[]): Vec3[] {
  const seen = new Set<string>();
  const result: Vec3[] = [];
  for (const point of points) {
    const key = `${String(point.x)},${String(point.y)},${String(point.z)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result;
}

function assertPositiveInteger(value: number, label: string, max: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new MinecraftBridgeError(
      'invalid-shape',
      `${label} 必須是正整數，實際收到：${String(value)}`,
    );
  }
  if (value > max) {
    throw new MinecraftBridgeError(
      'invalid-shape',
      `${label} ${String(value)} 超過上限 ${String(max)}。`,
    );
  }
  return value;
}

function assertNonNegative(value: number, label: string, max: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new MinecraftBridgeError(
      'invalid-shape',
      `${label} 不能是負數，實際收到：${String(value)}`,
    );
  }
  if (value > max) {
    throw new MinecraftBridgeError(
      'invalid-shape',
      `${label} ${String(value)} 超過上限 ${String(max)}。`,
    );
  }
  return value;
}

function assertSides(value: number): number {
  if (!Number.isInteger(value) || value < 3 || value > 12) {
    throw new MinecraftBridgeError(
      'invalid-shape',
      `邊數必須是 3 到 12 的整數，實際收到：${String(value)}`,
    );
  }
  return value;
}

function assertDistinctAxes(first: Axis, second: Axis, label: string): void {
  if (first === second) {
    throw new MinecraftBridgeError('invalid-shape', `${label}不能是同一個軸（都是 ${first}）。`);
  }
}

function axisValue(point: Vec3, axis: Axis): number {
  if (axis === 'x') return point.x;
  if (axis === 'y') return point.y;
  return point.z;
}

/** 三軸中不是 first 也不是 second 的那一個。呼叫前必須先確認兩軸不同。 */
function remainingAxis(first: Axis, second: Axis): Axis {
  for (const axis of AXES) {
    if (axis !== first && axis !== second) return axis;
  }
  throw new MinecraftBridgeError('invalid-shape', '找不到第三個軸。');
}

/** 以每個軸各自的偏移量組出座標；軸由參數決定的形狀（wedge／arch／stairs）用它。 */
function offsetOnAxes(base: Vec3, offsets: readonly (readonly [Axis, number])[]): Vec3 {
  const result = { x: base.x, y: base.y, z: base.z };
  for (const [axis, delta] of offsets) {
    if (axis === 'x') result.x += delta;
    else if (axis === 'y') result.y += delta;
    else result.z += delta;
  }
  return result;
}

interface PlanarNormal {
  readonly cos: number;
  readonly sin: number;
}

/**
 * 正多邊形的邊法向量。判定寫成「所有邊法向量的投影都不超過內切圓半徑」，
 * 因為那是半平面交集，邊數改變時不必換一套數學——sides=4 退化回
 * `|du| <= r && |dv| <= r`，與舊版方底金字塔逐格相同。
 */
function polygonNormals(sides: number, rotationDegrees: number): readonly PlanarNormal[] {
  const base = (rotationDegrees * Math.PI) / 180;
  const normals: PlanarNormal[] = [];
  for (let k = 0; k < sides; k += 1) {
    const angle = base + (k * 2 * Math.PI) / sides;
    normals.push({ cos: Math.cos(angle), sin: Math.sin(angle) });
  }
  return normals;
}

function insidePolygon(
  du: number,
  dv: number,
  apothem: number,
  normals: readonly PlanarNormal[],
): boolean {
  const limit = apothem + 0.5;
  for (const normal of normals) {
    if (du * normal.cos + dv * normal.sin > limit) return false;
  }
  return true;
}

/**
 * 多邊形在平面上的軸對齊半徑，拿來算掃描邊界盒。
 *
 * 不能直接用外接圓半徑：sides=4 rotation=0 的正方形，外接圓比它的 AABB 大
 * 1.414 倍，那樣每次都白掃一圈。改成實際取所有頂點的投影極值。
 */
function polygonExtent(apothem: number, sides: number, rotationDegrees: number): number {
  const circumradius = apothem / Math.cos(Math.PI / sides);
  const base = (rotationDegrees * Math.PI) / 180 + Math.PI / sides;
  let extent = 0;
  for (let k = 0; k < sides; k += 1) {
    const angle = base + (k * 2 * Math.PI) / sides;
    extent = Math.max(extent, Math.abs(circumradius * Math.cos(angle)));
    extent = Math.max(extent, Math.abs(circumradius * Math.sin(angle)));
  }
  return Math.ceil(extent + 0.5);
}

/** 點到線段的最短距離平方。線段退化成一點時就是點到點的距離。 */
function distanceToSegmentSquared(x: number, y: number, z: number, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;

  let t = 0;
  if (lengthSquared > 0) {
    t = ((x - from.x) * dx + (y - from.y) * dy + (z - from.z) * dz) / lengthSquared;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }

  const ex = x - (from.x + dx * t);
  const ey = y - (from.y + dy * t);
  const ez = z - (from.z + dz * t);
  return ex * ex + ey * ey + ez * ez;
}

export function generateShape(spec: ShapeSpec): Vec3[] {
  switch (spec.kind) {
    case 'line':
      return dedupe(line3d(spec.from, spec.to));

    case 'box': {
      const min = {
        x: Math.min(spec.from.x, spec.to.x),
        y: Math.min(spec.from.y, spec.to.y),
        z: Math.min(spec.from.z, spec.to.z),
      };
      const max = {
        x: Math.max(spec.from.x, spec.to.x),
        y: Math.max(spec.from.y, spec.to.y),
        z: Math.max(spec.from.z, spec.to.z),
      };
      const inside: InsideTest = (x, y, z) =>
        x >= min.x && x <= max.x && y >= min.y && y <= max.y && z >= min.z && z <= max.z;
      return scanSolid({ min, max }, inside, spec.hollow, SIX_NEIGHBOURS);
    }

    case 'sphere': {
      const r = assertPositive(spec.radius, '球半徑', 128);
      const limit = (r + 0.5) * (r + 0.5);
      const span = Math.ceil(r);
      const bounds: Bounds = {
        min: { x: spec.center.x - span, y: spec.center.y - span, z: spec.center.z - span },
        max: { x: spec.center.x + span, y: spec.center.y + span, z: spec.center.z + span },
      };
      const inside: InsideTest = (x, y, z) => {
        const dx = x - spec.center.x;
        const dy = y - spec.center.y;
        const dz = z - spec.center.z;
        return dx * dx + dy * dy + dz * dz <= limit;
      };
      return scanSolid(bounds, inside, spec.hollow, SIX_NEIGHBOURS);
    }

    case 'ellipsoid': {
      const rx = assertPositive(spec.radii.x, 'X 半徑', 128);
      const ry = assertPositive(spec.radii.y, 'Y 半徑', 128);
      const rz = assertPositive(spec.radii.z, 'Z 半徑', 128);
      const bounds: Bounds = {
        min: {
          x: spec.center.x - Math.ceil(rx),
          y: spec.center.y - Math.ceil(ry),
          z: spec.center.z - Math.ceil(rz),
        },
        max: {
          x: spec.center.x + Math.ceil(rx),
          y: spec.center.y + Math.ceil(ry),
          z: spec.center.z + Math.ceil(rz),
        },
      };
      const inside: InsideTest = (x, y, z) => {
        const dx = (x - spec.center.x) / (rx + 0.5);
        const dy = (y - spec.center.y) / (ry + 0.5);
        const dz = (z - spec.center.z) / (rz + 0.5);
        return dx * dx + dy * dy + dz * dz <= 1;
      };
      return scanSolid(bounds, inside, spec.hollow, SIX_NEIGHBOURS);
    }

    case 'cylinder': {
      const r = assertPositive(spec.radius, '圓柱半徑', 128);
      const h = assertPositive(spec.height, '圓柱高度', 384);
      const span = Math.ceil(r);
      const height = Math.round(h);
      const limit = (r + 0.5) * (r + 0.5);
      const bounds = axialBounds(spec.center, spec.axis, span, height);
      const centerParts = axisComponents(spec.center, spec.axis);
      const inside: InsideTest = (x, y, z) => {
        const parts = axisComponents({ x, y, z }, spec.axis);
        if (parts.along < centerParts.along || parts.along > centerParts.along + height - 1) {
          return false;
        }
        const du = parts.u - centerParts.u;
        const dv = parts.v - centerParts.v;
        return du * du + dv * dv <= limit;
      };
      return scanSolid(bounds, inside, spec.hollow, SIX_NEIGHBOURS);
    }

    case 'cone': {
      const r = assertPositive(spec.radius, '圓錐底半徑', 128);
      const h = assertPositive(spec.height, '圓錐高度', 384);
      const span = Math.ceil(r);
      const height = Math.round(h);
      const bounds = axialBounds(spec.center, spec.axis, span, height);
      const centerParts = axisComponents(spec.center, spec.axis);
      const inside: InsideTest = (x, y, z) => {
        const parts = axisComponents({ x, y, z }, spec.axis);
        const level = parts.along - centerParts.along;
        if (level < 0 || level > height - 1) return false;
        const scaled = r * (1 - level / height);
        const limit = (scaled + 0.5) * (scaled + 0.5);
        const du = parts.u - centerParts.u;
        const dv = parts.v - centerParts.v;
        return du * du + dv * dv <= limit;
      };
      return scanSolid(bounds, inside, spec.hollow, SIX_NEIGHBOURS);
    }

    case 'pyramid': {
      const base = assertPositive(spec.baseRadius, '金字塔底半徑', 128);
      const h = assertPositive(spec.height, '金字塔高度', 384);
      const sides = assertSides(spec.sides);
      const normals = polygonNormals(sides, spec.rotation);
      const span = polygonExtent(base, sides, spec.rotation);
      const height = Math.round(h);
      const bounds: Bounds = {
        min: { x: spec.center.x - span, y: spec.center.y, z: spec.center.z - span },
        max: { x: spec.center.x + span, y: spec.center.y + height - 1, z: spec.center.z + span },
      };
      const inside: InsideTest = (x, y, z) => {
        const level = y - spec.center.y;
        if (level < 0 || level > height - 1) return false;
        const scaled = base * (1 - level / height);
        return insidePolygon(x - spec.center.x, z - spec.center.z, scaled, normals);
      };
      return scanSolid(bounds, inside, spec.hollow, SIX_NEIGHBOURS);
    }

    case 'disk': {
      const r = assertPositive(spec.radius, '圓盤半徑', 256);
      const span = Math.ceil(r);
      const limit = (r + 0.5) * (r + 0.5);
      const bounds = axialBounds(spec.center, spec.axis, span, 1);
      const centerParts = axisComponents(spec.center, spec.axis);
      const inside: InsideTest = (x, y, z) => {
        const parts = axisComponents({ x, y, z }, spec.axis);
        if (parts.along !== centerParts.along) return false;
        const du = parts.u - centerParts.u;
        const dv = parts.v - centerParts.v;
        return du * du + dv * dv <= limit;
      };
      return scanSolid(bounds, inside, spec.hollow, planeNeighbours(spec.axis));
    }

    case 'torus': {
      const major = assertPositive(spec.majorRadius, '環面主半徑', 128);
      const minor = assertPositive(spec.minorRadius, '環面副半徑', 64);
      const spanPlane = Math.ceil(major + minor);
      const spanAlong = Math.ceil(minor);
      const bounds = axialBounds(spec.center, spec.axis, spanPlane, spanAlong * 2 + 1, spanAlong);
      const centerParts = axisComponents(spec.center, spec.axis);
      const limit = (minor + 0.5) * (minor + 0.5);
      const inside: InsideTest = (x, y, z) => {
        const parts = axisComponents({ x, y, z }, spec.axis);
        const du = parts.u - centerParts.u;
        const dv = parts.v - centerParts.v;
        const dw = parts.along - centerParts.along;
        const planar = Math.sqrt(du * du + dv * dv) - major;
        return planar * planar + dw * dw <= limit;
      };
      return scanSolid(bounds, inside, false, SIX_NEIGHBOURS);
    }

    case 'helix': {
      const r = assertPositive(spec.radius, '螺旋半徑', 128);
      const h = assertPositive(spec.height, '螺旋高度', 384);
      const turns = assertPositive(spec.turns, '圈數', 64);
      const thickness = assertPositive(spec.thickness, '線寬', 7);
      const height = Math.round(h);
      const steps = Math.max(height * 8, Math.round(turns * 64));
      if (steps > 40_000) {
        throw new MinecraftBridgeError('shape-too-large', '螺旋取樣點過多；請降低高度或圈數。');
      }

      const raw: Vec3[] = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const angle = t * turns * Math.PI * 2;
        const u = Math.round(r * Math.cos(angle));
        const v = Math.round(r * Math.sin(angle));
        const along = Math.round(t * (height - 1));
        raw.push(fromAxisComponents(spec.center, spec.axis, along, u, v));
      }
      return dedupe(thicken(dedupe(raw), thickness));
    }

    case 'curve': {
      const thickness = assertPositive(spec.thickness, '線寬', 7);
      const control = spec.points;
      if (control.length < 2) {
        throw new MinecraftBridgeError('invalid-shape', '曲線至少需要 2 個控制點。');
      }
      if (control.length > 64) {
        throw new MinecraftBridgeError('shape-too-large', '曲線控制點上限 64 個。');
      }

      // Catmull-Rom 需要每段前後各一個額外控制點。開放曲線把端點複製一份當
      // 虛擬鄰居，封閉曲線則環繞取用——否則頭尾兩段會少了張力而變成直線。
      const size = control.length;
      const at = (index: number): Vec3 => {
        if (spec.closed) return control[((index % size) + size) % size]!;
        return control[Math.min(Math.max(index, 0), size - 1)]!;
      };

      const segments = spec.closed ? size : size - 1;
      const raw: Vec3[] = [];
      let sampled = 0;
      for (let segment = 0; segment < segments; segment += 1) {
        const p0 = at(segment - 1);
        const p1 = at(segment);
        const p2 = at(segment + 1);
        const p3 = at(segment + 2);
        // 取樣密度跟著段長走：短段不必浪費、長段不會出現斷點。
        const span = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
        const steps = Math.max(2, Math.ceil(span * 3));
        sampled += steps;
        if (sampled > 60_000) {
          throw new MinecraftBridgeError('shape-too-large', '曲線取樣點過多；請減少控制點或縮短距離。');
        }
        for (let step = 0; step < steps; step += 1) {
          const t = step / steps;
          raw.push({
            x: Math.round(catmullRom(p0.x, p1.x, p2.x, p3.x, t)),
            y: Math.round(catmullRom(p0.y, p1.y, p2.y, p3.y, t)),
            z: Math.round(catmullRom(p0.z, p1.z, p2.z, p3.z, t)),
          });
        }
      }
      if (!spec.closed) raw.push(at(size - 1));
      return dedupe(thicken(dedupe(raw), thickness));
    }

    case 'revolution': {
      const profile = spec.profile;
      if (profile.length < 2) {
        throw new MinecraftBridgeError('invalid-shape', '旋轉體輪廓至少需要 2 個取樣點。');
      }
      if (profile.length > 64) {
        throw new MinecraftBridgeError('shape-too-large', '旋轉體輪廓點上限 64 個。');
      }
      // 依 along 排序，呼叫端不必自己保證順序；相同 along 會讓內插除以零。
      const sorted = [...profile].sort((left, right) => left.along - right.along);
      for (const point of sorted) {
        if (!Number.isFinite(point.along) || !Number.isFinite(point.radius)) {
          throw new MinecraftBridgeError('invalid-shape', '旋轉體輪廓含非有限數值。');
        }
        if (point.radius < 0) {
          throw new MinecraftBridgeError('invalid-shape', '旋轉體半徑不可為負。');
        }
        if (point.radius > 128) {
          throw new MinecraftBridgeError('shape-too-large', '旋轉體半徑上限 128。');
        }
      }
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;
      const lowest = Math.round(first.along);
      const highest = Math.round(last.along);
      if (highest - lowest > 384) {
        throw new MinecraftBridgeError('shape-too-large', '旋轉體高度上限 384。');
      }

      const raw: Vec3[] = [];
      for (let along = lowest; along <= highest; along += 1) {
        const radius = interpolateRadius(sorted, along);
        if (radius < 0.5) {
          raw.push(fromAxisComponents(spec.center, spec.axis, along, 0, 0));
          continue;
        }
        const span = Math.ceil(radius);
        const outer = radius * radius + radius * 0.5;
        const inner = (radius - 1) * (radius - 1);
        for (let v = -span; v <= span; v += 1) {
          for (let u = -span; u <= span; u += 1) {
            const distance = u * u + v * v;
            if (distance > outer) continue;
            if (spec.hollow && distance < inner) continue;
            raw.push(fromAxisComponents(spec.center, spec.axis, along, u, v));
          }
        }
      }
      return dedupe(raw);
    }

    case 'tube': {
      const radius = assertPositive(spec.radius, '管半徑', 64);
      const limit = (radius + 0.5) * (radius + 0.5);
      const span = Math.ceil(radius) + 1;
      const bounds: Bounds = {
        min: {
          x: Math.min(spec.from.x, spec.to.x) - span,
          y: Math.min(spec.from.y, spec.to.y) - span,
          z: Math.min(spec.from.z, spec.to.z) - span,
        },
        max: {
          x: Math.max(spec.from.x, spec.to.x) + span,
          y: Math.max(spec.from.y, spec.to.y) + span,
          z: Math.max(spec.from.z, spec.to.z) + span,
        },
      };
      const inside: InsideTest = (x, y, z) =>
        distanceToSegmentSquared(x, y, z, spec.from, spec.to) <= limit;
      return scanSolid(bounds, inside, spec.hollow, SIX_NEIGHBOURS);
    }

    case 'wedge': {
      assertDistinctAxes(spec.rise, spec.run, '楔形的上升方向與下降方向');
      const min = {
        x: Math.min(spec.from.x, spec.to.x),
        y: Math.min(spec.from.y, spec.to.y),
        z: Math.min(spec.from.z, spec.to.z),
      };
      const max = {
        x: Math.max(spec.from.x, spec.to.x),
        y: Math.max(spec.from.y, spec.to.y),
        z: Math.max(spec.from.z, spec.to.z),
      };
      const riseSpan = axisValue(max, spec.rise) - axisValue(min, spec.rise) + 1;
      const runSpan = axisValue(max, spec.run) - axisValue(min, spec.run) + 1;
      const riseBase = axisValue(min, spec.rise);
      const runBase = axisValue(min, spec.run);

      const inside: InsideTest = (x, y, z) => {
        if (x < min.x || x > max.x || y < min.y || y > max.y || z < min.z || z > max.z) return false;
        const point = { x, y, z };
        // 任一方向只有一格厚就沒有斜率可言，退化成整個 box 才是合理行為。
        const riseRatio =
          riseSpan <= 1 ? 0 : (axisValue(point, spec.rise) - riseBase) / (riseSpan - 1);
        let runRatio = 0;
        if (runSpan > 1) {
          runRatio = (axisValue(point, spec.run) - runBase) / (runSpan - 1);
          if (spec.reversed) runRatio = 1 - runRatio;
        }
        // 1e-9 是給浮點除法的餘裕；少了它，剛好落在斜面上的整數格會被判在外面。
        return riseRatio <= 1 - runRatio + 1e-9;
      };
      return scanSolid({ min, max }, inside, spec.hollow, SIX_NEIGHBOURS);
    }

    case 'arch': {
      assertDistinctAxes(spec.span, spec.rise, '拱的跨距方向與上升方向');
      const radius = assertPositive(spec.radius, '拱內緣半徑', 128);
      const thickness = assertPositive(spec.thickness, '拱圈厚度', 64);
      const depth = assertPositiveInteger(spec.depth, '拱進深', 256);
      const legHeight = assertNonNegative(spec.legHeight, '拱腳高度', 256);

      const depthAxis = remainingAxis(spec.span, spec.rise);
      const inner = radius - 0.5;
      const outer = radius + thickness - 0.5;
      const innerSquared = inner * inner;
      const outerSquared = outer * outer;
      const planarSpan = Math.ceil(outer);
      const legs = Math.round(legHeight);

      const bounds: Bounds = {
        min: offsetOnAxes(spec.center, [
          [spec.span, -planarSpan],
          [spec.rise, -legs],
          [depthAxis, 0],
        ]),
        max: offsetOnAxes(spec.center, [
          [spec.span, planarSpan],
          [spec.rise, planarSpan],
          [depthAxis, depth - 1],
        ]),
      };
      const centerSpan = axisValue(spec.center, spec.span);
      const centerRise = axisValue(spec.center, spec.rise);
      const centerDepth = axisValue(spec.center, depthAxis);

      const inside: InsideTest = (x, y, z) => {
        const point = { x, y, z };
        const alongDepth = axisValue(point, depthAxis) - centerDepth;
        if (alongDepth < 0 || alongDepth > depth - 1) return false;

        const across = axisValue(point, spec.span) - centerSpan;
        const up = axisValue(point, spec.rise) - centerRise;
        if (up >= 0) {
          const distanceSquared = across * across + up * up;
          return distanceSquared >= innerSquared && distanceSquared <= outerSquared;
        }
        // 起拱線以下是兩根直柱，寬度與拱圈在起拱線的落點完全對齊。
        if (up < -legs) return false;
        const horizontal = Math.abs(across);
        return horizontal >= inner && horizontal <= outer;
      };
      return scanSolid(bounds, inside, false, SIX_NEIGHBOURS);
    }

    case 'stairs': {
      const steps = assertPositiveInteger(spec.steps, '階數', 256);
      const width = assertPositiveInteger(spec.width, '梯寬', 64);
      const stepRise = assertPositiveInteger(spec.stepRise, '每階上升', 8);
      const stepRun = assertPositiveInteger(spec.stepRun, '每階前進', 8);

      const forward: Axis = spec.direction === 'x+' || spec.direction === 'x-' ? 'x' : 'z';
      const sign = spec.direction === 'x+' || spec.direction === 'z+' ? 1 : -1;
      const sideways: Axis = forward === 'x' ? 'z' : 'x';

      // 實心梯體最高那一階要從地面補滿，所以成本是階數的平方級；先擋掉再說。
      const perStep = spec.solid ? steps * stepRise : stepRise;
      const estimate = steps * stepRun * width * perStep;
      if (estimate > MAX_SCAN_VOLUME) {
        throw new MinecraftBridgeError(
          'shape-too-large',
          `階梯方塊數估計 ${String(estimate)} 超過上限 ${String(MAX_SCAN_VOLUME)}；請降低階數、梯寬或改成非實心。`,
        );
      }

      const raw: Vec3[] = [];
      for (let step = 0; step < steps; step += 1) {
        const top = step * stepRise + stepRise - 1;
        const bottom = spec.solid ? 0 : step * stepRise;
        for (let level = bottom; level <= top; level += 1) {
          for (let run = 0; run < stepRun; run += 1) {
            for (let side = 0; side < width; side += 1) {
              raw.push(
                offsetOnAxes(spec.from, [
                  [forward, sign * (step * stepRun + run)],
                  ['y', level],
                  [sideways, side],
                ]),
              );
            }
          }
        }
      }
      return dedupe(raw);
    }

    case 'prism': {
      const r = assertPositive(spec.radius, '角柱半徑', 128);
      const h = assertPositive(spec.height, '角柱高度', 384);
      const sides = assertSides(spec.sides);
      const normals = polygonNormals(sides, spec.rotation);
      const span = polygonExtent(r, sides, spec.rotation);
      const height = Math.round(h);
      const bounds = axialBounds(spec.center, spec.axis, span, height);
      const centerParts = axisComponents(spec.center, spec.axis);
      const inside: InsideTest = (x, y, z) => {
        const parts = axisComponents({ x, y, z }, spec.axis);
        if (parts.along < centerParts.along || parts.along > centerParts.along + height - 1) {
          return false;
        }
        return insidePolygon(parts.u - centerParts.u, parts.v - centerParts.v, r, normals);
      };
      return scanSolid(bounds, inside, spec.hollow, SIX_NEIGHBOURS);
    }

    default: {
      const exhaustive: never = spec;
      throw new MinecraftBridgeError('invalid-shape', `未知形狀：${JSON.stringify(exhaustive)}`);
    }
  }
}

function axialBounds(
  center: Vec3,
  axis: Axis,
  planarSpan: number,
  alongLength: number,
  alongOffset = 0,
): Bounds {
  const startAlong = -alongOffset;
  const endAlong = alongLength - 1 - alongOffset;

  if (axis === 'y') {
    return {
      min: { x: center.x - planarSpan, y: center.y + startAlong, z: center.z - planarSpan },
      max: { x: center.x + planarSpan, y: center.y + endAlong, z: center.z + planarSpan },
    };
  }
  if (axis === 'x') {
    return {
      min: { x: center.x + startAlong, y: center.y - planarSpan, z: center.z - planarSpan },
      max: { x: center.x + endAlong, y: center.y + planarSpan, z: center.z + planarSpan },
    };
  }
  return {
    min: { x: center.x - planarSpan, y: center.y - planarSpan, z: center.z + startAlong },
    max: { x: center.x + planarSpan, y: center.y + planarSpan, z: center.z + endAlong },
  };
}

/** Catmull-Rom 單軸取值。t 在 [0,1)，曲線保證通過 p1 與 p2。 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** 在排序過的輪廓上依 along 線性內插半徑；超出兩端則夾到端點值。 */
function interpolateRadius(profile: readonly RevolutionProfilePoint[], along: number): number {
  const first = profile[0]!;
  const last = profile[profile.length - 1]!;
  if (along <= first.along) return first.radius;
  if (along >= last.along) return last.radius;
  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1]!;
    const current = profile[index]!;
    if (along > current.along) continue;
    const span = current.along - previous.along;
    if (span === 0) return current.radius;
    const ratio = (along - previous.along) / span;
    return previous.radius + (current.radius - previous.radius) * ratio;
  }
  return last.radius;
}

function fromAxisComponents(center: Vec3, axis: Axis, along: number, u: number, v: number): Vec3 {
  if (axis === 'y') return { x: center.x + u, y: center.y + along, z: center.z + v };
  if (axis === 'x') return { x: center.x + along, y: center.y + u, z: center.z + v };
  return { x: center.x + u, y: center.y + v, z: center.z + along };
}
