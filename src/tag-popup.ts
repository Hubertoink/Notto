export function tagPopupPosition(
  left: number,
  belowTop: number,
  aboveBottom: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const belowSpace = viewportHeight - belowTop - 8;
  const aboveSpace = aboveBottom - 8;
  const above = belowSpace < 160 && aboveSpace > belowSpace;
  const maxHeight = Math.min(200, above ? aboveSpace : belowSpace);
  if (maxHeight < 32) return null;
  return {
    left: Math.max(8, Math.min(left, viewportWidth - 228)),
    top: above ? aboveBottom - maxHeight : belowTop,
    maxHeight,
  };
}
