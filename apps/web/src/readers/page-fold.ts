export type Point = { x: number; y: number };

/** A crease is the perpendicular bisector between the paper corner and the pointer. */
export function pageFold(
  width: number,
  height: number,
  progress: number,
  lift: number,
) {
  const p = Math.max(0, Math.min(1, progress));
  const corner = { x: width, y: height };
  const drag = {
    x: width * (1 - 2 * p),
    y: height - Math.sin(Math.PI * p) * lift,
  };
  const dx = corner.x - drag.x;
  const dy = corner.y - drag.y;
  const length = Math.hypot(dx, dy);
  const normal =
    length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  const mid = { x: (corner.x + drag.x) / 2, y: (corner.y + drag.y) / 2 };
  const distance = (point: Point) =>
    (point.x - mid.x) * normal.x + (point.y - mid.y) * normal.y;
  const rectangle = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  function clip(side: number) {
    const result: Point[] = [];
    for (let i = 0; i < rectangle.length; i++) {
      const a = rectangle[i],
        b = rectangle[(i + 1) % rectangle.length];
      const da = distance(a) * side,
        db = distance(b) * side;
      if (da >= 0) result.push(a);
      if (da < 0 !== db < 0) {
        const t = da / (da - db);
        result.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      }
    }
    return result;
  }
  const offset = 2 * (normal.x * mid.x + normal.y * mid.y);
  return {
    front: clip(-1),
    back: clip(1),
    matrix: [
      1 - 2 * normal.x ** 2,
      -2 * normal.x * normal.y,
      -2 * normal.x * normal.y,
      1 - 2 * normal.y ** 2,
      offset * normal.x,
      offset * normal.y,
    ],
    mid,
    angle: (Math.atan2(normal.y, normal.x) * 180) / Math.PI,
  };
}
export function polygon(points: Point[]) {
  return points.length
    ? `polygon(${points.map((p) => `${p.x}px ${p.y}px`).join(",")})`
    : "polygon(0 0,0 0,0 0)";
}
