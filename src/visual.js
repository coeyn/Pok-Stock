// Compare a scan to compact perceptual hashes of TCGdex card images.
// The user's image stays in this browser; only catalogue metadata is fetched.
const SIZE = 32;
const COS = Array.from({ length: 8 }, (_, u) => Array.from({ length: SIZE }, (_, x) => Math.cos((2 * x + 1) * u * Math.PI / (2 * SIZE))));
const ALPHA = Array.from({ length: 8 }, (_, u) => u === 0 ? Math.sqrt(1 / SIZE) : Math.sqrt(2 / SIZE));
let indexPromise;

function hashRegion(image, box) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, box[0] * image.width, box[1] * image.height, (box[2] - box[0]) * image.width, (box[3] - box[1]) * image.height, 0, 0, SIZE, SIZE);
  const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const gray = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4] * .299 + rgba[i * 4 + 1] * .587 + rgba[i * 4 + 2] * .114;
  const coefficients = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) {
        let row = 0;
        for (let x = 0; x < SIZE; x++) row += gray[y * SIZE + x] * COS[u][x];
        sum += row * COS[v][y];
      }
      coefficients.push(sum * ALPHA[u] * ALPHA[v]);
    }
  }
  const sorted = coefficients.slice(1).sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length / 2)];
  let bits = 0n;
  for (const coefficient of coefficients) bits = (bits << 1n) | (coefficient > threshold ? 1n : 0n);
  return bits;
}

function hamming(a, b) {
  let value = a ^ b, count = 0;
  while (value) { count++; value &= value - 1n; }
  return count;
}

async function getIndex() {
  indexPromise ||= fetch(`${import.meta.env.BASE_URL}card-features.json`).then(response => {
    if (!response.ok) throw new Error('Index visuel indisponible');
    return response.json();
  }).catch(error => { indexPromise = null; throw error; });
  return indexPromise;
}

export async function visualMatches(file, limit = 30) {
  const [index, image] = await Promise.all([getIndex(), createImageBitmap(file)]);
  try {
    const full = hashRegion(image, [0, 0, 1, 1]);
    const art = hashRegion(image, [.06, .17, .94, .65]);
    const ranked = [];
    for (const [id, fullHex, artHex] of index) {
      const fullDistance = hamming(full, BigInt(`0x${fullHex}`));
      const artDistance = hamming(art, BigInt(`0x${artHex}`));
      ranked.push({ id, distance: fullDistance + artDistance * .35, fullDistance, artDistance });
    }
    return ranked.sort((a, b) => a.distance - b.distance).slice(0, limit);
  } finally { image.close(); }
}
