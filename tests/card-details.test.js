import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {cards,dragon,link,memoryStorage} from './fixtures.js';
import {normalizeCard,filterCards,createDeck,addCard,saveDeck,readDecks,exportJSON,importJSON,validateDeck,deckWarnings} from '../src/core.js';
import {hydrateDeckDates} from '../src/era.js';
import {publicationHTML,cardFactsHTML,battleStatsHTML} from '../src/card-details.js';
const dated=(id,date,ocg=date)=>({...dragon,id,tcgDate:date,ocgDate:ocg,name:'Dated '+id});
test('year ranges include both year boundaries, support one year, and use the selected region',()=>{
 const pool=[dated(1,'2005-12-31'),dated(2,'2006-01-01','2005-08-01'),dated(3,'2006-12-31'),dated(4,'2007-01-01','2006-08-01'),dated(5,null)];
 assert.deepEqual(filterCards(pool,{startYear:2006,year:2006}).map(c=>c.id),[2,3]);
 assert.deepEqual(filterCards(pool,{startYear:2006,year:2006,releaseBasis:'ocg'}).map(c=>c.id),[3,4]);
 assert.deepEqual(filterCards(pool,{startYear:2006,year:2006,releaseBasis:'earliest'}).map(c=>c.id),[3,4]);
 assert.deepEqual(filterCards(pool,{startYear:2005,year:2006}).map(c=>c.id),[1,2,3]);
 assert.ok(filterCards(pool).some(c=>c.id===5));assert.ok(!filterCards(pool,{startYear:2006}).some(c=>c.id===5));
 assert.throws(()=>filterCards([],{startYear:2007,year:2006}),/Beginning year/);
});
test('saved date ranges constrain additions and survive backups while old cutoffs remain compatible',()=>{
 let deck=createDeck('Only 2006');deck.releaseStartYear=2006;deck.releaseYear=2006;deck=addCard(deck,dated(2,'2006-01-01'));
 assert.throws(()=>addCard(deck,dated(1,'2005-12-31')),/beginning year/);assert.throws(()=>addCard(deck,dated(4,'2007-01-01')),/cutoff/);
 const storage=memoryStorage();saveDeck(storage,deck);assert.equal(readDecks(storage)[0].releaseStartYear,2006);assert.equal(importJSON(exportJSON(deck)).releaseStartYear,2006);
 const legacy=structuredClone(deck);delete legacy.releaseStartYear;assert.equal(validateDeck(legacy).releaseStartYear,null);assert.throws(()=>validateDeck({...deck,releaseStartYear:2007}),/Beginning year/);
 const old=addCard(createDeck('Old'),dated(1,'2005-12-31'));old.releaseStartYear=2006;old.releaseYear=2006;assert.ok(deckWarnings(old).some(s=>/release-year/.test(s)));
});
test('publication details show actual region dates, all sets and safe missing-data fallbacks',()=>{
 const window=new Window();try{
 const card=normalizeCard({...dragon,ocgDate:'1999-03-18',card_sets:[{set_name:'First set'},{set_name:'Reprint <script>bad</script>'},{set_name:'First set'}]});
 window.document.body.innerHTML=publicationHTML(card)+cardFactsHTML(card)+battleStatsHTML(card);
 assert.match(window.document.body.textContent,/TCG 2002-03-08 · OCG 1999-03-18/);assert.equal(window.document.querySelectorAll('.card-set-details li').length,2);assert.equal(window.document.querySelector('script'),null);assert.match(window.document.querySelector('.card-battle-stats').textContent,/ATK 3000DEF 2500/);assert.doesNotMatch(window.document.querySelector('.card-facts').textContent,/ATK|DEF/);assert.match(window.document.querySelector('.card-facts').textContent,/Level 8/);
 assert.match(publicationHTML({...card,tcgDate:null,ocgDate:null,setNames:[]}),/First release<\/span> Not recorded/);assert.match(publicationHTML({...card,setNames:[]}),/Set not recorded/);
 assert.match(cardFactsHTML(link),/Link 3/);assert.doesNotMatch(battleStatsHTML(link),/DEF/);assert.match(cardFactsHTML(cards[2]),/Rank 4/);assert.equal(battleStatsHTML(cards[4]),'');
 }finally{window.close();}
});
test('old saved card snapshots acquire archive set names without losing the saved card',()=>{
 const deck=addCard(createDeck('Old'),dragon),live={...normalizeCard(dragon),setNames:['First set','Reprint']};const next=hydrateDeckDates(deck,new Map([[dragon.id,live]]));assert.deepEqual(next.sections.main[0].card.setNames,live.setNames);assert.equal(next.sections.main[0].quantity,1);assert.deepEqual(deck.sections.main[0].card.setNames,[]);
});
