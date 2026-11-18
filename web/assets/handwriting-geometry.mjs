// 획은 화면 확대와 픽셀 밀도에 독립적인 CSS px 좌표로 보관한다.
export function toLogicalPoint(event, rect, { width, height, dpr = 1 }) {
  return {
    x: (event.clientX - rect.left) * (width / dpr) / rect.width,
    y: (event.clientY - rect.top) * (height / dpr) / rect.height,
  };
}

export function acceptsPointer(pointerType, penSeen) {
  return pointerType !== "touch" || !penSeen;
}

export function pressureWidth(pressure, pointerType = "pen") {
  const value = Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) : 0.5;
  return pointerType === "pen" ? 1.5 + value * 4.5 : 3;
}

export function inkBounds(strokes, padding = 16) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      const radius = point.width / 2;
      left = Math.min(left, point.x - radius);
      top = Math.min(top, point.y - radius);
      right = Math.max(right, point.x + radius);
      bottom = Math.max(bottom, point.y + radius);
    }
  }
  if (!Number.isFinite(left)) return null;
  return { x: left - padding, y: top - padding, width: right - left + padding * 2, height: bottom - top + padding * 2 };
}

export function exportSize(bounds, maxEdge = 1024) {
  const scale = Math.min(1, maxEdge / Math.max(bounds.width, bounds.height));
  return { width: Math.max(1, Math.floor(bounds.width * scale)), height: Math.max(1, Math.floor(bounds.height * scale)) };
}
