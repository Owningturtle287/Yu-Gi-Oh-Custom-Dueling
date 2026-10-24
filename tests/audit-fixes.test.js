import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDeck,addCard,removeCard,normalizeCard,cardCopyName,deckCopyCount,deckWarnings,saveDeck,readDecks,deleteSavedDeck,STORAGE_KEY,importJSON,exportJSON,importYDK,exportYDK} from '../src/core.js';
import {defaultSide,generateDeck,generationProblem,validateDuelDeck} from '../src/duel/decks.js';
import {memoryStorage,dragon} from './fixtures.js';
const aliases=JSON.parse(await readFile(new URL('./deck-alias-fixtures.json',import.meta.url))).data.map(normalizeCard);
const get=name=>aliases.find(c=>c.name===name);
const normals=Array.from({length:14},(_,i)=>({...dragon,id:400000+i,name:'Audit warrior '+i,level:4,atk:1200+i*30}));

test('saving reads the newest persisted deck list instead of overwriting other tabs or resurrecting their deletions',()=>{
 const storage=memoryStorage(),one=createDeck('One','one'),two=createDeck('Two','two');
 saveDeck(storage,one);const stale=readDecks(storage);
 saveDeck(storage,two);saveDeck(storage,{...stale[0],name:'Edited One'});
 assert.deepEqual(new Set(readDecks(storage).map(d=>d.id)),new Set(['one','two']));
 deleteSavedDeck(storage,'two');saveDeck(storage,{...one,name:'Edited again'});
 assert.deepEqual(readDecks(storage).map(d=>d.id),['one']);
 const broken='{broken';storage.setItem(STORAGE_KEY,broken);
 assert.throws(()=>saveDeck(storage,one));assert.equal(storage.getItem(STORAGE_KEY),broken);
});

test('permanent name variants share three copies across Main, Extra and Side',()=>{
 for(const names of [['Umi','A Legendary Ocean'],['Harpie Lady','Harpie Lady 1','Harpie Lady 2','Harpie Lady 3','Cyber Harpie Lady']]){
  let deck=createDeck('Aliases');
  for(let i=0;i<3;i++)deck=addCard(deck,get(names[i%names.length]),i===2?'side':'main');
  assert.equal(deckCopyCount(deck,get(names.at(-1))),3);
  for(const name of names)assert.throws(()=>addCard(deck,get(name)),/Copy limit/);
  deck=removeCard(deck,get(names[2%names.length]).id,'side');
  assert.equal(deckCopyCount(addCard(deck,get(names.at(-1))),get(names[0])),3);
 }
 assert.equal(cardCopyName(get('Harpie Queen')),'Harpie Queen','An on-field/GY name change does not affect deck construction');
 assert.equal(cardCopyName({...dragon,desc:'(This card is always treated as a "Blue-Eyes" card.)'}),dragon.name,'Archetype membership is not a shared card name');
 assert.equal(cardCopyName({...get('A Legendary Ocean'),desc:'(This card is always treated as "Umi".)'}),'Umi');
});

test('imports reject over-limit same-name variants while existing saved decks remain repairable',()=>{
 let deck=createDeck('Legacy aliases','legacy');
 deck.sections.main=[{card:get('Harpie Lady'),quantity:3},{card:get('Harpie Lady 1'),quantity:1}];
 assert.throws(()=>importJSON(exportJSON(deck)),/Copy limit/);
 assert.throws(()=>importYDK(exportYDK(deck),aliases,'Imported'),/Copy limit/);
 const storage=memoryStorage();storage.setItem(STORAGE_KEY,JSON.stringify({version:1,decks:[deck]}));
 deck=readDecks(storage)[0];assert.equal(deckCopyCount(deck,get('Harpie Lady')),4);
 assert.match(deckWarnings(deck).join(' '),/Copy limit exceeded for Harpie Lady/);
 assert.doesNotThrow(()=>saveDeck(storage,deck));
 assert.ok(validateDuelDeck(deck,aliases).some(issue=>/Harpie Lady: maximum 3/.test(issue)));
 deck=removeCard(deck,get('Harpie Lady 1').id,'main');saveDeck(storage,deck);
 assert.ok(!deckWarnings(readDecks(storage)[0]).some(w=>/Copy limit/.test(w)));
});

test('duel validation counts the Side Deck and uses archive name clauses rather than stale snapshots',()=>{
 const deck=createDeck('Forged alias');deck.sections.main=[{card:get('Harpie Lady'),quantity:3}];
 deck.sections.side=[{card:{...get('Harpie Lady 1'),desc:'Changed snapshot text'},quantity:1}];
 assert.ok(validateDuelDeck(deck,aliases).some(issue=>/Harpie Lady: maximum 3/.test(issue)));
});

test('random decks and pool-capacity checks honor shared-name copy limits',()=>{
 const variants=aliases.filter(c=>cardCopyName(c)==='Harpie Lady');
 assert.match(generationProblem([...normals.slice(0,12),...variants]),/fewer than 40/,'Five Harpie printings only supply three copies');
 const pool=[...normals,...variants];
 for(let seed=1;seed<=40;seed++){
  const deck=generateDeck(pool,defaultSide(),[],seed);
  assert.equal(deck.sections.main.reduce((n,e)=>n+e.quantity,0),40);
  assert.ok(deckCopyCount(deck,get('Harpie Lady'))<=3);
  assert.deepEqual(validateDuelDeck(deck,pool),[]);
 }
});
