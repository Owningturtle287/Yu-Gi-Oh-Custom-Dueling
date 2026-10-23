import { VERSION, MECHANICS, SECTIONS, LIMITS, createDeck, validName, totals, addCard, removeCard, deckWarnings, readDecks, saveDeck, deleteSavedDeck, exportJSON, importJSON, exportYDK, importYDK, isExtra, validateDeck, STORAGE_KEY, filterCards } from './core.js';
import { loadCards, browserCardCache } from './cards.js';
import { icon } from './icons.js';
import { SUBTYPES, MIN_RELEASE_YEAR, currentYear, normalizeReleaseYear, releaseCutoff, hydrateDeckDates, buildYearHighlights } from './era.js';
import { cardGridLayout } from './layout.js';
import { visibleDeckEntries } from './deck-view.js';
import { patchArena as patchContent } from './duel/dom.js';
import { createSoloController } from './duel/ui.js';
import { support } from './duel/catalog.js';

const $ = (selector, root = document) => root.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const main = $('#main'), modal = $('#modal');
const state = { route: 'home', cards: [], cardIndex: new Map(), cardStatus: 'loading', source: '', cardError: '', cacheWarning: false, filters: { query: '', category: 'All', attribute: '', race: '', subtype: '', mechanic: '', sort: 'az' }, filtered: [], yearHighlights: new Map(), decks: [], draft: createDeck(), section: 'main', dirty: false, storageError: '', showStats: true };
let cache;
try {
  state.decks = readDecks(localStorage);
  if (state.decks.length) state.draft = structuredClone(state.decks[0]);
  state.showStats = localStorage.getItem('duel-atlas.show-stats') !== 'false';
} catch (error) { state.storageError = error.message; }
try { cache = browserCardCache(); } catch { /* API browsing can work without IndexedDB. */ }
let toastTimer, gridObserver, gridFrame, previousFocus, detailCard, cardRequest;
let duelDesign = null;
const deckView = {query:'',category:'All',sort:'type'};
const solo = createSoloController({ main, modal, getCards: () => state.cards, getDecks: () => state.decks, getStatus: () => state.cardStatus, showDialog, dialogHeader, closeDialog, toast,
  onExit: () => navigate('home'),
  onDesign: (side, deck) => confirmReplace(() => {
    duelDesign = side;
    state.draft = deck ? structuredClone(deck) : createDeck(side === 0 ? 'My classic deck' : 'AI classic deck');
    state.draft.releaseYear = 2004; state.dirty = !deck; state.section = 'main';
    state.filters = { query: '', category: 'All', attribute: '', race: '', subtype: '', mechanic: '', sort: 'az' };
    navigate('decks');
  })
});
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
function closeDialog() { modal.close(); detailCard = null; previousFocus?.isConnected && previousFocus.focus({ preventScroll: true }); }
modal.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
modal.addEventListener('click', event => { if (event.target === modal) { const r = modal.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(); } });
document.addEventListener('error', event => {
  if (event.target.tagName === 'IMG' && event.target.src.includes('images.ygoprodeck.com')) {
    if (event.target.dataset.imageFallback) {
      const fallback = event.target.dataset.imageFallback;
      delete event.target.dataset.imageFallback;
      event.target.src = fallback;
      return;
    }
    const placeholder = document.createElement('span');
    placeholder.className = 'image-fallback ' + event.target.className;
    placeholder.dataset.failedImage = event.target.getAttribute('src');
    placeholder.setAttribute('aria-label', 'Card image unavailable');
    placeholder.innerHTML = icon('deck');
    event.target.replaceWith(placeholder);
  }
}, true);
function navigate(route, focus = true) {
  solo.leave();
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
  if (state.route === 'multiplayer') renderMultiplayer();
  if (state.route === 'solo') solo.enter();
  if (focus) main.focus({ preventScroll: true });
}
function renderHome() {
  const archiveStatus = state.cardStatus === 'ready' ? `${state.cards.length.toLocaleString()} cards ${state.source === 'api' ? 'in your archive' : 'available from cache'}` : state.cardStatus === 'loading' ? 'Preparing your card archive…' : 'Archive unavailable · open to retry';
  main.innerHTML = `<section class="screen home" aria-label="Home">
    <div class="home-hero"><div class="hero-copy"><div class="eyebrow">THE DUELIST’S WORKSHOP</div><h1>Build a deck.<br><span>Make your move.</span></h1><p>Your cards. Your next duel.</p></div><div class="hero-art" aria-hidden="true"><div class="hero-orbit"></div><img src="./assets/emblem.svg" alt=""></div><div class="home-status"><span class="status-dot"></span><span>${escape(archiveStatus)}<small>${state.decks.length} saved deck${state.decks.length === 1 ? '' : 's'}</small></span></div></div>
    <div class="home-paths"><div class="section-label"><span>CHOOSE YOUR PATH</span><span>2004 ERA</span></div><div class="home-grid">
      <button class="launch-card solo-launch-card" data-route="solo">${icon('solo')}<span class="arrow" aria-hidden="true">↗</span><span class="soon-label">PLAY SOLO</span><strong>Enter the arena</strong><small>Classic cards. A strategic rival.</small></button>
      <button class="launch-card archive-launch" data-route="archive">${icon('archive')}<span class="arrow" aria-hidden="true">↗</span><strong>Card Archive</strong><small>Find your next ace</small></button>
      <button class="launch-card" data-route="decks">${icon('deck')}<span class="arrow" aria-hidden="true">↗</span><strong>Deck Builder</strong><small>Craft your strategy</small></button>
      <button class="launch-card coming" data-route="multiplayer">${icon('people')}<strong>Multiplayer</strong><span class="soon-label">COMING SOON</span></button>
    </div></div>
  </section>`;
}
function renderArchive() {
  main.innerHTML = `<section class="screen archive-screen" aria-label="Card Archive">
    <div class="page-heading"><div><div class="eyebrow">EXPLORE & DISCOVER</div><h1>Card Archive</h1></div><span class="pill">YGOPRODeck</span></div>
    <div class="search-row"><div class="search-wrap">${icon('search')}<label class="sr-only" for="card-search">Search card name, archetype, or effect text</label><input id="card-search" type="search" placeholder="Name, archetype, or card text" value="${escape(state.filters.query)}" autocomplete="off"><button class="search-clear" data-action="clear-search" aria-label="Clear search">×</button></div><button class="filter-toggle" data-action="filters" data-active="${Boolean(state.filters.attribute || state.filters.race || state.filters.subtype || state.filters.mechanic || state.draft.releaseYear !== null || state.filters.sort !== 'az')}" aria-haspopup="dialog">${icon('filter')}<span>Filters</span></button></div>
    <div class="category-tabs" aria-label="Card category">${[['All', 'All'], ['Monster', 'Monster'], ['Spell', 'Spell'], ['Trap', 'Trap'], ['Extra', 'Extra Deck']].map(([key, label]) => `<button data-category="${key}" aria-pressed="${state.filters.category === key}">${label}</button>`).join('')}</div>
    <div class="result-meta" id="result-meta" role="status"></div>
    <div class="archive-panel" id="archive-panel" aria-label="Scrollable card results" tabindex="0"></div>
  </section>`;
  $('#card-search').addEventListener('input', event => { state.filters.query = event.target.value; updateArchive(); });
  updateArchive();
}
function searchControls() {
  const filtered = Boolean(state.filters.attribute || state.filters.race || state.filters.subtype || state.filters.mechanic || state.draft.releaseYear !== null || state.filters.sort !== 'az' || state.filters.category !== 'All');
  return `<div class="search-row"><div class="search-wrap">${icon('search')}<label class="sr-only" for="card-search">Search card name, archetype, or effect text</label><input id="card-search" type="search" placeholder="Search archive…" value="${escape(state.filters.query)}" autocomplete="off"><button class="search-clear" data-action="clear-search" aria-label="Clear search">×</button></div><button class="filter-toggle" data-action="filters" data-active="${filtered}" aria-haspopup="dialog" aria-label="Filter and sort cards">${icon('filter')}</button></div>`;
}
function defaultCardSection(card) {
  return state.route === 'decks' && state.section === 'side' ? 'side' : isExtra(card) ? 'extra' : 'main';
}
function sectionCopies(card, section) {
  return state.draft.sections[section].find(entry => entry.card.id === card.id)?.quantity || 0;
}
function cardAccent(card) {
  return isExtra(card) ? 'extra' : card.type === 'Spell Card' ? 'spell' : card.type === 'Trap Card' ? 'trap' : 'monster';
}
function quickControls(card, section, tray = false) {
  const quantity = sectionCopies(card, section);
  const supported = !/Token|Skill Card/.test(card.type);
  return `<span class="copy-count" ${quantity ? '' : 'hidden'} aria-label="${quantity} copies in ${sectionName(section)} Deck">×${quantity}</span><div class="quick-controls" aria-label="Change ${escape(card.name)} quantity in ${sectionName(section)} Deck"><button class="quick-remove" data-quick-remove="${card.id}" data-target-section="${section}" ${tray ? 'data-in-tray="true"' : ''} aria-label="Remove one ${escape(card.name)} from ${sectionName(section)} Deck" ${quantity ? '' : 'disabled'}>−</button><button class="quick-add" data-quick-add="${card.id}" data-target-section="${section}" ${tray ? 'data-in-tray="true"' : ''} aria-label="Add one ${escape(card.name)} to ${sectionName(section)} Deck" ${supported ? '' : 'disabled'}>+</button></div>`;
}
function syncQuickControls(tile, card, section) {
  const quantity = sectionCopies(card, section), badge = $('.copy-count', tile);
  badge.textContent = '×' + quantity; badge.hidden = !quantity;
  badge.setAttribute('aria-label', `${quantity} copies in ${sectionName(section)} Deck`);
  $('.quick-remove', tile).disabled = !quantity;
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
  const activeFilters = [state.filters.attribute, state.filters.race, state.filters.subtype, state.filters.mechanic].filter(Boolean).join(' · ');
  const source = state.source === 'offline' ? 'Offline cache' : state.source === 'cache' ? 'Saved archive' : 'Live archive';
  $('#result-meta').innerHTML = `<span><strong>${state.filtered.length.toLocaleString()}</strong> cards · ${escape((state.draft.releaseBasis||'tcg').toUpperCase())} ${state.draft.releaseYear ?? currentYear()}${activeFilters ? ` · ${escape(activeFilters)}` : ''}</span><button data-action="retry" aria-label="Refresh archive from the card API">${source} ↻</button>`;
  if (!state.filtered.length) { panel.innerHTML = `<div class="empty-state">${icon('search')}<h3>No cards found</h3><p>Try another name or clear your filters. Historical years use the first playable edition in your selected region. ${/slifer|obelisk|winged dragon of ra|god card/i.test(state.filters.query)?'The God Cards’ playable TCG editions arrived after 2002.':''}</p><button data-action="all-years">Search all years</button><button data-action="reset-filters">Clear search & filters</button></div>`; return; }
  panel.scrollTop = 0;
  panel.innerHTML = '<div class="virtual-grid" id="virtual-grid"></div>';
  panel.onscroll = () => { cancelAnimationFrame(gridFrame); gridFrame = requestAnimationFrame(renderGrid); };
  if (typeof ResizeObserver !== 'undefined') { gridObserver = new ResizeObserver(renderGrid); gridObserver.observe(panel); }
  renderGrid();
}
// All results remain in one continuous scroll range; no next-page controls.
function filterCardsForUI() {
  const filtered = filterCards(state.cards, { ...state.filters, year: state.draft.releaseYear, releaseBasis:state.draft.releaseBasis });
  if (state.route !== 'decks') return filtered;
  return filtered.filter(card => (!Number.isInteger(duelDesign) || support(card).ok) && !/Token|Skill Card/.test(card.type) && (state.section === 'side' || isExtra(card) === (state.section === 'extra')));
}
function renderGrid() {
  const panel = $('#archive-panel'), grid = $('#virtual-grid');
  if (!panel || !grid) return;
  const width = panel.clientWidth || 350;
  const { columns, gap, tileWidth, tileHeight, stride } = cardGridLayout(width, panel.clientHeight || 500, state.route === 'decks');
  const startRow = Math.max(0, Math.floor(panel.scrollTop / stride) - 1);
  const endRow = Math.min(Math.ceil(state.filtered.length / columns), Math.ceil((panel.scrollTop + (panel.clientHeight || 500)) / stride) + 1);
  grid.style.height = `${Math.ceil(state.filtered.length / columns) * stride - gap}px`;
  const existing = new Map([...grid.children].map(element => [element.dataset.cardId, element]));
  const needed = new Set();
  state.filtered.slice(startRow * columns, endRow * columns).forEach((card, offset) => {
    const index = startRow * columns + offset;
    const subtitle = state.showStats && card.atk !== undefined ? `ATK ${card.atk < 0 ? '?' : card.atk} · ${card.linkval !== undefined ? 'LINK ' + card.linkval : 'DEF ' + (card.def < 0 ? '?' : card.def ?? '—')}` : cardLabel(card);
    const key = String(card.id); needed.add(key);
    let tile = existing.get(key);
    if (!tile) {
      const template = document.createElement('template');
      template.innerHTML = `<article class="card-tile" data-card-id="${card.id}" data-kind="${cardAccent(card)}"><button class="card-inspect" data-card="${card.id}" aria-label="Inspect ${escape(card.name)}">${imageTag(card, true, 'card-image')}<strong>${escape(card.name)}</strong><small>${escape(subtitle)}</small></button>${quickControls(card, defaultCardSection(card))}</article>`;
      tile = template.content.firstElementChild;
      grid.append(tile);
    }
    tile.style.cssText = `width:${tileWidth}px;height:${tileHeight}px;left:${(index % columns) * (tileWidth + gap)}px;top:${Math.floor(index / columns) * stride}px`;
    syncQuickControls(tile, card, defaultCardSection(card));
  });
  for (const [key, tile] of existing) if (!needed.has(key) && !tile.contains(document.activeElement)) tile.remove();
}
async function requestArchive(force = false) {
  if (cardRequest) return cardRequest;
  state.cardStatus = 'loading';
  if (state.route === 'archive' || state.route === 'decks') updateArchive();
  if (state.route === 'home') renderHome();
  cardRequest = (async () => {
    try {
      const result = await loadCards({ cache, force });
      state.cards = result.cards; state.cardIndex = new Map(result.cards.map(c => [c.id, c]));
      state.decks = state.decks.map(deck => hydrateDeckDates(deck, state.cardIndex));
      state.draft = hydrateDeckDates(state.draft, state.cardIndex);
      state.yearHighlights = buildYearHighlights(state.cards);
      if (state.route === 'decks') refreshDeckWorkspace();
      state.source = result.source; state.cacheWarning = result.cacheWarning; state.cardStatus = 'ready';
      if (result.source === 'offline') toast('Using your saved archive. The API is unavailable.');
      if (result.cacheWarning) toast('Cards loaded. This browser could not save the archive for offline use.', true);
    } catch (error) { state.cardStatus = 'error'; state.cardError = error.message; }
    finally {
      cardRequest = null;
      if (state.route === 'archive' || state.route === 'decks') updateArchive();
      if (state.route === 'home') renderHome();
      if (state.route === 'solo') solo.refresh();
    }
  })();
  return cardRequest;
}
function yearContextHTML(value,basis=state.draft.releaseBasis||'tcg') {
  const region=basis==='earliest'?'earliest TCG / OCG':basis.toUpperCase();
  const year = normalizeReleaseYear(value) ?? currentYear();
  const context = (basis==='tcg'?state.yearHighlights:buildYearHighlights(state.cards,basis)).get(year);
  if (!context) return `<strong>${year} · ${region} context</strong><p>Load the archive to see this year’s additions.</p>`;
  const lines = [];
  if (context.introduced.length) lines.push(`New types / mechanics: ${context.introduced.join(', ')}.`);
  if (context.archetypes.length) lines.push(`New archetypes: ${context.archetypes.join(', ')}.`);
  if (!lines.length) lines.push(`${context.newCards.toLocaleString()} new cards with recorded ${region} dates. No new type or mechanic is recorded for this year.`);
  return `<strong>New in ${year} · from ${region} release data</strong><ul>${lines.map(line => `<li>${escape(line)}</li>`).join('')}</ul>`;
}
function showFilters() {
  const options = (values, selected, title) => `<option value="">${title}</option>${values.map(value => `<option ${selected === value ? 'selected' : ''} value="${escape(value)}">${escape(value)}</option>`).join('')}`;
  const races = [...new Set(state.cards.map(card => card.race).filter(Boolean))].sort();
  const years = Array.from({ length: currentYear() - MIN_RELEASE_YEAR }, (_, index) => currentYear() - index - 1);
  const selectedYear = state.draft.releaseYear;
  const yearOptions = `<option value="current" ${selectedYear === null ? 'selected' : ''}>Current year (${currentYear()}) · through today</option>${years.map(year => `<option value="${year}" ${selectedYear === year ? 'selected' : ''}>${year} · through December 31</option>`).join('')}`;
  showDialog(`${dialogHeader('Card filters')}<form id="filters-form">
    <div class="filter-tabs" role="tablist" aria-label="Filter panels"><button type="button" id="card-filter-tab" role="tab" aria-selected="true" aria-controls="card-filter-panel" data-filter-panel="cards">Card filters</button><button type="button" id="year-filter-tab" role="tab" aria-selected="false" aria-controls="year-filter-panel" data-filter-panel="year">Release year · ${selectedYear ?? currentYear()}</button></div>
    <div id="card-filter-panel" class="field-grid filter-panel" role="tabpanel" aria-labelledby="card-filter-tab">
      <label>Category<select name="category">${['All', 'Monster', 'Spell', 'Trap', 'Extra'].map(category => `<option value="${category}" ${state.filters.category === category ? 'selected' : ''}>${category === 'Extra' ? 'Extra Deck' : category === 'All' ? 'All cards' : category}</option>`).join('')}</select></label>
      <label>Attribute<select name="attribute">${options(['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'], state.filters.attribute, 'All attributes')}</select></label>
      <label>Type / race<select name="race">${options(races, state.filters.race, 'All types')}</select></label>
      <label>Monster subtype<select name="subtype">${options(SUBTYPES, state.filters.subtype, 'All subtypes')}</select></label>
      <label>Mechanic<select name="mechanic">${options(MECHANICS, state.filters.mechanic, 'All mechanics')}</select></label>
      <label>Sort by<select name="sort">${[['az', 'Name A–Z'], ['za', 'Name Z–A'], ['atk', 'Highest ATK'], ['level', 'Highest level / rank / Link']].map(([value, label]) => `<option value="${value}" ${state.filters.sort === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    </div>
    <div id="year-filter-panel" class="filter-panel" role="tabpanel" aria-labelledby="year-filter-tab" hidden><label for="release-year">Playable through year<select id="release-year" name="year">${yearOptions}</select></label><label>Release region<select name="releaseBasis">${[['tcg','TCG · international'],['ocg','OCG · Japan / Asia'],['earliest','Earliest TCG or OCG']].map(([v,l])=>`<option value="${v}" ${(state.draft.releaseBasis||'tcg')===v?'selected':''}>${l}</option>`).join('')}</select></label><div id="year-context" class="year-context" role="status" aria-live="polite">${yearContextHTML(selectedYear)}</div><p class="year-help">Historical years require a verified playable release date in this region. Current includes undated cards. Collector promos, anime dates, past card text and banlists are excluded.</p></div>
    <div class="dialog-actions"><button type="button" data-action="reset-filters">Reset filters</button><button class="primary" type="submit">Show cards</button></div>
  </form>`, 'filter-body');
  const activatePanel = panel => {
    const year = panel === 'year';
    $('#card-filter-panel').hidden = year; $('#year-filter-panel').hidden = !year;
    $('#card-filter-tab').setAttribute('aria-selected', String(!year)); $('#year-filter-tab').setAttribute('aria-selected', String(year));
  };
  modal.querySelectorAll('[data-filter-panel]').forEach(button => {
    button.onclick = () => activatePanel(button.dataset.filterPanel);
    button.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const panel = event.key === 'Home' ? 'cards' : event.key === 'End' ? 'year' : button.dataset.filterPanel === 'cards' ? 'year' : 'cards';
      activatePanel(panel); $(`[data-filter-panel="${panel}"]`).focus({ preventScroll: true });
    };
  });
  $('#release-year').value = selectedYear === null ? 'current' : String(selectedYear);
  const updateYearContext=()=>{ $('#year-context').innerHTML=yearContextHTML($('#release-year').value,modal.querySelector('[name=releaseBasis]').value); };
  $('#release-year').onchange=updateYearContext;modal.querySelector('[name=releaseBasis]').onchange=updateYearContext;
  $('#filters-form').addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target)), year = normalizeReleaseYear(data.year);
    const releaseBasis=data.releaseBasis; delete data.releaseBasis;
    delete data.year; Object.assign(state.filters, data);
    if(state.draft.releaseBasis!==releaseBasis){state.draft.releaseBasis=releaseBasis;state.dirty=true;}
    if (state.draft.releaseYear !== year) { state.draft = { ...state.draft, releaseYear: year }; state.dirty = true; }
    closeDialog(); if (state.route === 'decks') renderDeck(); else renderArchive();
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
  const defaultSection = defaultCardSection(card);
  const supported = !/Token|Skill Card/.test(card.type);
  showDialog(`${dialogHeader(escape(card.name))}<div class="detail-top">${imageTag(card)}<div class="detail-meta"><p class="type">${escape(cardLabel(card))}</p><div class="attribute">${escape([card.attribute, card.race, card.archetype].filter(Boolean).join(' · '))}</div><div class="card-stats">${stats.map(([label, value]) => `<span>${label}<b>${escape(value)}</b></span>`).join('')}</div>${card.linkmarkers?.length ? `<div class="attribute">Arrows: ${escape(card.linkmarkers.join(', '))}</div>` : ''}</div></div>
    <div class="effect-label">CARD TEXT</div><div class="effect-text" tabindex="0" aria-label="Scrollable card effect text">${escape(card.desc || 'No effect text available.')}</div>
    <p id="detail-error" class="inline-error" role="alert"></p>
    <div class="detail-deck">Adding to: <strong>${escape(state.draft.name)}</strong>${state.dirty ? ' · unsaved changes' : ''}</div>
    <div class="detail-add"><label class="sr-only" for="add-section">Deck section</label><select id="add-section">${SECTIONS.map(s => `<option value="${s}" ${s === defaultSection ? 'selected' : ''} ${s === 'main' && isExtra(card) || s === 'extra' && !isExtra(card) ? 'disabled' : ''}>${sectionName(s)} Deck</option>`).join('')}</select><button class="primary" data-action="add-card" ${!supported ? 'disabled' : ''}>${supported ? 'Add to Deck' : 'Not supported'}</button></div>`, 'detail-body');
}
function deckPickerOptions() {
  const decks = [state.draft, ...state.decks.filter(deck => deck.id !== state.draft.id)];
  return decks.map(deck => `<option value="${escape(deck.id)}" ${deck.id === state.draft.id ? 'selected' : ''}>${escape(deck.name)}${deck.id === state.draft.id && state.dirty ? ' · unsaved' : ''}</option>`).join('');
}
function renderDeck() {
  gridObserver?.disconnect();
  main.innerHTML = `<section class="screen deck-screen" aria-label="Deck Builder">
    <div class="deck-switch-row"><label class="sr-only" for="deck-picker">Current deck · switch saved decks</label><select id="deck-picker">${deckPickerOptions()}</select><span class="deck-state" role="status"></span><button class="icon-button" data-action="new-deck" aria-label="Create a new deck">${icon('plus')}</button><button class="primary" data-action="${Number.isInteger(duelDesign)?'return-solo':'save-deck'}">${Number.isInteger(duelDesign)?'Save & return':'Save'}</button><button class="icon-button" data-action="deck-options" aria-label="Deck options: rename, saved decks, rules, import and export" aria-haspopup="dialog">⋯</button></div>
    <div class="builder-panels">
      <section class="builder-deck-panel" aria-label="Your deck"><h2 class="sr-only">Your deck</h2><div class="builder-panel-heading"><label class="deck-query">${icon('search')}<span class="sr-only">Search this deck</span><input id="deck-query" type="search" placeholder="Search your deck…" value="${escape(deckView.query)}" autocomplete="off"></label><button data-action="deck-view-filters" aria-label="Filter and sort your deck">${icon('filter')}</button></div>
        <div class="deck-tabs" aria-label="Visible deck section">${SECTIONS.map(section => `<button data-section="${section}" aria-pressed="${state.section === section}">${sectionName(section)} <span data-section-count="${section}"></span></button>`).join('')}</div>
        <div class="deck-list deck-tray" aria-label="Scrollable ${sectionName(state.section)} Deck" tabindex="0"></div>
        <div class="deck-view-summary" role="status"></div>
      </section>
      <section class="builder-archive-panel" aria-label="Card archive"><h2 class="sr-only">Card archive</h2>${searchControls()}<div class="archive-panel" id="archive-panel" aria-label="Scrollable cards to add to your deck" tabindex="0"></div><div class="result-meta" id="result-meta" role="status"></div></section>
    </div>
  </section>`;
  $('#card-search').addEventListener('input', event => { state.filters.query = event.target.value; updateArchive(); });
  $('#deck-query').addEventListener('input', event => { deckView.query=event.target.value; refreshDeckWorkspace({resetTray:true}); });
  refreshDeckWorkspace();
  updateArchive();
}
function refreshDeckWorkspace({ resetTray = false } = {}) {
  if (state.route !== 'decks' || !$('.deck-tray')) { if (state.route === 'archive') renderGrid(); return; }
  const tray = $('.deck-tray'), scrollLeft = resetTray ? 0 : tray.scrollLeft, scrollTop = resetTray ? 0 : tray.scrollTop;
  const focused = tray.contains(document.activeElement) ? document.activeElement : null;
  const focusedAction = focused?.dataset.quickAdd ? 'quick-add' : focused?.dataset.quickRemove ? 'quick-remove' : focused?.dataset.card ? 'card' : null;
  const focusedId = focusedAction ? focused.getAttribute('data-' + focusedAction) : null;
  const counts = totals(state.draft), warnings = deckWarnings(state.draft);
  $('#deck-picker').innerHTML = deckPickerOptions();
  const status = $('.deck-state');
  status.textContent = state.storageError ? 'Storage unavailable · export a backup' : warnings.some(w => w.includes('release-year')) ? 'Review cards outside this release year' : warnings.some(w => w.includes('disabled')) ? 'Review disabled mechanics in Deck options' : state.dirty ? 'Unsaved changes' : state.decks.some(deck => deck.id === state.draft.id) ? 'Saved on this device' : 'New deck · tap Save to keep it';
  status.classList.toggle('restricted', warnings.some(w => w.includes('disabled') || w.includes('release-year')) || Boolean(state.storageError));
  SECTIONS.forEach(section => {
    $(`[data-section-count="${section}"]`).textContent = `${counts[section]}/${LIMITS[section]}`;
    $(`[data-section="${section}"]`).setAttribute('aria-pressed', state.section === section);
  });
  tray.setAttribute('aria-label', `Scrollable ${sectionName(state.section)} Deck · card names, quantities and controls`);
  const allEntries = state.draft.sections[state.section];
  const entries = visibleDeckEntries(allEntries,deckView);
  const visibleCopies=entries.reduce((sum,entry)=>sum+entry.quantity,0);
  $('.deck-view-summary').textContent=`${visibleCopies} of ${counts[state.section]} cards · ${entries.length} unique · ${sectionName(state.section)} Deck${state.storageError?' · Storage unavailable':state.dirty?' · Unsaved':''}`;
  tray.classList.toggle('is-empty', !entries.length);
  const content = entries.length ? entries.map(entry => `<article class="tray-card" data-kind="${cardAccent(entry.card)}" data-deck-card="${entry.card.id}" data-render-key="deck:${entry.card.id}"><button class="deck-inspect" data-card="${entry.card.id}" aria-label="Inspect ${escape(entry.card.name)}">${imageTag(entry.card, true)}<strong>${escape(entry.card.name)}</strong></button>${quickControls(entry.card, state.section, true)}</article>`).join('') : `<div class="tray-empty">${icon('deck')}<span><strong>${allEntries.length?'No matching cards':sectionName(state.section)+' Deck is empty'}</strong><small>${allEntries.length?'Try another search or show all cards.':state.section === 'extra' ? 'Fusion, Synchro, Xyz, and Link monsters' : state.section === 'side' ? 'Keep alternate options here' : 'Tap + on a card in the archive beside your deck'}</small>${allEntries.length?'<button data-action="reset-deck-view">Show all cards</button>':''}</span></div>`;
  patchContent(tray,content);
  tray.scrollLeft = scrollLeft; tray.scrollTop = scrollTop;
  if (focusedAction) {
    const replacement = $(`[data-${focusedAction}="${focusedId}"]`, tray);
    if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
  }
  renderGrid();
}
function showDeckViewFilters() {
  showDialog(`${dialogHeader('Organize your deck view')}<div class="deck-view-filters"><label>Show<select id="deck-category">${['All','Monster','Spell','Trap'].map(value=>`<option value="${value}" ${deckView.category===value?'selected':''}>${value==='All'?'All cards':value+'s'}</option>`).join('')}</select></label><label>Order<select id="deck-sort">${[['type','Card type'],['az','Name A–Z'],['atk','Highest ATK'],['def','Highest DEF'],['level','Highest Level / Rank']].map(([value,label])=>`<option value="${value}" ${deckView.sort===value?'selected':''}>${label}</option>`).join('')}</select></label></div><p>View settings keep the saved deck order intact.</p><div class="dialog-actions"><button data-action="reset-deck-view">Reset view</button><button class="primary" data-action="close">Done</button></div>`,'deck-view-filter-body');
  for(const [id,key] of [['deck-category','category'],['deck-sort','sort']])$('#'+id).onchange=event=>{deckView[key]=event.target.value;refreshDeckWorkspace({resetTray:true});};
}
function showDeckOptions() {
  showDialog(`${dialogHeader('Deck options')}<p>${escape(state.draft.name)} · ${state.dirty ? 'unsaved changes' : 'current deck'}</p><button class="menu-item" data-action="rename">${icon('edit')}<span>Rename deck</span></button><button class="menu-item" data-action="open-decks">${icon('deck')}<span>Manage saved decks<small>Open or delete saved decks</small></span></button><button class="menu-item" data-action="rules">${icon('rules')}<span>Rules / Format<small>Summoning mechanic restrictions</small></span></button><button class="menu-item" data-action="backups">${icon('backup')}<span>Import / Export<small>JSON and YDK backups</small></span></button><button class="menu-item" data-action="app-info">${icon('info')}<span>App menu<small>Settings, install help and credits</small></span></button>`, 'menu-body');
}
function changeCardQuantity(cardId, section, remove = false) {
  const card = state.cardIndex.get(cardId) || SECTIONS.flatMap(s => state.draft.sections[s]).find(entry => entry.card.id === cardId)?.card;
  if (!card) return;
  try {
    if (remove && !sectionCopies(card, section)) return;
    state.draft = remove ? removeCard(state.draft, cardId, section) : addCard(state.draft, card, section);
    state.dirty = true;
    refreshDeckWorkspace();
    $('#card-announcement').textContent = `${card.name}: ${sectionCopies(card, section)} copies in ${sectionName(section)} Deck.`;
  } catch (error) { toast(error.message, true); }
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
    if (state.route === 'decks') refreshDeckWorkspace();
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
  showDialog(`${dialogHeader('Delete saved deck?')}<p>Delete “${escape(deck.name)}” from this device? ${state.draft.id===id&&state.dirty?'Its unsaved edits will also be removed. ':''}Your other saved decks stay available.</p><div class="dialog-actions"><button data-action="open-decks">Keep deck</button><button class="danger" id="confirm-delete">Delete deck</button></div>`);
  $('#confirm-delete').onclick = () => {
    try {
      const previousIndex=state.decks.findIndex(deck=>deck.id===id);
      const next=deleteSavedDeck(localStorage,id);
      state.decks=next;
      if(state.draft.id===id){
        state.draft=next.length?structuredClone(next[Math.min(previousIndex,next.length-1)]):createDeck();
        state.dirty=false; state.section='main'; deckView.query=''; deckView.category='All';
      }
      if (state.route === 'decks') renderDeck();
      showSavedDecks(); toast('Saved deck deleted.');
    } catch { toast('Could not delete from browser storage.', true); }
  };
}
function showRules() {
  showDialog(`${dialogHeader('Rules / Format')}<p>Choose which summoning mechanics this deck allows.</p><div class="button-row"><button data-preset="all">All mechanics</button><button data-preset="pre">Pre-Synchro</button></div><div class="mechanic-list">${MECHANICS.map(m => `<label><input type="checkbox" name="${m}" ${state.draft.mechanics[m] ? 'checked' : ''}><span>${m}</span></label>`).join('')}</div><p class="help-note">These are mechanic restrictions, not historical release-date formats. Pre-Synchro enables Fusion only. These editor switches do not apply a banlist. Solo validates supported cards separately.</p><p class="muted">Existing cards stay in your deck; disabled mechanics are flagged for review.</p><div class="dialog-actions"><button data-action="close">Cancel</button><button class="primary" id="apply-rules">Apply to deck</button></div>`);
  $('#apply-rules').onclick = () => {
    state.draft.mechanics = Object.fromEntries(MECHANICS.map(m => [m, $(`input[name="${m}"]`, modal).checked]));
    state.dirty = true; closeDialog(); if (state.route === 'decks') refreshDeckWorkspace(); toast('Mechanic restrictions updated. Tap Save deck to keep them.');
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
        const copies = parsed.decks.map(value => ({ ...hydrateDeckDates(validateDeck(value), state.cardIndex), id: crypto.randomUUID() }));
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
    confirmReplace(() => { state.draft = hydrateDeckDates(imported, state.cardIndex); state.dirty = true; state.section = 'main'; closeDialog(); navigate('decks'); toast('Deck imported. Tap Save deck to keep this copy.'); });
  } catch (error) { toast(error.message || 'This backup could not be imported.', true); }
  finally { $('#import-file').value = ''; }
}
function renderMultiplayer() {
  main.innerHTML = `<section class="screen placeholder-screen" aria-label="Multiplayer coming soon"><div class="placeholder-art">${icon('people')}</div><span class="pill gold">COMING IN A LATER PHASE</span><h1>A duel. A direct connection.</h1><p>Direct peer-to-peer duels are planned, without requiring a dedicated game server. Practice against the local AI in Solo Duel while connections are being built.</p><div class="preview-panel"><div class="button-row"><button disabled>Create room</button><button disabled>Join room</button></div><label for="room-code">Room code · preview only<input id="room-code" placeholder="— — — — — —" maxlength="6" disabled aria-label="Room code preview, coming soon"></label><small>Rooms and connections are not active in v${VERSION}.</small></div><button class="primary" data-route="solo">Play Solo Duel</button><small class="muted">Functionality testing release · v${VERSION}</small></section>`;
}
let installPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Duel Atlas added to your home screen.'); });
function showMenu() {
  showDialog(`${dialogHeader('Duel Atlas')}<p>Duel Atlas · v${VERSION}<br>Your cards. Your decks. Your next duel.</p><button class="menu-item" data-action="install">${icon('backup')}<span>Install on your phone<small>Add Duel Atlas to your home screen</small></span></button><button class="menu-item" data-action="settings">${icon('filter')}<span>App settings<small>Card display and archive refresh</small></span></button><button class="menu-item" data-action="about">${icon('info')}<span>About this release<small>Scope, card data, and credits</small></span></button><button class="menu-item" data-route="solo">${icon('solo')}<span>Solo Duel<small>Playable 2004 Lab · local AI</small></span></button>`, 'menu-body');
}
function showInstall() {
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  showDialog(`${dialogHeader('Take your workshop with you')}<p>${installed ? 'Duel Atlas is already running as an installed app.' : 'Open the hosted app in your phone’s browser to add it to your home screen.'}</p><div class="help-note install-instructions"><div><strong>iPhone / iPad · Safari</strong><br>Tap Share, then Add to Home Screen.</div><div><strong>Android · Chrome</strong><br>Open the browser menu, then Install app or Add to Home screen.</div></div><p>Once you’ve opened the archive online, cached card data and saved decks work offline. Card images become available offline as you view them.</p><div class="dialog-actions">${installPrompt ? '<button class="primary" id="install-now">Install Duel Atlas</button>' : ''}<button data-action="close">Got it</button></div>`, 'install-body');
  if ($('#install-now')) $('#install-now').onclick = async () => { await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; showInstall(); };
}
function showSettings() {
  showDialog(`${dialogHeader('App settings')}<section class="settings-card"><h3>Card display</h3><label class="settings-label"><span>Show ATK / DEF in archive</span><input id="show-stats" type="checkbox" ${state.showStats ? 'checked' : ''}></label><p>Search and filters run on your device.</p></section><section class="settings-card"><h3>On this device</h3><p>${state.decks.length} saved decks · archive refreshes daily</p><button data-action="refresh-settings">Refresh archive</button><button data-action="backup-all">Back up all decks</button></section>${state.storageError ? '<p class="inline-error">Browser storage could not be read. Back up the saved data before fixing or clearing it in browser settings.</p>' : ''}<button data-action="close">Done</button>`, 'settings-body');
  $('#show-stats').onchange = event => {
    state.showStats = event.target.checked;
    try { localStorage.setItem('duel-atlas.show-stats', String(state.showStats)); } catch { toast('Setting applied for this session. Browser storage is unavailable.', true); }
  };
}
function showAbout() {
  showDialog(`${dialogHeader('About Duel Atlas')}<span class="pill gold">v${VERSION} · FUNCTIONALITY TEST</span><p>Explore the full archive, build local decks and play Solo with the supported 2004 TCG pool. Multiplayer is coming later.</p><p>Solo uses current card text and modern turn rules. Open Solo → Rules & cards for supported cards and limits.</p><p>Data and official card art: <a href="https://ygoprodeck.com/api-guide/" target="_blank" rel="noopener noreferrer">YGOPRODeck</a>. An independent fan app, unaffiliated with Konami. Card names and images belong to their rights holders; Duel Atlas branding is original.</p><p>Rules powered by <a href="https://github.com/n1xx1/ocgcore-wasm">ocgcore-wasm</a>, <a href="https://github.com/edo9300/ygopro-core">EDOPro</a> and <a href="https://github.com/ProjectIgnis/CardScripts">Project Ignis</a>. <a href="./assets/rules/THIRD_PARTY_NOTICES.md">Licenses & source</a>.</p><button data-action="close">Done</button>`, 'about-body');
}

const actions = {
 'return-solo': () => { if (persistDeck()) { solo.setDesignedDeck(duelDesign, state.draft.id); duelDesign = null; navigate('solo'); } },
 close: closeDialog, filters: showFilters, retry: () => requestArchive(true),
 'clear-search': () => { state.filters.query = ''; $('#card-search').value = ''; updateArchive(); $('#card-search').focus(); },
 'all-years': () => { state.draft.releaseYear=null; state.dirty=true; closeDialog(); if(state.route==='decks')renderDeck();else renderArchive(); },
 'reset-filters': () => { state.draft.releaseBasis='tcg';Object.assign(state.filters, { query: '', category: 'All', attribute: '', race: '', subtype: '', mechanic: '', sort: 'az' }); if (state.draft.releaseYear !== null) { state.draft.releaseYear = null; state.dirty = true; } closeDialog(); if (state.route === 'decks') renderDeck(); else renderArchive(); },
 'add-card': () => {
    try {
      const section = $('#add-section').value;
      state.draft = addCard(state.draft, state.cardIndex.get(detailCard.id) || detailCard, section); state.dirty = true;
      $('#detail-error').textContent = '';
      $('.detail-deck').textContent = `Adding to: ${state.draft.name} · unsaved changes`;
      toast(`${detailCard.name} added to ${sectionName(section)} Deck.`);
      refreshDeckWorkspace();
    } catch (error) { $('#detail-error').textContent = error.message; }
 },
 rename: () => showNameDialog(true), 'new-deck': () => showNameDialog(false), 'save-deck': persistDeck, 'open-decks': showSavedDecks,
 'reset-deck-view': () => { deckView.query=''; deckView.category='All'; $('#deck-query').value=''; if($('#deck-category'))$('#deck-category').value='All'; refreshDeckWorkspace({resetTray:true}); },
 'app-info':showMenu, rules: showRules, backups: showBackups, 'deck-options': showDeckOptions, 'deck-view-filters':showDeckViewFilters, 'find-cards': () => { navigate('decks'); $('#card-search').focus({ preventScroll: true }); },
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
  if (target.dataset.route) { event.preventDefault(); navigate(target.dataset.route); return; }
  if (target.dataset.action) { actions[target.dataset.action]?.(); return; }
  if (target.dataset.category) { state.filters.category = target.dataset.category; document.querySelectorAll('[data-category]').forEach(b => b.setAttribute('aria-pressed', b === target)); updateArchive(); return; }
  if (target.dataset.section) { state.section = target.dataset.section; refreshDeckWorkspace({ resetTray: true }); updateArchive(); return; }
  if (target.dataset.card) {
    const id = Number(target.dataset.card);
    const card = state.cardIndex.get(id) || SECTIONS.flatMap(s => state.draft.sections[s]).find(e => e.card.id === id)?.card;
    if (card) inspectCard(card); return;
  }
  if (target.dataset.quickAdd || target.dataset.quickRemove) {
    changeCardQuantity(Number(target.dataset.quickAdd || target.dataset.quickRemove), target.dataset.targetSection, Boolean(target.dataset.quickRemove));
    return;
  }
  if (target.dataset.openDeck) { openDeck(target.dataset.openDeck); return; }
  if (target.dataset.deleteDeck) { deleteDeck(target.dataset.deleteDeck); return; }
  if (target.dataset.preset) MECHANICS.forEach(m => $(`input[name="${m}"]`, modal).checked = target.dataset.preset === 'all' || m === 'Fusion');
});
main.addEventListener('change', event => {
  if (event.target.id !== 'deck-picker') return;
  const id = event.target.value;
  event.target.value = state.draft.id;
  if (id !== state.draft.id) openDeck(id);
});
$('#app-menu').onclick = showMenu;
$('#import-file').onchange = event => handleImport(event.target.files[0]);
window.addEventListener('hashchange', () => { const route = location.hash.slice(1); if (route !== state.route) navigate(route); });
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
document.querySelectorAll('[data-icon]').forEach(element => element.innerHTML = icon(element.dataset.icon));
navigate(location.hash.slice(1) || 'home', false);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => toast('Offline app installation is unavailable in this browser session.', true));
}
requestArchive();
// Exposed only as an ES module export for DOM integration tests; no global debug API.
export { state, navigate, requestArchive };
