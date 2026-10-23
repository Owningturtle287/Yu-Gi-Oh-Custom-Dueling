export function cardGridLayout(width) {
  const gap = 5;
  const columns = Math.max(2,Math.floor((width + gap) / 72));
  const tileWidth = (width - gap * (columns - 1)) / columns;
  const tileHeight = Math.round((tileWidth - 4) * 614 / 421) + 18;
  return { columns, gap, tileWidth, tileHeight, stride: tileHeight + gap };
}
