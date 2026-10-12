import { PSM } from 'tesseract.js';

function cleanName(text) {
  const lines = text.split(/\r?\n/).map(line => line
    .replace(/\b(?:PV|HP|niv\.?|niveau)\s*\d{1,3}.*/gi, '')
    .replace(/\s+\d{2,3}\s*(?:PV|HP)?\b.*$/i, '')
    .replace(/[^\p{L}\p{N}'’\- ]/gu, ' ')
    .replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const noise = /^(?:base|basic|niveau|evolution|évolution|pokemon|pokémon|pv|hp|stage|illus)$/i;
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

async function cropAndEnhance(image, [x0, y0, x1, y1]) {
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
    const value = Math.max(0, Math.min(255, Math.round((gray[i] - low) * gain)));
    pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = value;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export async function readScan(file, worker) {
  const image = await createImageBitmap(file);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const header = await cropAndEnhance(image, [.17, .005, .78, .09]);
    let name = cleanName((await worker.recognize(header)).data.text);
    if (!name) {
      const wider = await cropAndEnhance(image, [.10, .005, .88, .16]);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      name = cleanName((await worker.recognize(wider)).data.text);
    }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const numberCrop = await cropAndEnhance(image, [.10, .89, .46, .99]);
    let numbers = readNumber((await worker.recognize(numberCrop)).data.text);
    if (!numbers.number) {
      const bottom = await cropAndEnhance(image, [0, .76, 1, 1]);
      numbers = readNumber((await worker.recognize(bottom)).data.text);
    }
    return { name, ...numbers };
  } finally { image.close(); }
}

export { cleanName, readNumber };
