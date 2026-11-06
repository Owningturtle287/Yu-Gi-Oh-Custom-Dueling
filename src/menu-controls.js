/* Shared native-radio controls. Filter values and saved deck schemas stay unchanged. */
const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const choices=(values,all='All')=>[['',all],...values.map(value=>[value,value])];
export function radioGroup({name,title,values,value='',mode='filter',id=''}){
  return `<fieldset ${id?`id="${escape(id)}"`:''} class="choice-group" data-choice-mode="${mode}"><legend>${escape(title)}</legend><div class="radio-grid">${values.map(([key,label])=>`<label class="radio-card"><input type="radio" name="${escape(name)}" value="${escape(key)}" ${String(value)===String(key)?'checked':''}><span class="choice-mark" aria-hidden="true"></span><span class="choice-label">${escape(label)}</span><span class="choice-state sr-only"></span></label>`).join('')}</div></fieldset>`;
}
export const permissionGroup=(name,title,allowed)=>radioGroup({name,title,values:[['allow','Allowed'],['block','Blocked']],value:allowed?'allow':'block',mode:'permission'});
export function choicePanels(groups,prefix){
  return `<div class="choice-workspace"><div class="choice-nav" role="tablist" aria-label="Restriction groups" aria-orientation="vertical">${groups.map((group,i)=>`<button type="button" role="tab" id="${prefix}-tab-${i}" aria-controls="${prefix}-pane-${i}" aria-selected="${i===0}" tabindex="${i===0?0:-1}" data-choice-panel="${prefix}-pane-${i}">${escape(group.title)}</button>`).join('')}</div><div class="choice-panes">${groups.map((group,i)=>`<div class="choice-pane" id="${prefix}-pane-${i}" role="tabpanel" aria-labelledby="${prefix}-tab-${i}" ${i?'hidden':''}>${group.html||radioGroup(group)}</div>`).join('')}</div></div>`;
}
export const radioValue=(root,name)=>root.querySelector(`input[name="${name}"]:checked`)?.value??'';
export function paintChoices(root){
  root.querySelectorAll('.choice-group').forEach(group=>{
    const selected=group.querySelector('input:checked')?.value, mode=group.dataset.choiceMode;
    group.querySelectorAll('.radio-card').forEach(label=>{
      const input=label.querySelector('input'),key=input.value;
      let allowed=key===selected;
      if(mode==='filter')allowed=selected===''||selected==='All'||key===selected;
      if(mode==='maximum')allowed=selected==='current'||key!=='current'&&key<=selected;
      if(mode==='minimum')allowed=selected===''||key!==''&&key>=selected;
      if(mode==='permission')allowed=key==='allow';
      label.dataset.allowed=mode==='choice'?'neutral':String(allowed);
      label.querySelector('.choice-mark').textContent=mode==='choice'?(input.checked?'✓':'○'):(allowed?'✓':'×');
      label.querySelector('.choice-state').textContent=mode==='choice'?'':allowed?' — allowed':' — excluded';
    });
  });
}
export function mountChoices(root){
  const activate=button=>{
    const workspace=button.closest('.choice-workspace');
    workspace.querySelectorAll('[data-choice-panel]').forEach(tab=>{const active=tab===button;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
    workspace.querySelectorAll('.choice-pane').forEach(pane=>pane.hidden=pane.id!==button.dataset.choicePanel);
  };
  root.querySelectorAll('[data-choice-panel]').forEach(button=>{
    button.onclick=()=>activate(button);
    button.onkeydown=event=>{
      if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const tabs=[...button.closest('.choice-nav').querySelectorAll('button')],i=tabs.indexOf(button);
      const next=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1)+tabs.length)%tabs.length];
      activate(next);next.focus();
    };
  });
  root.addEventListener('change',()=>paintChoices(root));paintChoices(root);
}
