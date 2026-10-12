const DB_NAME = 'pokestock-v1';
const STORE = 'cards';

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function operation(mode, callback) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result;
    try { result = callback(store); } catch (error) { db.close(); reject(error); return; }
    transaction.oncomplete = () => { db.close(); resolve(result?.result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

export async function listCards() {
  const cards = await operation('readonly', store => store.getAll());
  return cards.sort((a, b) => b.id - a.id);
}

export async function addCard(card, scan) {
  return operation('readwrite', store => store.add({ ...card, scan, created_at: new Date().toISOString() }));
}

export async function updateCard(id, changes) {
  const existing = await operation('readonly', store => store.get(id));
  if (!existing) throw new Error('Carte introuvable.');
  return operation('readwrite', store => store.put({ ...existing, ...changes, id }));
}

export async function deleteCard(id) {
  return operation('readwrite', store => store.delete(id));
}

export function cardmarketUrl(name, number) {
  return `https://www.cardmarket.com/fr/Pokemon/Products/Singles?searchString=${encodeURIComponent(`${name} ${number}`)}`;
}

export function validateCardmarketUrl(url) {
  if (url && !/^https:\/\/(?:www\.)?cardmarket\.com\//i.test(url)) throw new Error('Saisissez un lien Cardmarket HTTPS.');
  return url;
}

export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exportCsv() {
  const fields = ['id','name','set_name','number','variant','condition','language','quantity','price','cardmarket_url','notes','tcgdex_id'];
  const quote = value => `"${String(value ?? '').replaceAll('"','""')}"`;
  const rows = await listCards();
  const csv = [fields.join(';'), ...rows.map(row => fields.map(field => quote(row[field])).join(';'))].join('\r\n');
  downloadFile('pokestock.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
}

export async function exportBackup() {
  const cards = await listCards();
  const serializable = await Promise.all(cards.map(async ({ id, scan, ...card }) => ({ ...card, scanData: scan ? await blobToDataUrl(scan) : null })));
  downloadFile('pokestock-sauvegarde.json', JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), cards: serializable }, null, 2), 'application/json');
}

export async function importBackup(file) {
  const backup = JSON.parse(await file.text());
  if (backup.version !== 1 || !Array.isArray(backup.cards)) throw new Error('Sauvegarde PokéStock invalide.');
  let count = 0;
  for (const row of backup.cards) {
    if (!row.name || !row.tcgdex_id || !row.number) continue;
    const { scanData, ...card } = row;
    let scan = null;
    if (scanData) scan = await (await fetch(scanData)).blob();
    await addCard({ ...card, quantity: Math.max(1, Number(card.quantity) || 1), price: card.price == null ? null : Number(card.price) }, scan);
    count++;
  }
  return count;
}
