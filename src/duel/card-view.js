const smallPattern = /^https:\/\/images\.ygoprodeck\.com\/images\/cards_small\/\d+\.jpg$/;
const fullPattern = /^https:\/\/images\.ygoprodeck\.com\/images\/cards\/\d+\.jpg$/;

export function cardArtURLs(card) {
  const supplied = card?.card_images?.[0];
  const small = smallPattern.test(supplied?.image_url_small || '') ? supplied.image_url_small : '';
  const full = fullPattern.test(supplied?.image_url || '') ? supplied.image_url : '';
  return { preview: small || full, full };
}

export function cardTypeLabel(card) {
  if (/Monster/.test(card.type)) {
    return [card.race, ...card.type.replace(/\bMonster\b/g, '').trim().split(/\s+/)].filter(Boolean).join(' / ');
  }
  return [card.type.replace(/\s+Card$/, ''), card.race].filter(Boolean).join(' / ');
}

// The field's already displayed thumbnail stays visible while full art loads
// and decodes. A slow connection or failed upgrade never clears that preview.
export function sharpenCardArt(container, card, { source, createImage = () => container.ownerDocument.createElement('img') } = {}) {
  const { preview, full } = cardArtURLs(card);
  let cancelled = false;
  const current = container.querySelector('img');
  if (current && source?.complete && source.naturalWidth && source.getAttribute('src') === preview) {
    const cached = source.cloneNode(true);
    cached.className = ''; cached.alt = ''; cached.decoding = 'sync'; cached.loading = 'eager';
    current.replaceWith(cached);
  } else if (current) current.decoding = 'sync';
  if (!full || full === preview) return () => {};
  const upgrade = createImage();
  upgrade.alt = ''; upgrade.className = 'duel-inspect-full'; upgrade.decoding = 'async';
  upgrade.onload = async () => {
    try { await upgrade.decode?.(); } catch { return; }
    if (!cancelled && container.isConnected) container.append(upgrade);
  };
  upgrade.onerror = () => {}; // Keep the immediately visible preview.
  upgrade.src = full;
  return () => { cancelled = true; upgrade.onload = null; upgrade.onerror = null; };
}
