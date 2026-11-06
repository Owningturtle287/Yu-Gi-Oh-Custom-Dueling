import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {radioGroup,permissionGroup,choicePanels,mountChoices,radioValue} from '../src/menu-controls.js';
test('native radio filters expose allowed/excluded values, preserve FormData and support keyboard group navigation',()=>{
 const w=new Window();try{
  const form=w.document.createElement('form');w.document.body.append(form);
  form.innerHTML=choicePanels([{name:'race',title:'Type',values:[['','All'],['Dragon','Dragon'],['Warrior','Warrior']]},{name:'sort',title:'Order',mode:'choice',value:'az',values:[['az','Name'],['atk','ATK']]}],'test');mountChoices(form);
  assert.equal(form.querySelectorAll('select').length,0);assert.equal(form.querySelectorAll('[data-allowed=true]').length,3);
  form.querySelector('[value=Dragon]').click();assert.equal(radioValue(form,'race'),'Dragon');assert.equal(new w.FormData(form).get('race'),'Dragon');
  assert.equal(form.querySelector('[value=Warrior]').closest('label').dataset.allowed,'false');assert.equal(form.querySelector('[value=Dragon]').closest('label').dataset.allowed,'true');
  form.querySelector('[role=tab]').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert.equal(form.querySelector('#test-pane-0').hidden,true);assert.equal(form.querySelector('#test-pane-1').hidden,false);assert.equal(w.document.activeElement.id,'test-tab-1');
 }finally{w.close();}
});
test('year boundaries are inclusive and independent permissions keep their check/X identity',()=>{
 const w=new Window();try{
  const form=w.document.createElement('form');w.document.body.append(form);form.innerHTML=radioGroup({name:'year',title:'Year',mode:'maximum',value:'2006',values:[['current','Today'],['2007','2007'],['2006','2006'],['2005','2005']]})+permissionGroup('spells','Spells',true)+permissionGroup('traps','Traps',false);mountChoices(form);
  assert.equal(form.querySelector('[value="2007"]').closest('label').dataset.allowed,'false');assert.equal(form.querySelector('[value="2006"]').closest('label').dataset.allowed,'true');assert.equal(form.querySelector('[value="2005"]').closest('label').dataset.allowed,'true');
  form.querySelector('[name=spells][value=block]').click();assert.equal(radioValue(form,'spells'),'block');assert.equal(radioValue(form,'traps'),'block');
  assert.equal(form.querySelector('[name=spells][value=block]').closest('label').querySelector('.choice-mark').textContent,'×');
 }finally{w.close();}
});
