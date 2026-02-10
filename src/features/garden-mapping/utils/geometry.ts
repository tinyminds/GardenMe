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
