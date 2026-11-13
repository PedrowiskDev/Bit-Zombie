/**
 * Gerador pseudoaleatório determinístico (Mulberry32) com suporte a seed.
 * Garante que a mesma seed gere exatamente a mesma sequência de números
 * em qualquer plataforma (Node.js ou navegador).
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
  }

  /** Retorna float determinístico no intervalo [0, 1) */
  nextFloat(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Retorna float determinístico no intervalo [min, max) */
  nextRange(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  /** Retorna inteiro determinístico no intervalo inclusivo [min, max] */
  nextInt(min: number, max: number): number {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    return Math.floor(this.nextFloat() * (high - low + 1)) + low;
  }

  /** Retorna o estado interno atual para inspeção/snapshot */
  getState(): number {
    return this.state >>> 0;
  }
}
