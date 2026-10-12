import { PSM } from 'tesseract.js';

function cleanName(text) {
  const lines = text.split(/\r?\n/).map(line => line
    .replace(/^\s*(?:(?:NIVEAU|NIV\.?)[\s-]*\d+|BASE|DRESSEUR|TRAINER|OBJET|SUPPORTER|STADE|ÉNERGIE|ENERGIE)\s*[:·-]?\s*/i, '')
    .replace(/^\s*(?:(?:DRESSEUR|TRAINER|OBJET|SUPPORTER|STADE)\s*[:·-]?\s*)+/i, '')
    .replace(/\b(?:PV|HP|niv\.?|niveau)\s*\d{1,3}.*/gi, '')
    .replace(/\s+\d{2,3}\s*(?:PV|HP)?\b.*$/i, '')
    .replace(/[^\p{L}\p{N}'’\- ]/gu, ' ')
    .replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const noise = /^(?:base|basic|niveau|evolution|évolution|pokemon|pokémon|pv|hp|stage|illus|dresseur|trainer|objet|supporter|stade|énergie|energie)$/i;
  const useful = lines.filter(line => !noise.test(line) && /\p{L}{3}/u.test(line));
  if (!useful.length) return '';
  const first = useful[0].split(' ').filter(word => word.length > 1 || /^[VvXx]$/.test(word));
  return first.join(' ').slice(0, 50);
}

function readNumber(text) {
  const normalized = text.replace(/[Oo](?=\d)/g, '0').replace(/(?<=\d)[Oo]/g, '0');
  const matches = [...normalized.matchAll(/\b(\d{1,4})\s*[/\\]\s*(\d{2,4})\b/g)];
  const plausible = matches.filter(match => Number(match[1]) <= Number(match[2]) + 150 && Number(match[2]) <= 500);
  const match = plausible.at(-1);
  return { number: match?.[1] || '', total: match?.[2] || '' };
}

async function cropAndEnhance(image, [x0, y0, x1, y1], { gamma = .82 } = {}) {
  const w = Math.max(1, Math.round((x1 - x0) * image.width));
  const h = Math.max(1, Math.round((y1 - y0) * image.height));
  const scale = Math.min(4, 2100 / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, Math.round(x0 * image.width), Math.round(y0 * image.height), w, h, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = data.data;
  const histogram = new Uint32Array(256);
  const gray = new Uint8Array(pixels.length / 4);
  for (let i = 0; i < gray.length; i++) {
    const value = Math.round(pixels[i * 4] * .299 + pixels[i * 4 + 1] * .587 + pixels[i * 4 + 2] * .114);
    gray[i] = value; histogram[value]++;
  }
  const threshold = gray.length * .01;
  let low = 0, high = 255, count = 0;
  while (low < 255 && (count += histogram[low]) < threshold) low++;
  count = 0;
  while (high > 0 && (count += histogram[high]) < threshold) high--;
  const gain = 255 / Math.max(1, high - low);
  for (let i = 0; i < gray.length; i++) {
    const normalized = Math.max(0, Math.min(1, (gray[i] - low) * gain / 255));
    const value = Math.max(0, Math.min(255, Math.round(Math.pow(normalized, gamma) * 255)));
    pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = value;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export async function readScan(file, worker) {
  const image = await createImageBitmap(file);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const headerReads = [];
    const headerBoxes = [[.12, .008, .97, .12], [.10, .045, .98, .18]];
    for (let i = 0; i < headerBoxes.length; i++) {
      if (i === 1) await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const header = await cropAndEnhance(image, headerBoxes[i], { gamma: i === 0 ? .82 : .72 });
      const result = (await worker.recognize(header)).data;
      const candidate = cleanName(result.text);
      if (candidate) headerReads.push({ name: candidate, confidence: result.confidence || 0 });
      if (i === 0 && result.confidence >= 82 && candidate) break;
    }
    const name = headerReads.sort((a, b) => (b.confidence + Math.min(b.name.length, 24) * .25) - (a.confidence + Math.min(a.name.length, 24) * .25))[0]?.name || '';
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const numberCrop = await cropAndEnhance(image, [.08, .89, .48, .99], { gamma: .78 });
    let numbers = readNumber((await worker.recognize(numberCrop)).data.text);
    if (!numbers.number) {
      const bottom = await cropAndEnhance(image, [0, .76, 1, 1], { gamma: .72 });
      numbers = readNumber((await worker.recognize(bottom)).data.text);
    }
    return { name, ...numbers };
  } finally { image.close(); }
}

export { cleanName, readNumber };
