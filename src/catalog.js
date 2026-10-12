import { cardmarketUrl } from './storage.js';

const BASE = 'https://api.tcgdex.net/v2/fr/cards';
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
    cardmarket_search: cardmarketUrl(card.name || '', card.localId || ''),
  };
}

export async function searchCards({ name = '', number = '', total = '' }) {
  name = name.trim(); number = number.trim();
  if (!name && !number) return [];
  const queries = [];
  if (name) queries.push(new URLSearchParams({ name }));
  if (number) {
    queries.push(new URLSearchParams({ localId: number }));
    if (/^\d+$/.test(number)) queries.push(new URLSearchParams({ localId: String(Number(number)).padStart(3, '0') }));
  }
  const responses = await Promise.all(queries.map(query => fetchJson(`${BASE}?${query}`)));
  const brief = new Map(responses.flatMap(rows => rows.slice(0, 250)).map(card => [card.id, card]));
  if (!brief.size && name.includes(' ')) {
    const rows = await fetchJson(`${BASE}?${new URLSearchParams({ name: name.split(' ')[0] })}`);
    rows.slice(0, 250).forEach(card => brief.set(card.id, card));
  }
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
  const top = [...brief.values()].sort((a, b) => score(b) - score(a)).slice(0, 12);
  const details = await Promise.all(top.map(card => fetchJson(`${BASE}/${encodeURIComponent(card.id)}`).catch(() => null)));
  return details.flatMap((card, index) => card ? [{ ...simplify(card), score: Math.round(score(top[index]) + (total && Number(total) === card.set?.cardCount?.official ? 35 : 0)) }] : []).sort((a, b) => b.score - a.score);
}
