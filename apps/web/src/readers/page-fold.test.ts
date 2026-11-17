import { expect, it } from "vitest";
import { pageFold, type Point } from "./page-fold";

function area(points: Point[]) {
  return (
    Math.abs(
      points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return sum + point.x * next.y - next.x * point.y;
      }, 0),
    ) / 2
  );
}
it("partitions the sheet without gaps or overlapping pieces throughout the turn", () => {
  for (let step = 0; step <= 100; step++) {
    const fold = pageFold(400, 600, step / 100, 160);
    expect(area(fold.front) + area(fold.back)).toBeCloseTo(240000, 5);
    const [a, b, c, d, e, f] = fold.matrix;
    // The reflection fixes every point on the crease and preserves paper area.
    expect(a * d - b * c).toBeCloseTo(-1);
    expect(a * fold.mid.x + c * fold.mid.y + e).toBeCloseTo(fold.mid.x);
    expect(b * fold.mid.x + d * fold.mid.y + f).toBeCloseTo(fold.mid.y);
  }
});
it("starts with a complete front and ends with the sheet across the spine", () => {
  const start = pageFold(400, 600, 0, 120);
  const end = pageFold(400, 600, 1, 120);
  expect(area(start.front)).toBe(240000);
  expect(area(start.back)).toBe(0);
  expect(area(end.front)).toBeCloseTo(0);
  const [a, b, c, d, e, f] = end.matrix;
  expect(a * 400 + c * 600 + e).toBeCloseTo(-400);
  expect(b * 400 + d * 600 + f).toBeCloseTo(600);
});
