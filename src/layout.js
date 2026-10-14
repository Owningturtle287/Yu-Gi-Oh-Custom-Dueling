export function cardGridLayout(width, panelHeight = 500, compact = false) {
  const gap = 8;
  const columns = Math.max(width >= 270 ? 3 : 2, Math.floor((width + gap) / 120));
  const tileWidth = (width - gap * (columns - 1)) / columns;
  const naturalHeight = Math.round((tileWidth - 10) * 1.455 + 73);
  const tileHeight = compact ? Math.min(naturalHeight, Math.max(132, panelHeight)) : naturalHeight;
  return { columns, gap, tileWidth, tileHeight, stride: tileHeight + gap };
}
