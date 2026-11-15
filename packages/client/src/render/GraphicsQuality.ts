export type QualityMode = 'auto' | 'standard' | 'economy';

const PROFILES = [
  { name: 'Padrão', dprCap: 1.5, scale: 1, zombieRigs: 24, animationHz: 30 },
  { name: 'Equilibrado', dprCap: 1.25, scale: 0.85, zombieRigs: 16, animationHz: 24 },
  { name: 'Economia', dprCap: 1, scale: 0.7, zombieRigs: 8, animationHz: 15 },
] as const;
export type GraphicsProfile = typeof PROFILES[number];

export class GraphicsQuality {
  mode: QualityMode = 'auto';
  private level = 0;
  private samples: number[] = [];
  private elapsed = 0;
  private slowWindows = 0;
  private fastWindows = 0;

  get profile(): GraphicsProfile {
    return PROFILES[this.mode === 'auto' ? this.level : this.mode === 'economy' ? 2 : 0];
  }

  setMode(mode: QualityMode): void {
    this.mode = mode;
    this.level = 0;
    this.resetSampling();
  }

  resetSampling(): void {
    this.samples.length = 0;
    this.elapsed = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
  }

  sample(rawDeltaMs: number): void {
    if (this.mode !== 'auto' || !Number.isFinite(rawDeltaMs) || rawDeltaMs <= 0) return;
    // A suspended tab or debugger gap is not representative of rendering load.
    if (rawDeltaMs > 250) {
      this.resetSampling();
      return;
    }
    this.samples.push(rawDeltaMs);
    this.elapsed += rawDeltaMs;
    if (this.elapsed < 1000) return;
    if (this.samples.length < 4) {
      this.resetSampling();
      return;
    }
    this.samples.sort((a, b) => a - b);
    const p95 = this.samples[Math.ceil(this.samples.length * 0.95) - 1];
    this.samples.length = 0;
    this.elapsed = 0;
    this.slowWindows = p95 > 33.3 ? this.slowWindows + 1 : 0;
    this.fastWindows = p95 < 24 ? this.fastWindows + 1 : 0;
    if (this.slowWindows >= 2 && this.level < PROFILES.length - 1) {
      this.level++;
      this.resetSampling();
    } else if (this.fastWindows >= 10 && this.level > 0) {
      this.level--;
      this.resetSampling();
    }
  }
}
