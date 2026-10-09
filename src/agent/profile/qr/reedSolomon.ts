/*
 * Reed-Solomon error correction over GF(2^8) with the QR polynomial 0x11D, plus the per-version
 * capacity tables for error correction level M (ISO/IEC 18004, as tabulated by Project Nayuki).
 */

/** Product of two field elements. */
export function multiply(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** Coefficients of the generator polynomial of the given degree (highest term omitted). */
export function divisor(degree: number) {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = multiply(root, 0x02);
  }
  return result;
}

/** Error correction codewords of `data` for the generator `div`. */
export function remainder(data: number[], div: number[]) {
  const result = div.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    div.forEach((coefficient, i) => (result[i] ^= multiply(coefficient, factor)));
  }
  return result;
}

// prettier-ignore
const ECC_PER_BLOCK = [-1,
  10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
  26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
// prettier-ignore
const BLOCKS = [-1,
  1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
  17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

/** Modules available for data and error correction (everything but the function patterns). */
export function rawModules(version: number) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    result -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

export const dataCodewords = (version: number) =>
  Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];

/** Splits the data in blocks, appends each block's error correction and interleaves them. */
export function withErrorCorrection(data: number[], version: number) {
  const blocks = BLOCKS[version],
    ecc = ECC_PER_BLOCK[version];
  const raw = Math.floor(rawModules(version) / 8);
  const short = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const generator = divisor(ecc);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const block = data.slice(k, k + shortLength - ecc + (i < short ? 0 : 1));
    k += block.length;
    const correction = remainder(block, generator);
    if (i < short) block.push(0);
    all.push([...block, ...correction]);
  }
  const result: number[] = [];
  for (let i = 0; i < all[0].length; i++)
    all.forEach((block, j) => {
      if (i !== shortLength - ecc || j >= short) result.push(block[i]);
    });
  return result;
}
