import type { Point2D } from "@/domain/entities/Bed";

export function isPolygonClosed(points: Point2D[]): boolean {
  if (points.length < 3) return false;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return first.x === last.x && first.y === last.y;
}

export function polygonArea(points: Point2D[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    const pi = points[i]!;
    const pj = points[j]!;
    area += pi.x * pj.y;
    area -= pj.x * pi.y;
  }
  return Math.abs(area / 2);
}

export function isPointInsidePolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const xi = pi.x;
    const yi = pi.y;
    const xj = pj.x;
    const yj = pj.y;
    const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

type SegmentIntersection = { t: number; point: Point2D };

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function pointOnSegment(point: Point2D, a: Point2D, b: Point2D, epsilon = 1e-9): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const area2 = Math.abs(cross(abx, aby, apx, apy));
  if (area2 > epsilon) return false;
  const dot = apx * abx + apy * aby;
  if (dot < -epsilon) return false;
  const lenSq = abx * abx + aby * aby;
  if (dot - lenSq > epsilon) return false;
  return true;
}

function isPointOnPolygonBoundary(point: Point2D, polygon: Point2D[], epsilon = 1e-9): boolean {
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (!a || !b) continue;
    if (pointOnSegment(point, a, b, epsilon)) return true;
  }
  return false;
}

function isPointInsideOrOnPolygon(point: Point2D, polygon: Point2D[], epsilon = 1e-9): boolean {
  return isPointInsidePolygon(point, polygon) || isPointOnPolygonBoundary(point, polygon, epsilon);
}

function intersectSegments(
  p1: Point2D,
  p2: Point2D,
  q1: Point2D,
  q2: Point2D,
  epsilon = 1e-9
): SegmentIntersection | null {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;
  const qpx = q1.x - p1.x;
  const qpy = q1.y - p1.y;
  const rxs = cross(rx, ry, sx, sy);
  if (Math.abs(rxs) < epsilon) return null;
  const t = cross(qpx, qpy, sx, sy) / rxs;
  const u = cross(qpx, qpy, rx, ry) / rxs;
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return null;
  const clampedT = Math.max(0, Math.min(1, t));
  return {
    t: clampedT,
    point: {
      x: p1.x + clampedT * rx,
      y: p1.y + clampedT * ry,
    },
  };
}

function dedupeSortedTs(values: number[], epsilon = 1e-7): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const unique: number[] = [];
  for (const value of sorted) {
    if (unique.length === 0 || Math.abs(value - unique[unique.length - 1]!) > epsilon) {
      unique.push(value);
    }
  }
  return unique;
}

export function clipLineToPolygon(
  start: Point2D,
  end: Point2D,
  polygon: Point2D[],
  epsilon = 1e-7
): Array<{ start: Point2D; end: Point2D }> {
  if (polygon.length < 3) return [];
  const ts: number[] = [];
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (isPointInsideOrOnPolygon(start, polygon, epsilon)) ts.push(0);
  if (isPointInsideOrOnPolygon(end, polygon, epsilon)) ts.push(1);

  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (!a || !b) continue;
    const hit = intersectSegments(start, end, a, b, epsilon);
    if (hit) ts.push(hit.t);
  }

  const cutTs = dedupeSortedTs(ts, epsilon);
  if (cutTs.length < 2) return [];

  const segments: Array<{ start: Point2D; end: Point2D }> = [];
  for (let i = 0; i < cutTs.length - 1; i += 1) {
    const t0 = cutTs[i]!;
    const t1 = cutTs[i + 1]!;
    const mid = (t0 + t1) / 2;
    const midPoint = { x: start.x + dx * mid, y: start.y + dy * mid };
    if (!isPointInsideOrOnPolygon(midPoint, polygon, epsilon)) continue;
    segments.push({
      start: { x: start.x + dx * t0, y: start.y + dy * t0 },
      end: { x: start.x + dx * t1, y: start.y + dy * t1 },
    });
  }

  return segments;
}
