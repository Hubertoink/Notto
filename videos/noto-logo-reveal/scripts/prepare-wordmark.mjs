import opentype from 'opentype.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Outline the same Arial Bold face used by Noto's Arial / weight 900 wordmark.
// The generated deliverable contains only these four logo outlines, no font file.
const bytes = await readFile(process.argv[2] || 'C:/Windows/Fonts/arialbd.ttf');
const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const glyphs = [...'NOTO'].map((letter) => font.charToGlyph(letter));
const units = font.unitsPerEm;
const capUnits = Math.max(...glyphs.map((g) => g.getBoundingBox().y2));
const size = 145 * units / capUnits;
const baseline = 145;
let x = 0;
const letters = glyphs.map((glyph, index) => {
  const path = glyph.getPath(x, baseline, size);
  const result = { letter: 'NOTO'[index], id: `letter-${index}`, d: path.toPathData(3) };
  x += glyph.advanceWidth * size / units;
  if (index < glyphs.length - 1) x += font.getKerningValue(glyph, glyphs[index + 1]) * size / units - size * (1.2 / 29);
  return result;
});
const payload = { source: 'Noto application Arial Bold wordmark, converted to vector outlines', capHeight: 145, width: x, letters };
await mkdir('assets', { recursive: true });
await writeFile('assets/wordmark-paths.json', JSON.stringify(payload, null, 2) + '\n');
await writeFile('assets/noto-wordmark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -4 ${Math.ceil(x)} 153" fill="#f1eee5">${letters.map(({d}) => `<path d="${d}"/>`).join('')}</svg>\n`);
console.log(JSON.stringify({ width: x, capHeight: 145, glyphs: letters.length }));
