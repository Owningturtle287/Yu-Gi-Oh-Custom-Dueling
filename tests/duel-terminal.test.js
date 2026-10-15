import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createDuelTerminal } from '../src/duel/terminal.js';
import { patchArena } from '../src/duel/dom.js';

const entry = (id, message = `Event ${id}`) => ({ id, message, turn: 1, side: 0, kind: 'summon' });
function rig() {
  const window = new Window();
  window.document.body.innerHTML = '<section><div data-live-terminal></div><span data-terminal-announcement></span></section>';
  const host = window.document.querySelector('[data-live-terminal]');
  let reduced = false, serial = 0; const timers = new Map();
  const terminal = createDuelTerminal({ getRoot: () => host, reduced: () => reduced,
    setTimer: fn => { timers.set(++serial, fn); return serial; }, clearTimer: id => timers.delete(id) });
  return { window, host, terminal, timers, reduce: () => { reduced = true; },
    tick(count = 1) { for (let i = 0; i < count; i++) { const [id, fn] = timers.entries().next().value || []; timers.delete(id); fn?.(); } },
    close() { terminal.destroy(); window.close(); } };
}
test('live log types in order, survives phase refreshes without duplicate rows, and announces whole entries', () => {
  const r = rig(); try {
    const log = [entry(1, 'Summon.'), entry(2, 'An attack.')]; r.terminal.sync(log);
    assert.equal(r.host.querySelectorAll('article').length, 1);
    r.tick(3); assert.equal(r.host.querySelector('p').textContent, 'Sum');
    assert.equal(r.window.document.querySelector('[data-terminal-announcement]').textContent, '');
    const row = r.host.firstChild; r.terminal.sync(log); r.tick(4);
    assert.equal(r.host.firstChild, row); assert.equal(row.querySelector('p').textContent, 'Summon.');
    assert.equal(r.window.document.querySelector('[data-terminal-announcement]').textContent, 'Summon.');
    r.tick(10); assert.equal(r.host.querySelectorAll('article').length, 2);
    assert.equal(r.host.lastChild.querySelector('p').textContent, 'An attack.');
    assert.equal(r.timers.size, 0);
  } finally { r.close(); }
});
test('reading older events holds the scroll position until Latest is requested', () => {
  const r = rig(); try {
    Object.defineProperty(r.host, 'scrollHeight', { value: 1200, configurable: true });
    Object.defineProperty(r.host, 'clientHeight', { value: 200, configurable: true });
    r.terminal.sync([entry(1)]); r.host.scrollTop = 150; r.host.dispatchEvent(new r.window.Event('scroll'));
    r.tick(2); r.terminal.sync([entry(1), entry(2)]);
    assert.equal(r.host.scrollTop, 150); r.terminal.finish(); assert.equal(r.host.scrollTop, 150);
    r.terminal.latest(); assert.equal(r.host.scrollTop, 1200);
  } finally { r.close(); }
});
test('portrait/navigation pauses typing, reentry resumes, and reduced motion displays full text immediately', () => {
  const r = rig(); try {
    r.terminal.sync([entry(1, 'A long message')]); r.tick(2); const text = r.host.textContent;
    r.terminal.pause(); assert.equal(r.timers.size, 0); r.tick(20); assert.equal(r.host.textContent, text);
    r.terminal.sync([entry(1, 'A long message')], { active: false }); assert.equal(r.timers.size, 0);
    r.reduce(); r.terminal.sync([entry(1, 'A long message')]);
    assert.equal(r.host.querySelector('p').textContent, 'A long message'); r.tick(); assert.equal(r.timers.size, 0);
    r.terminal.reset(); assert.equal(r.host.childNodes.length, 0); assert.equal(r.timers.size, 0);
  } finally { r.close(); }
});
test('fast games catch up old queued events, retain at most 500, and render API text as text', () => {
  const r = rig(); try {
    const log = Array.from({ length: 510 }, (_, id) => entry(id, `<script>Event ${id}</script>`));
    r.terminal.sync(log); assert.equal(r.host.querySelector('p').textContent, '<script>Event 10</script>');
    assert.equal(r.host.querySelector('script'), null); r.terminal.finish();
    assert.equal(r.host.querySelectorAll('article').length, 500); assert.equal(r.host.lastChild.querySelector('p').textContent, '<script>Event 509</script>');
    r.terminal.sync([entry(510, 'A new game')]); assert.equal(r.host.querySelectorAll('article').length, 1);
  } finally { r.close(); }
});
test('detailed card explanations finish typing promptly and preserve the complete readable text',()=>{
  const r=rig();try{
    const message='Tribute to the Doomed: discard a card as the activation cost; select a monster as its target; destroy that monster when the effect resolves. '.repeat(3);
    r.terminal.sync([entry(1,message)]);r.tick(70);
    assert.equal(r.host.querySelector('p').textContent,message);
    assert.equal(r.window.document.querySelector('[data-terminal-announcement]').textContent,message);
    assert.equal(r.timers.size,0);
  }finally{r.close();}
});
test('keyed hands preserve unaffected art and focus after a draw or playing a middle card', () => {
  const window = new Window(); try {
    const root = window.document.body;
    const hand = ids => `<div data-motion-zone="0:hand">${ids.map(id => `<button data-render-key="${id}"><img src="https://example.com/${id}.jpg"></button>`).join('')}</div>`;
    patchArena(root, hand(['a', 'b', 'c'])); const third = root.querySelector('[data-render-key=c]'), art = third.firstChild; third.focus();
    patchArena(root, hand(['a', 'c', 'd']));
    assert.equal(root.querySelector('[data-render-key=c]'), third); assert.equal(third.firstChild, art);
    assert.equal(window.document.activeElement, third); assert.equal(root.querySelector('[data-render-key=b]'), null);
    assert.deepEqual([...root.firstChild.children].map(node => node.dataset.renderKey), ['a', 'c', 'd']);
  } finally { window.close(); }
});
test('a failed image stays a stable fallback during phases and is replaced when the face changes', () => {
  const window = new Window(); try {
    const root = window.document.body;
    patchArena(root, '<button><img src="missing.jpg"></button>');
    const fallback = window.document.createElement('span'); fallback.dataset.failedImage = 'missing.jpg'; fallback.textContent = 'Image unavailable'; root.querySelector('img').replaceWith(fallback);
    patchArena(root, '<button aria-label="New phase"><img src="missing.jpg"></button>');
    assert.equal(root.querySelector('span'), fallback);
    patchArena(root, '<button><img src="back.jpg"></button>');
    assert.equal(root.querySelector('span'), null); assert.equal(root.querySelector('img').getAttribute('src'), 'back.jpg');
  } finally { window.close(); }
});
