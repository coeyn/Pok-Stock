import { createWorker } from 'tesseract.js';
import { getCardmarketUrl, searchCards } from './catalog.js';
import { readScan } from './recognition.js';
import { addCard, deleteCard, exportBackup, exportCsv, importBackup, listCards, updateCard, validateCardmarketUrl } from './storage.js';
import { visualMatches } from './visual.js';
import './style.css';

const app = document.querySelector('#app');
const state = { queue: [], current: 0, candidates: [], selected: null, cards: [], worker: null, busy: false };

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
      <section id="scan-page" class="page">
        <div class="page-heading"><div><div class="eyebrow">ESPACE DE TRAVAIL</div><h1>Scanner vos cartes<span>.</span></h1><p>Importez vos photos, vérifiez la correspondance et ajoutez chaque carte à votre inventaire.</p></div><div class="heading-symbol">✳</div></div>
        <div class="step-strip"><div><i>01</i> Importer</div><span>→</span><div><i>02</i> Identifier</div><span>→</span><div><i>03</i> Enregistrer</div></div>
        <div id="dropzone" class="dropzone"><input id="file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden><div class="upload-icon">↥</div><h2>Déposez vos scans ici</h2><p>ou cliquez pour choisir plusieurs photos</p><div class="file-types">JPG, PNG, WEBP · 15 Mo max par image</div></div>
        <div id="scan-workspace" class="scan-workspace hidden">
          <div class="workspace-head"><div><div class="eyebrow">EN COURS D'IDENTIFICATION</div><h2 id="queue-title">Carte 1</h2></div><div class="queue-actions"><span id="queue-count"></span><button id="clear-queue" class="text-button">Vider la file</button></div></div>
          <div class="workspace-grid"><div class="scan-preview"><img id="scan-image" alt="Scan de la carte"><div class="scan-file" id="scan-file"></div><div class="queue-nav"><button id="prev-scan">← Précédente</button><button id="next-scan">Suivante →</button></div></div>
            <div class="recognition"><div id="ocr-status" class="status-line">Prêt à analyser</div><div class="recognition-fields"><label>Nom lu sur la carte<input id="search-name" placeholder="Ex. Pikachu"></label><label>Numéro de collection<input id="search-number" placeholder="Ex. 025"></label><label>Total de la série (facultatif)<input id="search-total" inputmode="numeric" placeholder="Ex. 102"></label></div><button id="find-card" class="primary-button">Rechercher la carte <span>↗</span></button><p class="hint">La reconnaissance suggère des résultats. Vérifiez l'extension, le numéro et la variante avant l'ajout.</p></div></div>
          <div id="results" class="results"></div>
          <div id="confirmation" class="confirmation hidden"></div>
        </div>
      </section>
      <section id="inventory-page" class="page hidden">
        <div class="page-heading"><div><div class="eyebrow">VOTRE COLLECTION</div><h1>Inventaire<span>.</span></h1><p>Retrouvez vos cartes, fixez votre prix et ouvrez leur page Cardmarket.</p></div><div class="heading-symbol">◈</div></div>
        <div class="stats"><div><small>CARTES EN STOCK</small><strong id="stat-count">0</strong></div><div><small>RÉFÉRENCES</small><strong id="stat-types">0</strong></div><div><small>VALEUR DEMANDÉE</small><strong id="stat-value">0 €</strong></div></div>
        <div class="inventory-toolbar"><input id="inventory-search" placeholder="Rechercher un nom, une série, un numéro…"><button id="export-csv" class="outline-button">↓ CSV</button><button id="export-backup" class="outline-button">↓ Sauvegarde</button><button id="import-backup" class="outline-button">↑ Restaurer</button><input id="backup-file" type="file" accept="application/json,.json" hidden></div>
        <div id="inventory-list" class="inventory-list"></div>
      </section>
    </main>
  </div>
  <dialog id="edit-dialog"><form method="dialog" id="edit-form"><div class="dialog-head"><div><div class="eyebrow">MODIFIER LA FICHE</div><h2 id="edit-title"></h2></div><button type="button" id="close-dialog" class="icon-button">×</button></div><div class="form-grid"><label>Prix de vente (€)<input name="price" type="number" min="0" step="0.01" placeholder="À définir"></label><label>Quantité<input name="quantity" type="number" min="1" step="1"></label><label>État<select name="condition"><option>MT</option><option>NM</option><option>EX</option><option>GD</option><option>LP</option><option>PO</option></select></label><label>Langue<select name="language"><option>FR</option><option>EN</option><option>DE</option><option>ES</option><option>IT</option><option>JP</option></select></label><label class="wide">Variante<input name="variant"></label><label class="wide">Notes<textarea name="notes" rows="3" placeholder="Défauts, localisation, détails utiles…"></textarea></label></div><div class="dialog-actions"><button type="button" id="delete-card" class="danger-button">Supprimer</button><button type="submit" class="primary-button">Enregistrer</button></div></form></dialog>`;

const $ = s => document.querySelector(s);
const showPage = page => { $('.nav.active')?.classList.remove('active'); $(`.nav[data-page="${page}"]`).classList.add('active'); $('#scan-page').classList.toggle('hidden',page!=='scan'); $('#inventory-page').classList.toggle('hidden',page!=='inventory'); $('#breadcrumb-current').textContent=page==='scan'?'Scanner':'Inventaire'; if(page==='inventory') loadCards(); };
document.querySelectorAll('.nav').forEach(btn => btn.onclick = () => showPage(btn.dataset.page));

const dropzone = $('#dropzone');
dropzone.onclick = () => $('#file-input').click();
dropzone.ondragover = e => {e.preventDefault(); dropzone.classList.add('dragging')};
dropzone.ondragleave = () => dropzone.classList.remove('dragging');
dropzone.ondrop = e => {e.preventDefault(); dropzone.classList.remove('dragging'); addFiles(e.dataTransfer.files)};
$('#file-input').onchange = e => {addFiles(e.target.files); e.target.value=''};

function addFiles(files) {
  const accepted = [...files].filter(f => ['image/jpeg','image/png','image/webp'].includes(f.type) && f.size <= 15_000_000);
  if(accepted.length < files.length) toast('Certains fichiers ont été ignorés (format ou taille).','error');
  const first = state.queue.length === 0;
  state.queue.push(...accepted.map(file => ({file, url:URL.createObjectURL(file), name:'', number:'', total:'', visual:[], analyzed:false})));
  if(accepted.length) {$('#scan-workspace').classList.remove('hidden'); if(first) state.current=0; renderQueue(); if(first) analyzeCurrent();}
}
function currentItem(){return state.queue[state.current]}
function saveInputs(){const item=currentItem(); if(!item)return; item.name=$('#search-name').value;item.number=$('#search-number').value;item.total=$('#search-total').value;}
function renderQueue(){
  const item=currentItem(); if(!item) {$('#scan-workspace').classList.add('hidden');return}
  $('#queue-title').textContent=`Carte ${state.current+1} sur ${state.queue.length}`;
  $('#queue-count').textContent=`${state.queue.length} photo${state.queue.length>1?'s':''} en attente`;
  $('#scan-image').src=item.url; $('#scan-file').textContent=item.file.name;
  $('#search-name').value=item.name; $('#search-number').value=item.number; $('#search-total').value=item.total;
  $('#ocr-status').textContent=item.analyzed?'Lecture terminée · vérifiez les champs':'Prêt à analyser';
  $('#prev-scan').disabled=state.current===0; $('#next-scan').disabled=state.current===state.queue.length-1;
  state.candidates=[];state.selected=null;$('#results').innerHTML='';$('#confirmation').classList.add('hidden');
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
  $('#find-card').disabled=true;$('#find-card').textContent='Recherche en cours…';
  try {state.candidates=await searchCards(item);renderCandidates();}
  catch(e){toast(e.message,'error')}
  finally{$('#find-card').disabled=false;$('#find-card').innerHTML='Rechercher la carte <span>↗</span>'}
}
$('#find-card').onclick=findCards;
function renderCandidates(){
  $('#confirmation').classList.add('hidden');state.selected=null;
  $('#results').innerHTML=`<div class="section-title"><div><div class="eyebrow">CATALOGUE TCGDEX</div><h3>Correspondances proposées</h3></div><span>${state.candidates.length} résultat${state.candidates.length>1?'s':''}</span></div>`+
    (state.candidates.length?`<div class="candidate-grid">${state.candidates.map((c,i)=>`<button class="candidate" data-index="${i}"><img src="${esc(c.image)}" alt="" loading="lazy"><div><strong>${esc(c.name)}</strong><small>${esc(c.set)}</small><span>N° ${esc(c.number)}${c.set_total?' / '+c.set_total:''}</span></div><b>Choisir →</b></button>`).join('')}</div>`:'<div class="empty-result">Aucune correspondance. Essayez avec le nom exact ou le numéro de la carte.</div>');
  document.querySelectorAll('.candidate').forEach(el=>el.onclick=()=>selectCandidate(Number(el.dataset.index)));
}
function selectCandidate(index){
  state.selected=state.candidates[index];const c=state.selected;
  document.querySelectorAll('.candidate').forEach((el,i)=>el.classList.toggle('chosen',i===index));
  $('#confirmation').classList.remove('hidden');
  $('#confirmation').innerHTML=`<div class="section-title"><div><div class="eyebrow">DERNIÈRE ÉTAPE</div><h3>Ajouter à l'inventaire</h3></div><span>${esc(c.name)} · ${esc(c.number)}</span></div><div class="form-grid"><label>Variante<select id="new-variant">${c.variants.map((v,i)=>`<option value="${i}">${esc(v.label)}${v.product_id?' · Cardmarket #'+v.product_id:''}</option>`).join('')}</select></label><label>Prix de vente (€)<input id="new-price" type="number" min="0" step="0.01" placeholder="À définir plus tard"></label><label>État<select id="new-condition"><option>NM</option><option>MT</option><option>EX</option><option>GD</option><option>LP</option><option>PL</option><option>PO</option></select></label><label>Langue<select id="new-language"><option>FR</option><option>EN</option><option>DE</option><option>ES</option><option>IT</option><option>JP</option></select></label><label>Quantité<input id="new-quantity" type="number" min="1" value="1"></label><label class="wide">Notes<input id="new-notes" placeholder="Facultatif"></label></div><div class="confirm-footer"><p><a id="new-cardmarket-link" class="cardmarket-button" target="_blank" rel="noopener noreferrer" aria-disabled="true">Chargement du lien Cardmarket…</a></p><button id="save-card" class="primary-button">Ajouter cette carte <span>↗</span></button></div>`;
  c.cardmarketPromise=getCardmarketUrl(c.id,c).then(url=>{c.cardmarket_url=url;if(state.selected===c){const link=$('#new-cardmarket-link');link.href=url;link.textContent='Voir sur Cardmarket ↗';link.removeAttribute('aria-disabled')}return url}).catch(error=>{if(state.selected===c){const link=$('#new-cardmarket-link');link.textContent='Lien Cardmarket indisponible';toast(error.message,'error')}return null});
  $('#save-card').onclick=saveCard;$('#confirmation').scrollIntoView({behavior:'smooth',block:'start'});
}
async function saveCard(){
  const c=state.selected,item=currentItem(),v=c.variants[Number($('#new-variant').value)];
  const price=$('#new-price').value;
  $('#save-card').disabled=true;
  const cardmarketUrl=await c.cardmarketPromise;
  const payload={tcgdex_id:c.id,name:c.name,set_name:c.set,number:c.number,image_url:c.image,variant:v.label,price:price===''?null:Number(price),quantity:Number($('#new-quantity').value),condition:$('#new-condition').value,language:$('#new-language').value,cardmarket_url:cardmarketUrl,notes:$('#new-notes').value};
  try{validateCardmarketUrl(payload.cardmarket_url);await addCard(payload,item.file);toast(`${c.name} ajouté à l'inventaire`);URL.revokeObjectURL(item.url);state.queue.splice(state.current,1);state.current=Math.min(state.current,state.queue.length-1);renderQueue();if(state.queue.length)analyzeCurrent();loadCards();}
  catch(e){toast(e.message,'error');$('#save-card').disabled=false}
}

async function loadCards(){
  try{state.cards=await listCards();renderInventory()}
  catch(e){toast(e.message,'error')}
}
function renderInventory(){
  const cards=state.cards;$('#nav-count').textContent=cards.reduce((s,c)=>s+c.quantity,0);$('#stat-count').textContent=cards.reduce((s,c)=>s+c.quantity,0);$('#stat-types').textContent=new Set(cards.map(c=>c.tcgdex_id)).size;$('#stat-value').textContent=euros(cards.reduce((s,c)=>s+(c.price||0)*c.quantity,0));
  const q=$('#inventory-search').value.toLocaleLowerCase();const visible=cards.filter(c=>`${c.name} ${c.set_name} ${c.number}`.toLocaleLowerCase().includes(q));
  document.querySelectorAll('[data-scan-url]').forEach(img=>URL.revokeObjectURL(img.dataset.scanUrl));
  $('#inventory-list').innerHTML=visible.length?visible.map(c=>`<article class="inventory-card"><img data-card-image="${c.id}" src="${esc(c.image_url)}" alt=""><div class="inventory-details"><strong>${esc(c.name)}</strong><small>${esc(c.set_name)} · N° ${esc(c.number)}</small><div class="tags"><span>${esc(c.variant||'Standard')}</span><span>${esc(c.condition)}</span><span>${esc(c.language)}</span><span>× ${c.quantity}</span></div></div><div class="inventory-price"><small>PRIX DE VENTE</small><strong>${euros(c.price)}</strong></div><div class="inventory-actions"><button data-cardmarket="${c.id}">Cardmarket ↗</button><button data-edit="${c.id}">Modifier</button></div></article>`).join(''):`<div class="empty-inventory"><div>◇</div><h3>${q?'Aucun résultat':'Votre inventaire attend ses premières cartes'}</h3><p>${q?'Essayez une autre recherche.':'Importez un scan pour commencer votre collection.'}</p><button id="go-scan" class="primary-button">Scanner une carte →</button></div>`;
  visible.forEach(c=>{if(c.scan){const img=document.querySelector(`[data-card-image="${c.id}"]`);const url=URL.createObjectURL(c.scan);img.src=url;img.dataset.scanUrl=url}});
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEdit(Number(b.dataset.edit)));
  document.querySelectorAll('[data-cardmarket]').forEach(b=>b.onclick=async()=>{const card=state.cards.find(c=>c.id===Number(b.dataset.cardmarket));const tab=window.open('', '_blank');if(!tab){toast('Autorisez les fenêtres pop-up pour ouvrir Cardmarket.','error');return}try{const url=card.cardmarket_url&&!card.cardmarket_url.includes('searchString=')?card.cardmarket_url:await getCardmarketUrl(card.tcgdex_id,card);validateCardmarketUrl(url);tab.location.href=url;if(url!==card.cardmarket_url){card.cardmarket_url=url;await updateCard(card.id,{cardmarket_url:url})}}catch(error){tab.close();toast(`Cardmarket : ${error.message}`,'error')}});
  $('#go-scan')?.addEventListener('click',()=>showPage('scan'));
}
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
