import test from 'node:test';
import assert from 'node:assert/strict';
import { productIdUrl, productUrl } from '../src/catalog.js';

test('build a French Cardmarket product link from the English card and official set code', () => {
  const set = { name: 'Pitch Black', abbreviation: { official: 'PBL' } };
  assert.equal(
    productUrl({ name: 'Cranidos', localId: '044' }, set),
    'https://www.cardmarket.com/fr/Pokemon/Products/Singles/Pitch-Black/Cranidos-PBL044?language=2',
  );
  assert.equal(
    productUrl({ name: 'Mankey', localId: '042' }, set),
    'https://www.cardmarket.com/fr/Pokemon/Products/Singles/Pitch-Black/Mankey-PBL042?language=2',
  );
});

test('link directly to the Cardmarket product id when the display slug would be ambiguous', () => {
  assert.equal(
    productIdUrl(278744),
    'https://www.cardmarket.com/fr/Pokemon/Products?idProduct=278744&language=2',
  );
});
