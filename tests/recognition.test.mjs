import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, readNumber } from '../src/recognition.js';

test('ignore stage labels and OCR punctuation around card names', () => {
  assert.equal(cleanName('BASE\nFérosinge'), 'Férosinge');
  assert.equal(cleanName('NIVEAU 1\n“Théffroyable a»'), 'Théffroyable');
  assert.equal(cleanName('BASE\nLarvibule ~~'), 'Larvibule');
  assert.equal(cleanName('Pikachu Volant V 190 PV'), 'Pikachu Volant V');
});

test('read collector number and set size from focused scan text', () => {
  assert.deepEqual(readNumber('D) 042/084 ®'), { number: '042', total: '084' });
  assert.deepEqual(readNumber('Illus. mingo\n006/084 +'), { number: '006', total: '084' });
  assert.deepEqual(readNumber('002/084 ©'), { number: '002', total: '084' });
});
