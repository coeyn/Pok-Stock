import { cardmarketUrl } from './storage.js';

const BASE = 'https://api.tcgdex.net/v2/fr/cards';
const EN_BASE = 'https://api.tcgdex.net/v2/en';
const SETS_BASE = 'https://api.tcgdex.net/v2/fr/sets';
const cardmarketLinks = new Map();
let setsPromise;
const norm = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = s => { const out = new Map(); for (let i = 0; i < s.length - 1; i++) { const key = s.slice(i, i + 2); out.set(key, (out.get(key) || 0) + 1); } return out; };
  const left = bigrams(a), right = bigrams(b);
  let matches = 0;
  for (const [key, count] of left) matches += Math.min(count, right.get(key) || 0);
  return 2 * matches / Math.max(1, a.length + b.length - 2);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Catalogue TCGdex indisponible (HTTP ${response.status}).`);
  return response.json();
}

function simplify(card) {
  let variants = (card.variants_detailed || []).map(v => ({
    label: [v.type, v.subtype, ...(v.stamp || [])].filter(Boolean).join(' · ') || 'Standard',
    product_id: v.thirdParty?.cardmarket || v.pricing?.cardmarket?.idProduct || null,
  }));
  if (!variants.length) variants = [{ label: 'Standard', product_id: card.thirdParty?.cardmarket || card.pricing?.cardmarket?.idProduct || null }];
  return {
    id: card.id, name: card.name || '', number: card.localId || '',
    set: card.set?.name || '', set_total: card.set?.cardCount?.official || null,
    image: card.image ? `${card.image}/high.webp` : '', variants,
  };
}

const slug = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

export function productUrl(card, set) {
  const code = set?.abbreviation?.official;
  if (!card?.name || !set?.name || !code || !card.localId) return null;
  return `https://www.cardmarket.com/fr/Pokemon/Products/Singles/${slug(set.name)}/${slug(card.name)}-${slug(code)}${slug(card.localId)}?language=2`;
}

export function productIdUrl(productId) {
  return productId ? `https://www.cardmarket.com/fr/Pokemon/Products?idProduct=${encodeURIComponent(productId)}&language=2` : null;
}

export function listSets() {
  if (!setsPromise) setsPromise = fetchJson(SETS_BASE).then(rows => rows.map(set => ({id:set.id,name:set.name||set.id,series:set.serie?.name||''})).sort((a,b)=>a.name.localeCompare(b.name,'fr'))).catch(error=>{setsPromise=null;throw error});
  return setsPromise;
}

export function getCardmarketUrl(id, fallback = {}) {
  if (!cardmarketLinks.has(id)) {
    const promise = (async () => {
      const card = await fetchJson(`${EN_BASE}/cards/${encodeURIComponent(id)}`);
      const set = await fetchJson(`${EN_BASE}/sets/${encodeURIComponent(card.set.id)}`).catch(() => null);
      const productId = card.thirdParty?.cardmarket || card.pricing?.cardmarket?.idProduct;
      if (productId) return productIdUrl(productId);
      return productUrl(card, set) || cardmarketUrl(fallback.name || card.name, fallback.number || card.localId);
    })().catch(error => { cardmarketLinks.delete(id); throw error; });
    cardmarketLinks.set(id, promise);
  }
  return cardmarketLinks.get(id);
}

export async function searchCards({ name = '', number = '', total = '', visual = [], setId = '' }) {
  name = name.trim(); number = number.trim();
  if (!name && !number && !visual.length) return [];
  const queries = [];
  if (name) queries.push(new URLSearchParams({ name }));
  if (number) {
    queries.push(new URLSearchParams({ localId: number }));
    if (/^\d+$/.test(number)) queries.push(new URLSearchParams({ localId: String(Number(number)).padStart(3, '0') }));
  }
  if (setId) queries.forEach(query => query.set('set.id', setId));
  const responses = await Promise.all(queries.map(query => fetchJson(`${BASE}?${query}`).catch(() => [])));
  const brief = new Map(responses.flatMap(rows => rows.slice(0, 250)).map(card => [card.id, card]));
  if (!brief.size && name.includes(' ')) {
    const query = new URLSearchParams({ name: name.split(' ')[0] });if(setId)query.set('set.id',setId);
    const rows = await fetchJson(`${BASE}?${query}`).catch(() => []);
    rows.slice(0, 250).forEach(card => brief.set(card.id, card));
  }
  const visualById = new Map(visual.map(match => [match.id, match]));
  const score = card => {
    let result = 0;
    if (name) {
      result += similarity(name, card.name) * 65;
      if (norm(name) === norm(card.name)) result += 22;
      else if (norm(card.name).includes(norm(name)) || norm(name).includes(norm(card.name))) result += 10;
    }
    if (number) {
      const a = number.toUpperCase().replace(/^0+/, ''), b = String(card.localId || '').toUpperCase().replace(/^0+/, '');
      if (a === b) result += 55;
      else if (a.includes(b) || b.includes(a)) result += 10;
    }
    return result;
  };
  const textTop = [...brief.values()].sort((a, b) => score(b) - score(a)).slice(0, visual.length ? 8 : 12);
  const ids = [...new Set([...visual.slice(0, 16).map(match => match.id), ...textTop.map(card => card.id)])];
  const details = await Promise.all(ids.map(id => fetchJson(`${BASE}/${encodeURIComponent(id)}`).catch(() => null)));
  const candidates = details.filter(Boolean).map(card => {
    const match = visualById.get(card.id);
    const visualScore = match ? Math.max(0, 145 - 3 * match.distance) : 0;
    const totalScore = total && Number(total) === card.set?.cardCount?.official ? 35 : 0;
    return { ...simplify(card), score: Math.round(score(card) + visualScore + totalScore), visual_distance: match?.distance ?? null };
  }).filter(card => !setId || card.set?.id === setId);
  if (!candidates.length) throw new Error(setId ? 'Aucune carte trouvée dans cette extension. Vérifiez le choix ou désactivez le filtre.' : 'Impossible de joindre le catalogue TCGdex.');
  return candidates.sort((a, b) => b.score - a.score).slice(0, 12);
}
