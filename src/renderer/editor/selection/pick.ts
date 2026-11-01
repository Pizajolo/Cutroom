export interface Point { x: number; y: number }
export interface Bounds extends Point { w: number; h: number }
export interface Hit {
  itemId: string;
  cutId?: string;
  name: string;
  bbox: Bounds;
}
export interface PickLayer {
  itemId: string;
  name: string;
  zIndex: number;
  order: number;
  bbox: Bounds;
  hitTest?: (point: Point) => Promise<Omit<Hit, 'itemId'> | null>;
}

export function normalizePoint(point: Point, canvas: { left: number; top: number; width: number; height: number }): Point | null {
  if (canvas.width <= 0 || canvas.height <= 0) return null;
  const result = { x: (point.x - canvas.left) / canvas.width, y: (point.y - canvas.top) / canvas.height };
  return result.x >= 0 && result.x <= 1 && result.y >= 0 && result.y <= 1 ? result : null;
}

export async function pick(layers: readonly PickLayer[], point: Point): Promise<Hit | null> {
  const sorted = [...layers].sort((a, b) => b.zIndex - a.zIndex || b.order - a.order);
  for (const layer of sorted) {
    const { bbox } = layer;
    if (point.x < bbox.x || point.y < bbox.y || point.x > bbox.x + bbox.w || point.y > bbox.y + bbox.h) continue;
    if (layer.hitTest) {
      const hit = await layer.hitTest(point);
      if (hit) return { ...hit, itemId: layer.itemId };
    } else return { itemId: layer.itemId, name: layer.name, bbox };
  }
  return null;
}
