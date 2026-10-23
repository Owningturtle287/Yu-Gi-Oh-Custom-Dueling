export function cardGridLayout(width, panelHeight = 500, compact = false) {
  const gap = compact ? 5 : 8;
  const columns = compact ? Math.max(2,Math.floor((width + gap) / 72)) : Math.max(width >= 270 ? 3 : 2, Math.floor((width + gap) / 120));
  const tileWidth = (width - gap * (columns - 1)) / columns;
  const naturalHeight = Math.round((tileWidth - 10) * 1.455 + 73);
  const tileHeight = compact ? Math.round((tileWidth - 4) * 614 / 421) + 18 : naturalHeight;
  return { columns, gap, tileWidth, tileHeight, stride: tileHeight + gap };
}
