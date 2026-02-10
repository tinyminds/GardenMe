import { isPointInsidePolygon, polygonArea } from "@/features/garden-mapping/utils/geometry";

describe("geometry utilities", () => {
  it("computes area", () => {
    const area = polygonArea([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(area).toBe(2);
  });

  it("detects inside point", () => {
    const inside = isPointInsidePolygon(
      { x: 0.5, y: 0.5 },
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
    );
    expect(inside).toBe(true);
  });
});
