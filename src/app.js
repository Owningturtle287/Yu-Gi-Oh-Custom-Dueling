import { VERSION, MECHANICS, SECTIONS, LIMITS, createDeck, validName, totals, addCard, removeCard, deckWarnings, readDecks, saveDeck, exportJSON, importJSON, exportYDK, importYDK, isExtra, validateDeck, STORAGE_KEY, filterCards } from './core.js';
import { loadCards, browserCardCache } from './cards.js';
import { icon } from './icons.js';

const $ = (selector, root = document) => root.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const main = $('#main'), modal = $('#modal');
const state = { route: 'home', cards: [], cardIndex: new Map(), cardStatus: 'loading', source: '', cardError: '', cacheWarning: false, filters: { query: '', category: 'All', attribute: '', race: '', mechanic: '', sort: 'az' }, filtered: [], decks: [], draft: createDeck(), section: 'main', dirty: false, storageError: '', showStats: true };
let cache;
try {
  state.decks = readDecks(localStorage);
  if (state.decks.length) state.draft = structuredClone(state.decks[0]);
  state.showStats = localStorage.getItem('duel-atlas.show-stats') !== 'false';
} catch (error) { state.storageError = error.message; }
try { cache = browserCardCache(); } catch { /* API browsing can work without IndexedDB. */ }
let toastTimer, gridObserver, gridFrame, previousFocus, deckIntent = false, detailCard, cardRequest;
const sectionName = section => ({ main: 'Main', extra: 'Extra', side: 'Side' })[section];
const cardLabel = card => card.humanReadableCardType || card.type;
const imageURL = (card, small = false) => {
  const value = card.card_images?.[0]?.[small ? 'image_url_small' : 'image_url'];
  return /^https:\/\/images\.ygoprodeck\.com\/images\/cards(?:_small)?\/\d+\.jpg$/.test(value || '') ? value : '';
};
const imageTag = (card, small = false, className = '') => {
  const url = imageURL(card, small);
  return url ? `<img class="${className}" src="${escape(url)}" alt="${escape(card.name)} card" loading="lazy" decoding="async">` : `<span class="image-fallback ${className}" aria-label="Card image unavailable">${icon('deck')}</span>`;
};
function toast(message, error = false) {
  const element = $('#toast');
  clearTimeout(toastTimer);
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  toastTimer = setTimeout(() => element.hidden = true, error ? 6500 : 3500);
}
function showDialog(content, className = '') {
  if (!modal.open) previousFocus = document.activeElement;
  modal.innerHTML = `<div class="dialog-body ${className}">${content}</div>`;
  if (!modal.open) modal.showModal();
}
function dialogHeader(title) { return `<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close" aria-label="Close dialog">${icon('close')}</button></div>`; }
function closeDialog() { modal.close(); detailCard = null; previousFocus?.isConnected && previousFocus.focus(); }
modal.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
modal.addEventListener('click', event => { if (event.target === modal) { const r = modal.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(); } });
document.addEventListener('error', event => {
  if (event.target.tagName === 'IMG' && event.target.src.includes('images.ygoprodeck.com')) {
    const placeholder = document.createElement('span');
    placeholder.className = 'image-fallback ' + event.target.className;
    placeholder.setAttribute('aria-label', 'Card image unavailable');
    placeholder.innerHTML = icon('deck');
    event.target.replaceWith(placeholder);
  }
}, true);
function navigate(route, focus = true) {
  const routes = ['home', 'archive', 'decks', 'multiplayer', 'solo'];
  state.route = routes.includes(route) ? route : 'home';
  if (location.hash !== '#' + state.route) history.replaceState(null, '', '#' + state.route);
  if (modal.open) closeDialog();
  gridObserver?.disconnect();
  document.querySelectorAll('.bottom-nav button').forEach(button => {
    if (button.dataset.route === state.route) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (state.route === 'home') renderHome();
  if (state.route === 'archive') renderArchive();
  if (state.route === 'decks') renderDeck();
  if (state.route === 'multiplayer' || state.route === 'solo') renderPlaceholder();
  if (focus) main.focus({ preventScroll: true });
}
function renderHome() {
  const archiveStatus = state.cardStatus === 'ready' ? `${state.cards.length.toLocaleString()} cards ${state.source === 'api' ? 'in your archive' : 'available from cache'}` : state.cardStatus === 'loading' ? 'Preparing your card archive…' : 'Archive unavailable · open to retry';
  main.innerHTML = `<section class="screen home" aria-label="Home">
    <div class="home-hero"><div class="hero-copy"><div class="eyebrow">THE DUELIST’S WORKSHOP</div><h1>Your next deck<br><span>starts here.</span></h1><p>Explore the cards. Shape your strategy.<br>Keep your collection close.</p></div><div class="hero-art" aria-hidden="true"><img src="./assets/emblem.svg" alt=""></div></div>
    <div class="section-label"><span>CHOOSE YOUR PATH</span><span>EARLY ACCESS</span></div>
    <div class="home-grid">
      <button class="launch-card archive-launch" data-route="archive">${icon('archive')}<span class="arrow" aria-hidden="true">↗</span><strong>Card Archive</strong><small>Discover every possibility</small></button>
      <button class="launch-card" data-route="decks">${icon('deck')}<span class="arrow" aria-hidden="true">↗</span><strong>Deck Builder</strong><small>Your strategy, your rules</small></button>
      <button class="launch-card coming" data-route="solo">${icon('solo')}<span class="soon-label">COMING SOON</span><strong>Solo Duel</strong><small>Practice on your terms</small></button>
      <button class="launch-card coming" data-route="multiplayer">${icon('people')}<span class="soon-label">COMING SOON</span><strong>Multiplayer</strong><small>A connection. A rivalry.</small></button>
    </div>
    <div class="home-status"><span class="status-dot"></span><span>${escape(archiveStatus)}<br>${state.decks.length} saved deck${state.decks.length === 1 ? '' : 's'} · stored on this device</span><a href="#solo" data-route="solo">Release scope ↗</a></div>
  </section>`;
}
function renderArchive() {
  main.innerHTML = `<section class="screen archive-screen" aria-label="Card Archive">
    <div class="page-heading"><div><div class="eyebrow">EXPLORE & DISCOVER</div><h1>Card Archive</h1></div><span class="pill">YGOPRODeck</span></div>
    <div class="search-row"><div class="search-wrap">${icon('search')}<label class="sr-only" for="card-search">Search card name, archetype, or effect text</label><input id="card-search" type="search" placeholder="Name, archetype, or card text" value="${escape(state.filters.query)}" autocomplete="off"><button class="search-clear" data-action="clear-search" aria-label="Clear search">×</button></div><button class="filter-toggle" data-action="filters" data-active="${Boolean(state.filters.attribute || state.filters.race || state.filters.mechanic || state.filters.sort !== 'az')}" aria-haspopup="dialog">${icon('filter')}<span>Filters</span></button></div>
    <div class="category-tabs" aria-label="Card category">${[['All', 'All'], ['Monster', 'Monster'], ['Spell', 'Spell'], ['Trap', 'Trap'], ['Extra', 'Extra Deck']].map(([key, label]) => `<button data-category="${key}" aria-pressed="${state.filters.category === key}">${label}</button>`).join('')}</div>
    <div class="result-meta" id="result-meta" role="status"></div>
    <div class="archive-panel" id="archive-panel" aria-label="Scrollable card results" tabindex="0"></div>
  </section>`;
  $('#card-search').addEventListener('input', event => { state.filters.query = event.target.value; updateArchive(); });
  updateArchive();
}
function updateArchive() {
  const panel = $('#archive-panel');
  if (!panel) return;
  gridObserver?.disconnect();
  if (state.cardStatus !== 'ready') {
    $('#result-meta').innerHTML = state.cardStatus === 'loading' ? 'Loading the complete archive · one request' : 'Connection needed for your first download';
    panel.innerHTML = state.cardStatus === 'loading' ? `<div class="empty-state"><div class="loading-mark">${icon('deck')}</div><h3>Opening the archive</h3><p>Fetching the full card database. Search and filters will work on your device.</p></div>` : `<div class="empty-state">${icon('wifi')}<h3>Let’s reconnect</h3><p>${escape(state.cardError)}</p><button class="primary" data-action="retry">Retry card archive</button></div>`;
    return;
  }
  state.filtered = filterCardsForUI();
  const activeFilters = [state.filters.attribute, state.filters.race, state.filters.mechanic].filter(Boolean).join(' · ');
  const source = state.source === 'offline' ? 'Offline cache' : state.source === 'cache' ? 'Saved archive' : 'Live archive';
  $('#result-meta').innerHTML = `<span><strong>${state.filtered.length.toLocaleString()}</strong> cards${activeFilters ? ` · ${escape(activeFilters)}` : ''}</span><button data-action="retry" aria-label="Refresh archive from the card API">${source} ↻</button>`;
  if (!state.filtered.length) { panel.innerHTML = `<div class="empty-state">${icon('search')}<h3>No cards found</h3><p>Try another name or clear your filters.</p><button data-action="reset-filters">Clear search & filters</button></div>`; return; }
  panel.scrollTop = 0;
  panel.innerHTML = '<div class="virtual-grid" id="virtual-grid"></div>';
  panel.onscroll = () => { cancelAnimationFrame(gridFrame); gridFrame = requestAnimationFrame(renderGrid); };
  if (typeof ResizeObserver !== 'undefined') { gridObserver = new ResizeObserver(renderGrid); gridObserver.observe(panel); }
  renderGrid();
}
// All results remain in one continuous scroll range; no next-page controls.
function filterCardsForUI() { return filterCards(state.cards, state.filters); }
function renderGrid() {
  const panel = $('#archive-panel'), grid = $('#virtual-grid');
  if (!panel || !grid) return;
  const width = panel.clientWidth || 350;
  const columns = Math.max(2, Math.floor((width + 10) / 118));
  const gap = 10, tileWidth = (width - gap * (columns - 1)) / columns;
  const tileHeight = Math.round((tileWidth - 14) * 1.455 + 66), stride = tileHeight + gap;
  const startRow = Math.max(0, Math.floor(panel.scrollTop / stride) - 1);
  const endRow = Math.min(Math.ceil(state.filtered.length / columns), Math.ceil((panel.scrollTop + (panel.clientHeight || 500)) / stride) + 1);
  grid.style.height = `${Math.ceil(state.filtered.length / columns) * stride - gap}px`;
  const existing = new Map([...grid.children].map(element => [element.dataset.card, element]));
  const needed = new Set();
  state.filtered.slice(startRow * columns, endRow * columns).forEach((card, offset) => {
    const index = startRow * columns + offset;
    const subtitle = state.showStats && card.atk !== undefined ? `ATK ${card.atk < 0 ? '?' : card.atk} · ${card.linkval !== undefined ? 'LINK ' + card.linkval : 'DEF ' + (card.def < 0 ? '?' : card.def ?? '—')}` : cardLabel(card);
    const key = String(card.id); needed.add(key);
    let tile = existing.get(key);
    if (!tile) {
      const template = document.createElement('template');
      template.innerHTML = `<button class="card-tile" data-card="${card.id}" aria-label="Inspect ${escape(card.name)}">${imageTag(card, true, 'card-image')}<strong>${escape(card.name)}</strong><small>${escape(subtitle)}</small></button>`;
      tile = template.content.firstElementChild;
      grid.append(tile);
    }
    tile.style.cssText = `width:${tileWidth}px;height:${tileHeight}px;left:${(index % columns) * (tileWidth + gap)}px;top:${Math.floor(index / columns) * stride}px`;
  });
  for (const [key, tile] of existing) if (!needed.has(key) && tile !== document.activeElement) tile.remove();
}
async function requestArchive(force = false) {
  if (cardRequest) return cardRequest;
  state.cardStatus = 'loading';
  if (state.route === 'archive') updateArchive();
  if (state.route === 'home') renderHome();
  cardRequest = (async () => {
    try {
      const result = await loadCards({ cache, force });
      state.cards = result.cards; state.cardIndex = new Map(result.cards.map(c => [c.id, c]));
      state.source = result.source; state.cacheWarning = result.cacheWarning; state.cardStatus = 'ready';
      if (result.source === 'offline') toast('Using your saved archive. The API is unavailable.');
      if (result.cacheWarning) toast('Cards loaded. This browser could not save the archive for offline use.', true);
    } catch (error) { state.cardStatus = 'error'; state.cardError = error.message; }
    finally {
      cardRequest = null;
      if (state.route === 'archive') updateArchive();
      if (state.route === 'home') renderHome();
    }
  })();
  return cardRequest;
}
function showFilters() {
  const options = (values, selected, title) => `<option value="">${title}</option>${values.map(v => `<option ${selected === v ? 'selected' : ''} value="${escape(v)}">${escape(v)}</option>`).join('')}`;
  const races = [...new Set(state.cards.map(c => c.race).filter(Boolean))].sort();
  showDialog(`${dialogHeader('Archive filters')}<form id="filters-form"><div class="field-grid">
    <label>Attribute<select name="attribute">${options(['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'], state.filters.attribute, 'All attributes')}</select></label>
    <label>Card type / race<select name="race">${options(races, state.filters.race, 'All types')}</select></label>
    <label>Summoning mechanic<select name="mechanic">${options(MECHANICS, state.filters.mechanic, 'All mechanics')}</select></label>
    <label>Sort by<select name="sort">${[['az', 'Name A–Z'], ['za', 'Name Z–A'], ['atk', 'Highest ATK'], ['level', 'Highest level / rank / Link']].map(([v, label]) => `<option value="${v}" ${state.filters.sort === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
  </div><div class="dialog-actions" style="margin-top:16px"><button type="button" data-action="reset-filters">Reset all</button><button class="primary" type="submit">Show cards</button></div></form>`);
  $('#filters-form').addEventListener('submit', event => {
    event.preventDefault(); Object.assign(state.filters, Object.fromEntries(new FormData(event.target))); closeDialog(); renderArchive();
  });
}
function inspectCard(card) {
  detailCard = card;
  const stats = [];
  if (card.atk !== undefined) stats.push(['ATK', card.atk < 0 ? '?' : card.atk]);
  if (card.def !== undefined) stats.push(['DEF', card.def < 0 ? '?' : card.def]);
  if (card.linkval !== undefined) stats.push(['LINK', card.linkval]);
  if (card.level !== undefined) stats.push([/xyz/i.test(card.type) ? 'RANK' : 'LEVEL', card.level]);
  if (card.scale !== undefined) stats.push(['SCALE', card.scale]);
  const defaultSection = deckIntent && state.section === 'side' ? 'side' : isExtra(card) ? 'extra' : 'main';
  const supported = !/Token|Skill Card/.test(card.type);
  showDialog(`${dialogHeader(escape(card.name))}<div class="detail-top">${imageTag(card)}<div class="detail-meta"><p class="type">${escape(cardLabel(card))}</p><div class="attribute">${escape([card.attribute, card.race, card.archetype].filter(Boolean).join(' · '))}</div><div class="card-stats">${stats.map(([label, value]) => `<span>${label}<b>${escape(value)}</b></span>`).join('')}</div>${card.linkmarkers?.length ? `<div class="attribute">Arrows: ${escape(card.linkmarkers.join(', '))}</div>` : ''}</div></div>
    <div class="effect-label">CARD TEXT</div><div class="effect-text" tabindex="0" aria-label="Scrollable card effect text">${escape(card.desc || 'No effect text available.')}</div>
    <p id="detail-error" class="inline-error" role="alert"></p>
    <div class="detail-deck">Adding to: <strong>${escape(state.draft.name)}</strong>${state.dirty ? ' · unsaved changes' : ''}</div>
    <div class="detail-add"><label class="sr-only" for="add-section">Deck section</label><select id="add-section">${SECTIONS.map(s => `<option value="${s}" ${s === defaultSection ? 'selected' : ''} ${s === 'main' && isExtra(card) || s === 'extra' && !isExtra(card) ? 'disabled' : ''}>${sectionName(s)} Deck</option>`).join('')}</select><button class="primary" data-action="add-card" ${!supported ? 'disabled' : ''}>${supported ? 'Add to Deck' : 'Not supported'}</button></div>`, 'detail-body');
}
function renderDeck() {
  const deck = state.draft, counts = totals(deck), warnings = deckWarnings(deck);
  const blocked = warnings.find(w => w.includes('disabled'));
  main.innerHTML = `<section class="screen deck-screen" aria-label="Deck Builder"><div class="page-heading"><div style="min-width:0"><div class="eyebrow">THE DECK WORKSHOP</div><div class="deck-title-row"><h1>${escape(deck.name)}</h1><button class="icon-button" data-action="rename" aria-label="Rename deck">${icon('edit')}</button></div><div class="deck-state">${state.dirty ? 'Unsaved changes' : state.decks.some(d => d.id === deck.id) ? 'Saved on this device' : 'New deck · not yet saved'}</div></div><div class="deck-top-actions"><button data-action="new-deck">New</button><button data-action="open-decks">Open${state.decks.length ? ' · ' + state.decks.length : ''}</button></div></div>
    <div class="deck-summary" aria-label="Deck card totals">${SECTIONS.map(s => `<div><strong>${counts[s]}</strong><span> / ${LIMITS[s]}</span><small>${sectionName(s)} Deck</small></div>`).join('')}</div>
    <div class="deck-tabs" aria-label="Deck sections">${SECTIONS.map(s => `<button data-section="${s}" aria-pressed="${state.section === s}">${sectionName(s)} <span class="muted">${counts[s]}</span></button>`).join('')}</div>
    <div class="deck-list" aria-label="Scrollable ${sectionName(state.section)} Deck cards" tabindex="0">${deck.sections[state.section].length ? deck.sections[state.section].map(entry => `<div class="deck-row"><button class="deck-inspect" data-card="${entry.card.id}">${imageTag(entry.card, true)}<span><strong>${escape(entry.card.name)}</strong><small>${escape(cardLabel(entry.card))}</small></span></button><div class="quantity-controls"><button data-remove="${entry.card.id}" aria-label="Remove one ${escape(entry.card.name)}">−</button><span aria-label="${entry.quantity} copies">${entry.quantity}</span><button data-increment="${entry.card.id}" aria-label="Add one ${escape(entry.card.name)}">+</button></div></div>`).join('') : `<div class="empty-state">${icon('deck')}<h3>Your ${sectionName(state.section)} Deck awaits</h3><p>${state.section === 'extra' ? 'Fusion, Synchro, Xyz, and Link monsters go here.' : state.section === 'side' ? 'Keep options for a different strategy here.' : 'Find a card in the archive, then tap Add to Deck.'}</p></div>`}</div>
    <div class="deck-toolbar"><button data-action="rules">${icon('rules')}Rules / Format</button><button data-action="backups">${icon('backup')}Import / Export</button></div>
    <div class="deck-footer-actions"><button data-action="find-cards">${icon('plus')} Find cards</button><button class="primary" data-action="save-deck">Save deck</button></div>
    <p class="deck-notice ${blocked ? 'restricted' : ''}">${state.storageError ? 'Storage unavailable · export a backup to keep this deck.' : blocked ? escape(blocked) : counts.main < 40 ? 'Main Deck: aim for 40–60 cards. Save at any size while building.' : '3-copy limit across sections · no banlist or duel rules enforced.'}</p>
  </section>`;
}
function confirmReplace(callback) {
  if (!state.dirty) { callback(); return; }
  showDialog(`${dialogHeader('Keep your changes?')}<p>Your current deck has unsaved changes. Save it before opening another deck.</p><div class="dialog-actions"><button data-action="close">Keep editing</button><button id="discard-draft" class="danger">Discard changes</button><button id="save-before-open" class="primary">Save & continue</button></div>`);
  $('#discard-draft').onclick = () => { closeDialog(); callback(); };
  $('#save-before-open').onclick = () => { if (persistDeck()) { closeDialog(); callback(); } };
}
function showNameDialog(rename = false) {
  const show = () => {
    showDialog(`${dialogHeader(rename ? 'Rename your deck' : 'A new strategy')}<form id="deck-name-form"><label for="deck-name">Deck name<input id="deck-name" name="name" placeholder="e.g. Blue-Eyes workshop" value="${rename ? escape(state.draft.name) : ''}" maxlength="60" required autocomplete="off"></label><p class="inline-error" id="name-error" role="alert"></p><div class="dialog-actions" style="margin-top:16px"><button type="button" data-action="close">Cancel</button><button class="primary" type="submit">${rename ? 'Rename' : 'Create deck'}</button></div></form>`);
    $('#deck-name').focus();
    $('#deck-name-form').onsubmit = event => {
      event.preventDefault();
      try {
        const name = validName($('#deck-name').value);
        state.draft = rename ? { ...state.draft, name } : createDeck(name);
        state.dirty = true; state.section = 'main'; closeDialog(); navigate('decks', false);
        toast(rename ? 'Deck renamed. Tap Save deck to keep the change.' : 'Deck created. Find cards to start building.');
      } catch (error) { $('#name-error').textContent = error.message; }
    };
  };
  if (rename) show(); else confirmReplace(show);
}
function persistDeck() {
  try {
    if (state.storageError) throw new Error('Deck storage is unavailable. Export a JSON backup from Import / Export.');
    state.decks = saveDeck(localStorage, state.decks, state.draft);
    state.draft = structuredClone(state.decks.find(d => d.id === state.draft.id)); state.dirty = false;
    if (state.route === 'decks') renderDeck();
    toast('Deck saved on this device.'); return true;
  } catch (error) { toast(error.message || 'Could not save. Export a JSON backup.', true); return false; }
}
function showSavedDecks() {
  showDialog(`${dialogHeader('Your saved decks')}<p>Stored in this browser on this device.</p><div class="saved-list">${state.decks.length ? state.decks.map(d => `<div class="saved-row"><button data-open-deck="${escape(d.id)}"><strong>${escape(d.name)}</strong><small>${SECTIONS.map(s => sectionName(s) + ' ' + totals(d)[s]).join(' · ')}</small></button><button class="icon-button" data-delete-deck="${escape(d.id)}" aria-label="Delete ${escape(d.name)}">${icon('trash')}</button></div>`).join('') : '<div class="empty-state"><p>No saved decks yet. Build a deck and tap Save deck.</p></div>'}</div><button class="primary" data-action="new-deck">Create a new deck</button>`);
}
function openDeck(id) {
  const deck = state.decks.find(d => d.id === id);
  if (!deck) return;
  confirmReplace(() => { state.draft = structuredClone(deck); state.dirty = false; state.section = 'main'; closeDialog(); navigate('decks'); toast('Opened ' + deck.name); });
}
function deleteDeck(id) {
  const deck = state.decks.find(d => d.id === id);
  if (!deck) return;
  showDialog(`${dialogHeader('Delete saved deck?')}<p>Delete “${escape(deck.name)}” from this device? Export a backup first if you want to keep it.</p><div class="dialog-actions"><button data-action="open-decks">Keep deck</button><button class="danger" id="confirm-delete">Delete deck</button></div>`);
  $('#confirm-delete').onclick = () => {
    try {
      const next = state.decks.filter(d => d.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, decks: next })); state.decks = next;
      if (state.draft.id === id) state.dirty = true;
      if (state.route === 'decks') renderDeck();
      showSavedDecks(); toast('Saved deck deleted.');
    } catch { toast('Could not delete from browser storage.', true); }
  };
}
function showRules() {
  showDialog(`${dialogHeader('Rules / Format')}<p>Choose which summoning mechanics this deck allows.</p><div class="button-row"><button data-preset="all">All mechanics</button><button data-preset="pre">Pre-Synchro</button></div><div class="mechanic-list">${MECHANICS.map(m => `<label><input type="checkbox" name="${m}" ${state.draft.mechanics[m] ? 'checked' : ''}><span>${m}</span></label>`).join('')}</div><p class="help-note">These are mechanic restrictions, not historical release-date formats. Pre-Synchro enables Fusion only. No banlist or duel rules are enforced.</p><p class="muted">Existing cards stay in your deck; disabled mechanics are flagged for review.</p><div class="dialog-actions"><button data-action="close">Cancel</button><button class="primary" id="apply-rules">Apply to deck</button></div>`);
  $('#apply-rules').onclick = () => {
    state.draft.mechanics = Object.fromEntries(MECHANICS.map(m => [m, $(`input[name="${m}"]`, modal).checked]));
    state.dirty = true; closeDialog(); if (state.route === 'decks') renderDeck(); toast('Mechanic restrictions updated. Tap Save deck to keep them.');
  };
}
function download(content, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Backup prepared: ' + filename);
}
function showBackups() {
  showDialog(`${dialogHeader('Deck backups')}<p>Export your current deck, including unsaved edits. Import opens a new deck copy; tap Save deck to keep it.</p><div class="button-row"><button data-action="export-json">Export JSON</button><button data-action="export-ydk">Export YDK</button></div><p class="help-note">JSON includes card details and mechanic settings. YDK stores card IDs and sections; importing it needs a loaded archive and uses All mechanics.</p><button class="primary" data-action="import">Import JSON or YDK</button><p>Keep a backup before clearing browser data or moving to another device. Private browsing may not retain decks.</p>`, 'backup-body');
}
async function handleImport(file) {
  if (!file) return;
  try {
    if (file.size > 2000000) throw new Error('Choose a deck backup smaller than 2 MB.');
    const text = await file.text();
    let imported;
    if (/\.ydk$/i.test(file.name)) {
      if (state.cardStatus !== 'ready') throw new Error('Load the card archive before importing a YDK file.');
      imported = importYDK(text, state.cards, file.name.replace(/\.ydk$/i, '').slice(0, 60) || 'Imported deck');
    } else {
      const parsed = JSON.parse(text);
      if (parsed.version === 1 && Array.isArray(parsed.decks)) {
        if (parsed.decks.length > 500) throw new Error('This backup contains too many decks.');
        const copies = parsed.decks.map(value => ({ ...validateDeck(value), id: crypto.randomUUID() }));
        if (!copies.length) throw new Error('This backup contains no saved decks.');
        if (state.storageError) throw new Error('Browser storage is unavailable. Import a single-deck backup to edit it for this session.');
        confirmReplace(() => {
          try {
            const next = [...copies, ...state.decks];
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, decks: next }));
            state.decks = next; state.draft = structuredClone(copies[0]); state.dirty = false; state.section = 'main';
            closeDialog(); navigate('decks'); toast(`Restored ${copies.length} deck${copies.length === 1 ? '' : 's'} as new copies.`);
          } catch { toast('Could not restore decks to browser storage. Existing decks were kept.', true); }
        });
        return;
      }
      imported = importJSON(text);
    }
    imported.id = crypto.randomUUID();
    confirmReplace(() => { state.draft = imported; state.dirty = true; state.section = 'main'; closeDialog(); navigate('decks'); toast('Deck imported. Tap Save deck to keep this copy.'); });
  } catch (error) { toast(error.message || 'This backup could not be imported.', true); }
  finally { $('#import-file').value = ''; }
}
function renderPlaceholder() {
  const multi = state.route === 'multiplayer';
  main.innerHTML = `<section class="screen placeholder-screen" aria-label="${multi ? 'Multiplayer' : 'Solo Duel'} coming soon"><div class="placeholder-art">${icon(multi ? 'people' : 'solo')}</div><span class="pill gold">COMING IN A LATER PHASE</span><h1>${multi ? 'A duel. A direct connection.' : 'Your practice arena.'}</h1><p>${multi ? 'Direct peer-to-peer duels are planned, without requiring a dedicated game server. For now, build a deck and get ready to meet your rival.' : 'Solo dueling, AI opponents, rules enforcement, and duel animations are planned for a later phase. This release is your card archive and deck workshop.'}</p>
    ${multi ? `<div class="preview-panel"><div class="button-row"><button disabled>Create room</button><button disabled>Join room</button></div><label for="room-code">Room code · preview only<input id="room-code" placeholder="— — — — — —" maxlength="6" disabled aria-label="Room code preview, coming soon"></label><small>Rooms and connections are not active in v${VERSION}.</small></div>` : '<div class="feature-tags"><span>AI opponents</span><span>Duel rules</span><span>Card effects</span><span>Duel animations</span></div>'}
    <button class="primary" data-route="decks">Build a deck in the meantime</button><small class="muted">Functionality testing release · v${VERSION}</small></section>`;
}
let installPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Duel Atlas added to your home screen.'); });
function showMenu() {
  showDialog(`${dialogHeader('Your companion')}<p>Duel Atlas · v${VERSION}<br>A Yu-Gi-Oh! archive and deck workshop.</p><button class="menu-item" data-action="install">${icon('backup')}<span>Install on your phone<small>Add Duel Atlas to your home screen</small></span></button><button class="menu-item" data-action="settings">${icon('filter')}<span>App settings<small>Card display and archive refresh</small></span></button><button class="menu-item" data-action="about">${icon('info')}<span>About this release<small>Scope, card data, and credits</small></span></button><button class="menu-item" data-route="solo">${icon('solo')}<span>Solo Duel<small>Coming in a later phase</small></span></button>`, 'menu-body');
}
function showInstall() {
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  showDialog(`${dialogHeader('Take your workshop with you')}<p>${installed ? 'Duel Atlas is already running as an installed app.' : 'Open the hosted app in your phone’s browser to add it to your home screen.'}</p><div class="help-note install-instructions"><div><strong>iPhone / iPad · Safari</strong><br>Tap Share, then Add to Home Screen.</div><div><strong>Android · Chrome</strong><br>Open the browser menu, then Install app or Add to Home screen.</div></div><p>Once you’ve opened the archive online, cached card data and saved decks work offline. Card images become available offline as you view them.</p><div class="dialog-actions">${installPrompt ? '<button class="primary" id="install-now">Install Duel Atlas</button>' : ''}<button data-action="close">Got it</button></div>`, 'install-body');
  if ($('#install-now')) $('#install-now').onclick = async () => { await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; showInstall(); };
}
function showSettings() {
  showDialog(`${dialogHeader('App settings')}<label class="settings-label"><span>Show ATK / DEF in archive</span><input id="show-stats" type="checkbox" ${state.showStats ? 'checked' : ''}></label><p>Archive data refreshes after 24 hours. Search and filters run locally.</p><button data-action="refresh-settings">Refresh card archive</button><p>Saved decks: ${state.decks.length} · this browser / device only</p><button class="secondary" data-action="backup-all">Back up all saved decks</button>${state.storageError ? '<p class="inline-error">Browser storage could not be read. Back up the saved data before fixing or clearing it in browser settings.</p>' : ''}<button data-action="close">Done</button>`, 'settings-body');
  $('#show-stats').onchange = event => {
    state.showStats = event.target.checked;
    try { localStorage.setItem('duel-atlas.show-stats', String(state.showStats)); } catch { toast('Setting applied for this session. Browser storage is unavailable.', true); }
  };
}
function showAbout() {
  showDialog(`${dialogHeader('Built for the deck workshop')}<span class="pill gold">v${VERSION} · FUNCTIONALITY TEST</span><p>Browse the full available card archive, build decks, choose mechanic restrictions, and keep local backups.</p><p>Dueling, card effects, AI, rules enforcement, animations, and multiplayer connections are planned for a later phase.</p><p>Card data and official card images are supplied by <a href="https://ygoprodeck.com/api-guide/" target="_blank" rel="noopener noreferrer">YGOPRODeck</a>. Card names, text, and images belong to their respective rights holders. This independent companion is not affiliated with Konami.</p><p>The Duel Atlas emblem is original artwork. No official artwork is used as app branding.</p><button data-action="close">Back to the workshop</button>`, 'about-body');
}
const actions = {
 close: closeDialog, filters: showFilters, retry: () => requestArchive(true),
 'clear-search': () => { state.filters.query = ''; $('#card-search').value = ''; updateArchive(); $('#card-search').focus(); },
 'reset-filters': () => { Object.assign(state.filters, { query: '', category: 'All', attribute: '', race: '', mechanic: '', sort: 'az' }); closeDialog(); renderArchive(); },
 'add-card': () => {
    try {
      const section = $('#add-section').value;
      state.draft = addCard(state.draft, detailCard, section); state.dirty = true;
      $('#detail-error').textContent = '';
      $('.detail-deck').textContent = `Adding to: ${state.draft.name} · unsaved changes`;
      toast(`${detailCard.name} added to ${sectionName(section)} Deck.`);
      if (state.route === 'decks') renderDeck();
    } catch (error) { $('#detail-error').textContent = error.message; }
 },
 rename: () => showNameDialog(true), 'new-deck': () => showNameDialog(false), 'save-deck': persistDeck, 'open-decks': showSavedDecks,
 rules: showRules, backups: showBackups, 'find-cards': () => { deckIntent = true; navigate('archive'); },
 'export-json': () => download(exportJSON(state.draft), safeFilename() + '.json'),
 'export-ydk': () => download(exportYDK(state.draft), safeFilename() + '.ydk', 'text/plain'),
 import: () => $('#import-file').click(), install: showInstall, settings: showSettings, about: showAbout,
 'refresh-settings': () => { closeDialog(); navigate('archive'); requestArchive(true); },
 'backup-all': () => {
   try { download(JSON.stringify({ version: 1, decks: state.decks, rawStorage: state.storageError ? localStorage.getItem(STORAGE_KEY) : undefined }, null, 2), 'duel-atlas-all-decks.json'); }
   catch { toast('Saved data is not accessible in this browser.', true); }
 }
};
function safeFilename() { return state.draft.name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'duel-atlas-deck'; }
document.addEventListener('click', event => {
  const target = event.target.closest('button, a[data-route]');
  if (!target || target.disabled) return;
  if (target.dataset.route) { event.preventDefault(); if (target.dataset.route === 'archive' && state.route !== 'decks') deckIntent = false; navigate(target.dataset.route); return; }
  if (target.dataset.action) { actions[target.dataset.action]?.(); return; }
  if (target.dataset.category) { state.filters.category = target.dataset.category; document.querySelectorAll('[data-category]').forEach(b => b.setAttribute('aria-pressed', b === target)); updateArchive(); return; }
  if (target.dataset.section) { state.section = target.dataset.section; renderDeck(); return; }
  if (target.dataset.card) {
    const id = Number(target.dataset.card);
    const card = state.cardIndex.get(id) || SECTIONS.flatMap(s => state.draft.sections[s]).find(e => e.card.id === id)?.card;
    if (card) inspectCard(card); return;
  }
  if (target.dataset.remove || target.dataset.increment) {
    const id = Number(target.dataset.remove || target.dataset.increment);
    try {
      const scroll = $('.deck-list').scrollTop;
      const card = state.draft.sections[state.section].find(e => e.card.id === id)?.card;
      state.draft = target.dataset.remove ? removeCard(state.draft, id, state.section) : addCard(state.draft, card, state.section);
      state.dirty = true; renderDeck(); $('.deck-list').scrollTop = scroll;
    } catch (error) { toast(error.message, true); } return;
  }
  if (target.dataset.openDeck) { openDeck(target.dataset.openDeck); return; }
  if (target.dataset.deleteDeck) { deleteDeck(target.dataset.deleteDeck); return; }
  if (target.dataset.preset) MECHANICS.forEach(m => $(`input[name="${m}"]`, modal).checked = target.dataset.preset === 'all' || m === 'Fusion');
});
$('#app-menu').onclick = showMenu;
$('#import-file').onchange = event => handleImport(event.target.files[0]);
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
document.querySelectorAll('[data-icon]').forEach(element => element.innerHTML = icon(element.dataset.icon));
navigate(location.hash.slice(1) || 'home', false);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => toast('Offline app installation is unavailable in this browser session.', true));
}
requestArchive();
// Exposed only as an ES module export for DOM integration tests; no global debug API.
export { state, navigate, requestArchive };
