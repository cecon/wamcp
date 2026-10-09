import { QrMatrix } from './qrMatrix';
import { dataCodewords, withErrorCorrection } from './reedSolomon';

/*
 * Minimal QR Code encoder (byte mode, error correction level M, versions 1–40), enough to show
 * the authenticator `otpauth://` URI locally without any dependency or network request.
 */

function dataBytes(bytes: Uint8Array, version: number) {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const result: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    result.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  return result;
}

function smallestVersion(length: number) {
  for (let version = 1; version <= 40; version++)
    if (4 + (version < 10 ? 8 : 16) + length * 8 <= dataCodewords(version) * 8) return version;
  throw new Error('Texto longo demais para um QR Code');
}

const FINDER_LIKE = ['10111010000', '00001011101'];

/** ISO/IEC 18004 mask penalty: runs, 2×2 blocks, finder-like patterns and dark balance. */
export function penalty(modules: boolean[][]) {
  const size = modules.length;
  const columns = modules.map((_, x) => modules.map((row) => row[x]));
  let score = 0,
    dark = 0;
  for (const line of [...modules, ...columns]) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    const text = line.map((m) => (m ? '1' : '0')).join('');
    for (const pattern of FINDER_LIKE)
      for (let at = text.indexOf(pattern); at >= 0; at = text.indexOf(pattern, at + 1)) score += 40;
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) dark++;
      const color = modules[y][x];
      if (x < size - 1 && y < size - 1 && color === modules[y][x + 1] && color === modules[y + 1][x])
        if (color === modules[y + 1][x + 1]) score += 3;
    }
  const total = size * size;
  return score + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
}

/** Dark (true) / light modules of the QR Code for `text`; `mask` forces a mask pattern (0–7). */
export function encodeQr(text: string, mask?: number): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = smallestVersion(bytes.length);
  const matrix = new QrMatrix(version);
  matrix.drawCodewords(withErrorCorrection(dataBytes(bytes, version), version));
  let chosen = mask ?? 0;
  if (mask === undefined) {
    let best = Infinity;
    for (let candidate = 0; candidate < 8; candidate++) {
      matrix.applyMask(candidate);
      matrix.drawFormat(candidate);
      const score = penalty(matrix.modules);
      if (score < best) [best, chosen] = [score, candidate];
      matrix.applyMask(candidate);
    }
  }
  matrix.applyMask(chosen);
  matrix.drawFormat(chosen);
  return matrix.modules;
}
