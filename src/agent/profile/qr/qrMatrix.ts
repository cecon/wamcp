/** The module grid of one QR symbol: function patterns, data placement, masks and penalty. */
const bit = (value: number, i: number) => ((value >>> i) & 1) !== 0;

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

export class QrMatrix {
  readonly size: number;
  readonly modules: boolean[][];
  private readonly reserved: boolean[][];
  private readonly version: number;

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    const grid = () => Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.modules = grid();
    this.reserved = grid();
    this.drawFunctionPatterns();
  }

  private set(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.reserved[y][x] = true;
  }

  private drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(this.size - 4, 3);
    this.finder(3, this.size - 4);
    const positions = this.alignmentPositions();
    const last = positions.length - 1;
    positions.forEach((x, i) =>
      positions.forEach((y, j) => {
        const corner = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
        if (!corner) this.alignment(x, y);
      }),
    );
    this.drawFormat(0);
    this.drawVersion();
  }

  private finder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx,
          y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size)
          this.set(x, y, distance !== 2 && distance !== 4);
      }
  }

  private alignment(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  private alignmentPositions() {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    const step = this.version === 32 ? 26 : Math.ceil((this.version * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let position = this.size - 7; result.length < count; position -= step) result.splice(1, 0, position);
    return result;
  }

  /** Format information: error correction level M (bits 00) and the mask, BCH protected. */
  drawFormat(mask: number) {
    const data = mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(bits, i));
    this.set(8, 7, bit(bits, 6));
    this.set(8, 8, bit(bits, 7));
    this.set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, bit(bits, i));
    this.set(8, this.size - 8, true);
  }

  private drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3),
        b = Math.floor(i / 3);
      this.set(a, b, bit(bits, i));
      this.set(b, a, bit(bits, i));
    }
  }

  /** Places the codewords in the zigzag order, skipping the function patterns. */
  drawCodewords(data: number[]) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < this.size; vertical++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const y = ((right + 1) & 2) === 0 ? this.size - 1 - vertical : vertical;
          if (!this.reserved[y][x] && i < data.length * 8) {
            this.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
    }
  }

  /** XORs a mask over the data modules (applying it twice undoes it). */
  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++)
        if (!this.reserved[y][x] && MASKS[mask](x, y)) this.modules[y][x] = !this.modules[y][x];
  }
}
