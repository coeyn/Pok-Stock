import { createWorker } from 'tesseract.js';
import { getCardmarketUrl, listSets, searchCards } from './catalog.js';
import { readScan } from './recognition.js';
import { addCard, deleteCard, exportBackup, exportCsv, importBackup, listCards, updateCard, updateCards, validateCardmarketUrl } from './storage.js';
import { visualMatches } from './visual.js';
import './style.css';
import './compact.css';

const app = document.querySelector('#app');
const state = { queue: [], current: 0, candidates: [], candidateIndex: 0, selected: null, selectedCards: new Set(), setFilter: null, scanSet: localStorage.getItem('scan-set') || '', scanSets: [], cards: [], worker: null, busy: false, saving: false };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const euros = n => n == null ? '—' : new Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR'}).format(n);
const toast = (message, kind='ok') => {
  const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = message;
  document.body.append(el); setTimeout(() => el.remove(), 4500);
};

app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">◈</span><div><strong>PokéStock</strong><small>Votre collection, prête à vendre</small></div></div>
      <nav><button class="nav active" data-page="scan"><span>▧</span> Scanner des cartes</button><button class="nav" data-page="inventory"><span>▤</span> Inventaire <b id="nav-count">0</b></button></nav>
      <div class="sidebar-bottom"><div class="sidebar-tip"><span>✦</span><strong>Conseil de scan</strong><p>Photographiez une carte à la fois, bien droite et avec un bon éclairage. Le numéro en bas doit être net.</p></div><div class="local-badge"><span></span> Données dans ce navigateur</div></div>
    </aside>
    <main class="main">
      <header class="topbar"><div class="breadcrumb">Collection <span>/</span> <strong id="breadcrumb-current">Scanner</strong></div><div class="top-right">Pokémon TCG <span class="dot"></span> FR</div></header>
      <section id="scan-page" class="page compact-page">
        <div class="page-heading compact-heading"><div><div class="eyebrow">SCAN RAPIDE</div><h1>Scanner vos cartes<span>.</span></h1></div><div class="heading-symbol">✳</div></div>
        <div class="scan-set-picker"><label for="scan-set">Extension des cartes</label><input id="scan-set" list="scan-set-options" autocomplete="off" placeholder="Toutes les extensions"><datalist id="scan-set-options"><option value="Toutes les extensions"></option></datalist><small id="scan-set-status">Tapez le nom et choisissez une extension proposée pour filtrer les résultats.</small></div>
        <div id="dropzone" class="dropzone compact-dropzone"><input id="file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden><div class="upload-icon">↥</div><div><h2>Ajouter des scans</h2><p>Déposez ou choisissez plusieurs photos · JPG, PNG, WEBP</p></div></div>
        <div id="scan-workspace" class="scan-workspace hidden">
          <div class="review-topbar"><span id="queue-title">1 / 1</span><span id="queue-count" class="visually-hidden"></span><button id="clear-queue" type="button" aria-label="Fermer le scanner">×</button></div>
          <div class="recognition"><div id="ocr-status" class="status-line">Lecture…</div><div class="recognition-fields"><label>Nom<input id="search-name" placeholder="Nom"></label><label>Numéro<input id="search-number" placeholder="N°"></label><label>Total<input id="search-total" inputmode="numeric" placeholder="Total"></label><button id="find-card" class="primary-button">Rechercher</button></div><details class="scan-price-control"><summary>€ Prix unitaire</summary><input id="scan-price" type="number" min="0" step="0.01" placeholder="À définir"></details></div>
          <div class="swipe-review"><div class="scan-preview"><button id="enlarge-scan" class="scan-thumb" type="button" aria-label="Agrandir le scan"><img id="scan-image" alt="Photo scannée de la carte"></button><div class="scan-file" id="scan-file"></div><div class="queue-nav"><button id="prev-scan" aria-label="Scan précédent">←</button><button id="next-scan" aria-label="Scan suivant">→</button></div></div><div id="results" class="results swipe-results"></div></div>
        </div>
      </section>
      <section id="inventory-page" class="page hidden">
        <div class="page-heading"><div><div class="eyebrow">VOTRE COLLECTION</div><h1>Inventaire<span>.</span></h1><p>Retrouvez vos cartes, fixez votre prix et ouvrez leur page Cardmarket.</p></div><div class="heading-symbol">◈</div></div>
        <div class="stats"><div><small>CARTES EN STOCK</small><strong id="stat-count">0</strong></div><div><small>RÉFÉRENCES</small><strong id="stat-types">0</strong></div><div><small>VALEUR DEMANDÉE</small><strong id="stat-value">0 €</strong></div></div>
        <section class="extension-overview" aria-label="Filtrer par extension"><div class="extension-heading"><div><h2>Extensions</h2><span id="extension-count"></span></div><small>Nombre de cartes · valeur des prix renseignés</small></div><div id="extension-list" class="extension-list"></div></section>
        <div class="inventory-toolbar"><input id="inventory-search" placeholder="Rechercher un nom, une série, un numéro…"><button id="export-csv" class="outline-button">↓ CSV</button><button id="export-backup" class="outline-button">↓ Sauvegarde</button><button id="import-backup" class="outline-button">↑ Restaurer</button><input id="backup-file" type="file" accept="application/json,.json" hidden></div>
        <div class="bulk-bar"><label class="select-visible"><input id="select-visible" type="checkbox"> Tout sélectionner</label><strong id="selection-count">0 sélectionnée</strong><div class="bulk-price"><label for="bulk-price">Prix commun</label><input id="bulk-price" type="number" min="0" step="0.01" placeholder="0,10"><span>€</span><button id="apply-bulk-price" class="primary-button" disabled>Appliquer</button></div><button id="clear-selection" class="text-button" disabled>Effacer la sélection</button></div>
        <div id="inventory-list" class="inventory-list"></div>
      </section>
    </main>
  </div>
  <dialog id="scan-image-dialog" class="scan-image-dialog"><button type="button" id="close-scan-image" aria-label="Fermer">×</button><img id="scan-image-full" alt="Scan agrandi de la carte"></dialog>
  <dialog id="edit-dialog"><form method="dialog" id="edit-form"><div class="dialog-head"><div><div class="eyebrow">MODIFIER LA FICHE</div><h2 id="edit-title"></h2></div><button type="button" id="close-dialog" class="icon-button">×</button></div><div class="form-grid"><label>Prix de vente (€)<input name="price" type="number" min="0" step="0.01" placeholder="À définir"></label><label>Quantité<input name="quantity" type="number" min="1" step="1"></label><label>État<select name="condition"><option>MT</option><option>NM</option><option>EX</option><option>GD</option><option>LP</option><option>PO</option></select></label><label>Langue<select name="language"><option>FR</option><option>EN</option><option>DE</option><option>ES</option><option>IT</option><option>JP</option></select></label><label class="wide">Variante<input name="variant"></label><label class="wide">Notes<textarea name="notes" rows="3" placeholder="Défauts, localisation, détails utiles…"></textarea></label></div><div class="dialog-actions"><button type="button" id="delete-card" class="danger-button">Supprimer</button><button type="submit" class="primary-button">Enregistrer</button></div></form></dialog>`;

const $ = s => document.querySelector(s);
const showPage = page => { $('.nav.active')?.classList.remove('active'); $(`.nav[data-page="${page}"]`).classList.add('active'); $('#scan-page').classList.toggle('hidden',page!=='scan'); $('#inventory-page').classList.toggle('hidden',page!=='inventory'); $('#breadcrumb-current').textContent=page==='scan'?'Scanner':'Inventaire'; if(page==='inventory') loadCards(); };
document.querySelectorAll('.nav').forEach(btn => btn.onclick = () => showPage(btn.dataset.page));

const dropzone = $('#dropzone');
dropzone.onclick = () => {if(ensureScanSetValid())$('#file-input').click()};
dropzone.ondragover = e => {e.preventDefault(); dropzone.classList.add('dragging')};
dropzone.ondragleave = () => dropzone.classList.remove('dragging');
dropzone.ondrop = e => {e.preventDefault(); dropzone.classList.remove('dragging'); addFiles(e.dataTransfer.files)};
$('#file-input').onchange = e => {addFiles(e.target.files); e.target.value=''};
$('#enlarge-scan').onclick=()=>{const item=currentItem();if(!item)return;$('#scan-image-full').src=item.url;$('#scan-image-dialog').showModal()};
$('#close-scan-image').onclick=()=>$('#scan-image-dialog').close();
$('#scan-image-dialog').onclick=e=>{if(e.target===$('#scan-image-dialog'))$('#scan-image-dialog').close()};

async function loadScanSets(){
  const input=$('#scan-set'),status=$('#scan-set-status');
  try{state.scanSets=await listSets();$('#scan-set-options').insertAdjacentHTML('beforeend',state.scanSets.map(set=>`<option value="${esc(set.name)}"></option>`).join(''));const selected=state.scanSets.find(set=>set.id===state.scanSet);input.value=selected?.name||'';if(!selected)state.scanSet='';status.textContent=selected?`Filtre actif : ${selected.name}`:`${state.scanSets.length} extensions disponibles · le choix reste mémorisé dans ce navigateur.`}
  catch{status.textContent='Extensions indisponibles · vous pouvez scanner sans filtre.'}
}
function normalizedSetName(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('fr')}
function syncScanSet(){
  const input=$('#scan-set'),typed=input.value.trim();
  if(!typed||normalizedSetName(typed)===normalizedSetName('Toutes les extensions')){const changed=Boolean(state.scanSet);state.scanSet='';localStorage.removeItem('scan-set');$('#scan-set-status').textContent=`${state.scanSets.length} extensions disponibles · aucune extension sélectionnée.`;if(changed&&currentItem()?.analyzed&&(currentItem().name||currentItem().number||currentItem().visual.length))findCards();return true}
  const matches=state.scanSets.filter(set=>normalizedSetName(set.name)===normalizedSetName(typed));
  if(matches.length!==1){$('#scan-set-status').textContent='Choisissez une extension dans les suggestions pour valider le filtre.';return false}
  const changed=state.scanSet!==matches[0].id;state.scanSet=matches[0].id;localStorage.setItem('scan-set',state.scanSet);$('#scan-set-status').textContent=`Filtre actif : ${matches[0].name}`;
  if(changed&&currentItem()?.analyzed&&(currentItem().name||currentItem().number||currentItem().visual.length))findCards();
  return true;
}
$('#scan-set').oninput=syncScanSet;
$('#scan-set').onchange=syncScanSet;
function ensureScanSetValid(){if(syncScanSet())return true;toast('Choisissez une extension dans les suggestions avant d’ajouter les photos.','error');$('#scan-set').focus();return false}

function addFiles(files) {
  if(!ensureScanSetValid())return;
  const accepted = [...files].filter(f => ['image/jpeg','image/png','image/webp'].includes(f.type) && f.size <= 15_000_000);
  if(accepted.length < files.length) toast('Certains fichiers ont été ignorés (format ou taille).','error');
  const first = state.queue.length === 0;
  state.queue.push(...accepted.map(file => ({file, url:URL.createObjectURL(file), name:'', number:'', total:'', price:'', visual:[], analyzed:false})));
  if(accepted.length) {$('#scan-workspace').classList.remove('hidden'); if(first) state.current=0; renderQueue(); if(first) analyzeCurrent();}
}
function currentItem(){return state.queue[state.current]}
function saveInputs(){const item=currentItem(); if(!item)return; item.name=$('#search-name').value;item.number=$('#search-number').value;item.total=$('#search-total').value;item.price=$('#scan-price').value;}
function renderQueue(){
  const item=currentItem(); if(!item) {$('#scan-workspace').classList.add('hidden');$('#scan-page').classList.remove('reviewing');document.body.classList.remove('scan-reviewing');return}
  $('#scan-page').classList.add('reviewing');document.body.classList.add('scan-reviewing');
  $('#queue-title').textContent=`${state.current+1} / ${state.queue.length}`;
  $('#queue-count').textContent=`${state.queue.length} photo${state.queue.length>1?'s':''} en attente`;
  $('#scan-image').src=item.url; $('#scan-file').textContent=item.file.name;
  $('#search-name').value=item.name; $('#search-number').value=item.number; $('#search-total').value=item.total;$('#scan-price').value=item.price||'';
  $('#ocr-status').textContent=item.analyzed?'Lecture terminée · vérifiez les champs':'Prêt à analyser';
  $('#prev-scan').disabled=state.current===0; $('#next-scan').disabled=state.current===state.queue.length-1;
  state.candidates=[];state.candidateIndex=0;state.selected=null;$('#results').innerHTML='';
}
$('#prev-scan').onclick=()=>{saveInputs();state.current--;renderQueue();if(currentItem().analyzed)findCards();else analyzeCurrent()};
$('#next-scan').onclick=()=>{saveInputs();state.current++;renderQueue();if(currentItem().analyzed)findCards();else analyzeCurrent()};
$('#clear-queue').onclick=()=>{state.queue.forEach(x=>URL.revokeObjectURL(x.url));state.queue=[];renderQueue()};

async function analyzeCurrent(){
  const item=currentItem();if(!item||item.analyzed||state.busy)return;
  state.busy=true;$('#ocr-status').textContent='Lecture du nom, du numéro et comparaison visuelle…';
  try{
    const visualPromise=visualMatches(item.file).catch(() => []);
    let parsed={};
    try {if(!state.worker) state.worker=await createWorker(['fra','eng']); parsed=await readScan(item.file,state.worker)}
    catch(error) {toast(`Lecture du texte : ${error.message}`,'error')}
    Object.assign(item,parsed,{visual:await visualPromise,analyzed:true});
    if(currentItem()===item){renderQueue();if(item.name||item.number||item.visual.length) await findCards();else $('#ocr-status').textContent='Lecture incertaine · saisissez le nom ou le numéro';}
  }catch(e){if(currentItem()===item)$('#ocr-status').textContent='Lecture impossible · saisissez le nom ou le numéro';toast(`Reconnaissance : ${e.message}`,'error')}
  finally{state.busy=false;if(currentItem()&&!currentItem().analyzed)analyzeCurrent()}
}
async function findCards(){
  saveInputs();const item=currentItem();if(!item)return;
  if(!item.name&&!item.number&&!item.visual.length){toast('Saisissez un nom ou un numéro.','error');return}
  $('#find-card').disabled=true;$('#find-card').textContent='Recherche…';
  try {state.candidates=await searchCards({...item,setId:state.scanSet});state.candidateIndex=0;renderCandidates();}
  catch(e){toast(e.message,'error')}
  finally{$('#find-card').disabled=false;$('#find-card').textContent='Rechercher'}
}
$('#find-card').onclick=findCards;
function renderCandidates(){
  state.selected=null;
  const shown=state.candidates.slice(0,3);
  const card=shown[state.candidateIndex];
  $('#results').innerHTML=shown.length&&card?`<div class="swipe-deck"><article class="swipe-card" id="swipe-card" aria-label="${esc(card.name)}, ${esc(card.set)} numéro ${esc(card.number)}"><div class="swipe-photo"><img src="${esc(card.image)}" alt="${esc(card.name)}, ${esc(card.set)}, numéro ${esc(card.number)}" draggable="false"></div><div class="swipe-card-info"><small>CARTE ${state.candidateIndex+1} / ${shown.length}</small><strong>${esc(card.name)}</strong><span>${esc(card.set)} · N° ${esc(card.number)}${card.set_total?' / '+card.set_total:''}</span></div><div class="swipe-stamp swipe-no-stamp">×</div><div class="swipe-stamp swipe-yes-stamp">✓</div></article><div class="swipe-actions"><button id="reject-candidate" class="swipe-no-button" type="button" aria-label="Passer cette proposition">×</button><button id="accept-candidate" class="swipe-yes-button" type="button" aria-label="Choisir cette carte">✓</button></div></div>`:shown.length?'<div class="swipe-finished">Plus de proposition. Corrige nom ou numéro pour relancer.</div>':'<div class="swipe-finished">Aucune carte trouvée. Corrige nom ou numéro pour relancer.</div>';
  $('#reject-candidate')?.addEventListener('click',rejectCandidate);
  $('#accept-candidate')?.addEventListener('click',acceptCandidate);
  const swipeCard=$('#swipe-card');
  if(swipeCard){let startX=null,deltaX=0;swipeCard.onpointerdown=event=>{startX=event.clientX;deltaX=0;swipeCard.setPointerCapture(event.pointerId);swipeCard.classList.add('dragging')};swipeCard.onpointermove=event=>{if(startX===null)return;deltaX=event.clientX-startX;swipeCard.style.transform=`translateX(${deltaX}px) rotate(${deltaX*.035}deg)`;swipeCard.classList.toggle('drag-left',deltaX< -24);swipeCard.classList.toggle('drag-right',deltaX>24)};const resetSwipe=()=>{startX=null;deltaX=0;swipeCard.style.transform='';swipeCard.classList.remove('dragging','drag-left','drag-right')};swipeCard.onpointerup=()=>{if(startX===null)return;const distance=deltaX;resetSwipe();if(distance>85)acceptCandidate();else if(distance< -85)rejectCandidate()};swipeCard.onpointercancel=resetSwipe}
}
function rejectCandidate(){if(state.saving||state.candidateIndex>=Math.min(state.candidates.length,3))return;state.candidateIndex++;renderCandidates()}
function acceptCandidate(){
  if(state.saving)return;
  const card=state.candidates[state.candidateIndex];if(!card)return;
  state.selected=card;
  card.cardmarketPromise=getCardmarketUrl(card.id,card).then(url=>{card.cardmarket_url=url;return url}).catch(()=>null);
  saveCard();
}
async function saveCard(){
  const c=state.selected,item=currentItem(),v=c.variants?.[0]||{label:'Standard'};
  const priceInput=$('#scan-price').value;
  if(priceInput!==''&&(!Number.isFinite(Number(priceInput))||Number(priceInput)<0)){toast('Saisissez un prix unitaire valide.','error');$('#scan-price').focus();return}
  state.saving=true;document.querySelectorAll('#accept-candidate,#reject-candidate').forEach(button=>button.disabled=true);
  try{const cardmarketUrl=await c.cardmarketPromise;const payload={tcgdex_id:c.id,name:c.name,set_name:c.set,number:c.number,image_url:c.image,variant:v.label,price:priceInput===''?null:Number(priceInput),quantity:1,condition:'NM',language:'FR',cardmarket_url:cardmarketUrl,notes:''};validateCardmarketUrl(payload.cardmarket_url);const result=await addCard(payload,item.file);toast(result.merged?`${c.name} regroupé · quantité totale : ${result.quantity}`:`${c.name} ajouté à l'inventaire`);URL.revokeObjectURL(item.url);state.queue.splice(state.current,1);state.current=Math.min(state.current,state.queue.length-1);state.saving=false;renderQueue();if(state.queue.length)analyzeCurrent();loadCards();}
  catch(e){toast(e.message,'error');state.saving=false;renderCandidates()}
}

async function loadCards(){
  try{state.cards=await listCards();const ids=new Set(state.cards.map(c=>c.id));state.selectedCards=new Set([...state.selectedCards].filter(id=>ids.has(id)));renderInventory()}
  catch(e){toast(e.message,'error')}
}
function renderInventory(){
  const cards=state.cards;$('#nav-count').textContent=cards.reduce((s,c)=>s+c.quantity,0);$('#stat-count').textContent=cards.reduce((s,c)=>s+c.quantity,0);$('#stat-types').textContent=new Set(cards.map(c=>c.tcgdex_id)).size;$('#stat-value').textContent=euros(cards.reduce((s,c)=>s+(c.price||0)*c.quantity,0));
  const q=$('#inventory-search').value.toLocaleLowerCase();renderExtensionOverview();const visible=visibleInventoryCards();
  $('#inventory-list').innerHTML=visible.length?visible.map(c=>`<article class="inventory-card${state.selectedCards.has(c.id)?' selected':''}"><label class="card-selector" title="Sélectionner ${esc(c.name)}"><input type="checkbox" data-select-card="${c.id}" ${state.selectedCards.has(c.id)?'checked':''}><span></span></label><img data-card-image="${c.id}" src="${esc(c.image_url)}" alt=""><div class="inventory-details"><strong>${esc(c.name)}</strong><small>${esc(c.set_name)} · N° ${esc(c.number)}</small><div class="tags"><span>${esc(c.variant||'Standard')}</span><span>${esc(c.condition)}</span><span>${esc(c.language)}</span><span>× ${c.quantity}</span></div></div><div class="inventory-price"><small>PRIX DE VENTE</small><strong>${euros(c.price)}</strong></div><div class="inventory-actions"><button data-cardmarket="${c.id}">Cardmarket ↗</button><button data-edit="${c.id}">Modifier</button></div></article>`).join(''):`<div class="empty-inventory"><div>◇</div><h3>${q||state.setFilter?'Aucun résultat':'Votre inventaire attend ses premières cartes'}</h3><p>${q||state.setFilter?'Essayez une autre recherche ou choisissez une autre extension.':'Importez un scan pour commencer votre collection.'}</p><button id="go-scan" class="primary-button">Scanner une carte →</button></div>`;
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEdit(Number(b.dataset.edit)));
  document.querySelectorAll('[data-select-card]').forEach(input=>input.onchange=()=>{const id=Number(input.dataset.selectCard);input.checked?state.selectedCards.add(id):state.selectedCards.delete(id);input.closest('.inventory-card').classList.toggle('selected',input.checked);updateBulkControls(visible)});
  document.querySelectorAll('[data-cardmarket]').forEach(b=>b.onclick=async()=>{const card=state.cards.find(c=>c.id===Number(b.dataset.cardmarket));const tab=window.open('', '_blank');if(!tab){toast('Autorisez les fenêtres pop-up pour ouvrir Cardmarket.','error');return}try{const url=await getCardmarketUrl(card.tcgdex_id,card);validateCardmarketUrl(url);tab.location.href=url;if(url!==card.cardmarket_url){card.cardmarket_url=url;await updateCard(card.id,{cardmarket_url:url})}}catch(error){tab.close();toast(`Cardmarket : ${error.message}`,'error')}});
  $('#go-scan')?.addEventListener('click',()=>showPage('scan'));
  updateBulkControls(visible);
}
function renderExtensionOverview(){
  const groups=new Map();
  for(const card of state.cards){const name=card.set_name||'Sans extension';if(!groups.has(name))groups.set(name,{name,count:0,value:0,unpriced:0});const group=groups.get(name);group.count+=Number(card.quantity)||0;if(card.price==null)group.unpriced+=Number(card.quantity)||0;else group.value+=Number(card.price)*(Number(card.quantity)||0)}
  const total={count:0,value:0,unpriced:0};for(const group of groups.values()){total.count+=group.count;total.value+=group.value;total.unpriced+=group.unpriced}
  $('#extension-count').textContent=`${groups.size} extension${groups.size===1?'':'s'}`;
  const row=(name,group,all=false)=>`<button class="extension-option${(all?state.setFilter===null:state.setFilter===name)?' active':''}" data-extension="${all?'*':esc(name)}" aria-pressed="${all?state.setFilter===null:state.setFilter===name}"><span class="extension-option-name">${esc(name)}</span><span class="extension-option-meta">${group.count} carte${group.count===1?'':'s'}${group.unpriced?` · ${group.unpriced} sans prix`:''}</span><strong>${euros(group.value)}</strong></button>`;
  $('#extension-list').innerHTML=row('Toutes les extensions',total,true)+[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'fr')).map(group=>row(group.name,group)).join('');
  document.querySelectorAll('[data-extension]').forEach(button=>button.onclick=()=>{const next=button.dataset.extension==='*'?null:button.dataset.extension;if(next!==state.setFilter){state.setFilter=next;state.selectedCards.clear()}renderInventory()});
}
function visibleInventoryCards(){const q=$('#inventory-search').value.toLocaleLowerCase();const cards=state.cards.filter(c=>(state.setFilter===null||(c.set_name||'Sans extension')===state.setFilter)&&`${c.name} ${c.set_name} ${c.number}`.toLocaleLowerCase().includes(q));if(state.setFilter!==null)cards.sort((a,b)=>String(a.number||'').localeCompare(String(b.number||''),'fr',{numeric:true,sensitivity:'base'})||a.name.localeCompare(b.name,'fr'));return cards}
function updateBulkControls(visible=visibleInventoryCards()){
  const count=state.selectedCards.size,selectedVisible=visible.filter(c=>state.selectedCards.has(c.id)).length;
  $('#selection-count').textContent=`${count} sélectionnée${count>1?'s':''}`;
  $('#select-visible').checked=visible.length>0&&selectedVisible===visible.length;
  $('#select-visible').indeterminate=selectedVisible>0&&selectedVisible<visible.length;
  $('#apply-bulk-price').disabled=count===0;
  $('#clear-selection').disabled=count===0;
}
$('#select-visible').onchange=e=>{const visible=visibleInventoryCards();visible.forEach(c=>e.target.checked?state.selectedCards.add(c.id):state.selectedCards.delete(c.id));renderInventory()};
$('#clear-selection').onclick=()=>{state.selectedCards.clear();renderInventory()};
$('#apply-bulk-price').onclick=async()=>{
  const input=$('#bulk-price'),price=Number(input.value);
  if(input.value===''||!Number.isFinite(price)||price<0){toast('Saisissez un prix valide.','error');input.focus();return}
  const ids=[...state.selectedCards];$('#apply-bulk-price').disabled=true;
  try{await updateCards(ids,{price});toast(`Prix de ${euros(price)} appliqué à ${ids.length} carte${ids.length>1?'s':''}`);state.selectedCards.clear();input.value='';await loadCards()}
  catch(error){toast(error.message,'error');updateBulkControls()}
};
$('#inventory-search').oninput=renderInventory;
let editingId=null;
function openEdit(id){const c=state.cards.find(c=>c.id===id);editingId=id;$('#edit-title').textContent=`${c.name} · ${c.number}`;const f=$('#edit-form');for(const k of ['quantity','condition','language','variant','notes'])f.elements[k].value=c[k]??'';f.elements.price.value=c.price??'';$('#edit-dialog').showModal()}
$('#close-dialog').onclick=()=>$('#edit-dialog').close();
$('#edit-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;const data=Object.fromEntries(new FormData(f));data.quantity=Number(data.quantity);data.price=data.price===''?null:Number(data.price);try{await updateCard(editingId,data);$('#edit-dialog').close();toast('Fiche mise à jour');loadCards()}catch(err){toast(err.message,'error')}};
$('#delete-card').onclick=async()=>{if(!confirm('Supprimer cette carte et son scan de l’inventaire ?'))return;try{await deleteCard(editingId);$('#edit-dialog').close();toast('Carte supprimée');loadCards()}catch(e){toast(e.message,'error')}};
$('#export-csv').onclick=()=>exportCsv().catch(e=>toast(e.message,'error'));
$('#export-backup').onclick=()=>exportBackup().catch(e=>toast(e.message,'error'));
$('#import-backup').onclick=()=>$('#backup-file').click();
$('#backup-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(!confirm('Restaurer cette sauvegarde ? Les cartes seront ajoutées à cet inventaire.'))return;try{const count=await importBackup(file);toast(`${count} carte${count>1?'s':''} restaurée${count>1?'s':''}`);loadCards()}catch(err){toast(err.message,'error')}finally{e.target.value=''}};
loadCards();
loadScanSets();
