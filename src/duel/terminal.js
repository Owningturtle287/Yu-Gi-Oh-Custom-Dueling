import { logKindLabel } from './log.js';

// Presentation only: typing never delays a game action. A small backlog is
// animated; older queued entries catch up immediately to keep the feed useful.
export function createDuelTerminal({ getRoot, reduced = () => false, delay = 22, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let entries = [], progress = new Map(), host = null, timer = null, enabled = false, following = true;
  const stop = () => { clearTimer(timer); timer = null; };
  const bottom = () => { if (following && host) host.scrollTop = host.scrollHeight; };
  const track = () => { following = host.scrollHeight - host.clientHeight - host.scrollTop < 28; };
  function mount() {
    const next = getRoot();
    if (next === host) return;
    host?.removeEventListener('scroll', track);
    host = next;
    if (host) { host.addEventListener('scroll', track, { passive: true }); following = true; }
  }
  function paint() {
    if (!host) return;
    const document = host.ownerDocument, existing = new Map([...host.children].map(node => [node.dataset.entryId, node]));
    const writing = entries.find(entry => (progress.get(entry.id) || 0) < entry.message.length)?.id;
    for (const entry of entries) {
      const count = progress.get(entry.id) || 0;
      if (!count && entry.id !== writing && entry.message.length) continue;
      let row = existing.get(String(entry.id));
      if (!row) {
        row = document.createElement('article'); row.className = 'duel-terminal-entry'; row.dataset.entryId = entry.id; row.dataset.kind = entry.kind;
        const meta = document.createElement('span'); meta.className = 'duel-terminal-meta';
        meta.textContent = `T${entry.turn || 1} / ${entry.side === 0 ? 'YOU' : 'AI'} / ${logKindLabel(entry.kind)}`;
        const text = document.createElement('p'); row.append(meta, text); host.append(row);
      }
      existing.delete(String(entry.id));
      const text = entry.message.slice(0, count);
      if (row.lastChild.textContent !== text) row.lastChild.textContent = text;
      row.dataset.typing = String(count < entry.message.length);
    }
    for (const row of existing.values()) row.remove();
    bottom();
  }
  function complete(entry, announce = false) {
    progress.set(entry.id, entry.message.length);
    if (announce && host) {
      const live = host.parentElement.querySelector('[data-terminal-announcement]');
      if (live) live.textContent = entry.message;
    }
  }
  function tick() {
    timer = null;
    if (!enabled || !host) return;
    const pending = entries.filter(entry => (progress.get(entry.id) || 0) < entry.message.length);
    if (reduced()) pending.forEach(entry => complete(entry));
    else {
      pending.slice(0, -4).forEach(entry => complete(entry));
      const entry = pending.slice(-4)[0];
      if (entry) {
        const count = Math.min(entry.message.length, (progress.get(entry.id) || 0) + 1);
        progress.set(entry.id, count);
        if (count === entry.message.length) complete(entry, true);
      }
    }
    paint();
    if (entries.some(entry => (progress.get(entry.id) || 0) < entry.message.length)) timer = setTimer(tick, delay);
  }
  return {
    sync(log, { active = true } = {}) {
      stop(); mount(); entries = log.slice(-500); enabled = active;
      const ids = new Set(entries.map(entry => entry.id));
      progress = new Map([...progress].filter(([id]) => ids.has(id)));
      for (const entry of entries.slice(0, -4)) complete(entry);
      if (reduced()) entries.forEach(entry => complete(entry));
      paint();
      if (enabled) timer = setTimer(tick, delay);
    },
    latest() { following = true; bottom(); },
    finish() { entries.forEach(entry => complete(entry)); stop(); paint(); },
    pause() { enabled = false; stop(); },
    reset() { stop(); entries = []; progress.clear(); host?.replaceChildren(); },
    destroy() { enabled = false; stop(); host?.removeEventListener('scroll', track); host = null; }
  };
}
