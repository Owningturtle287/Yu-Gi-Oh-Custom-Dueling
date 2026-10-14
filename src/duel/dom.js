// Patch the arena in place. In particular, an unchanged image never receives a
// new src or a new DOM node when phases, prompts, or legal actions change.
const key = node => node.nodeType === 1
  ? node.getAttribute('data-render-key') || node.getAttribute('data-motion-zone') || '' : '';
const sameFallback = (a, b) => a?.nodeType === 1 && b.nodeName === 'IMG' && a.getAttribute('data-failed-image') === b.getAttribute('src');
const compatible = (a, b) => sameFallback(a, b) || a?.nodeType === b.nodeType && a.nodeName === b.nodeName && key(a) === key(b);

function patch(current, next) {
  if (current === next) return;
  if (sameFallback(current, next)) return;
  if (current.nodeType !== 1) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  for (const attribute of [...current.attributes]) {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of next.attributes) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  // The terminal owns its text, scroll position, and typing cursor.
  if (current.hasAttribute('data-live-terminal')) return;
  children(current, next);
}

function children(current, next) {
  const previous = [...current.childNodes], used = new Set();
  const keyed = new Map(previous.filter(key).map(node => [key(node), node]));
  let cursor = current.firstChild;
  for (const desired of [...next.childNodes]) {
    const id = key(desired);
    let node = id ? keyed.get(id) : previous.find(candidate => !used.has(candidate) && !key(candidate) && compatible(candidate, desired));
    if (!compatible(node, desired)) node = desired;
    used.add(node);
    if (node !== cursor) current.insertBefore(node, cursor);
    patch(node, desired);
    cursor = node.nextSibling;
  }
  for (const node of previous) if (!used.has(node)) node.remove();
}

export function patchArena(root, html) {
  const focused = root.ownerDocument.activeElement;
  const restore = root.contains(focused);
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = html;
  children(root, template.content);
  // Moving a retained hand node can otherwise drop keyboard focus in browsers.
  if (restore && focused.isConnected && root.ownerDocument.activeElement !== focused) focused.focus({ preventScroll: true });
}
