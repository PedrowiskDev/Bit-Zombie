type Timing = 'interval' | 'cpu' | 'provider' | 'step' | 'snapshot' | 'fog' | 'three';

export interface GraphicsCounters {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  pixelRatio: number;
  animatedActors: number;
  quality: string;
}

const WINDOW_SIZE = 600;

class Samples {
  private readonly values = new Float64Array(WINDOW_SIZE);
  private count = 0;

  get length(): number {
    return Math.min(this.count, WINDOW_SIZE);
  }

  add(value: number): void {
    this.values[this.count % WINDOW_SIZE] = value;
    this.count++;
  }

  summary(): string {
    const sorted = this.values.slice(0, this.length).sort();
    if (!sorted.length) return '—';
    return [0.5, 0.95, 0.99].map((p) => sorted[Math.ceil(p * sorted.length) - 1].toFixed(2)).join(' / ');
  }
}

export class FrameProfiler {
  private samples = this.newSamples();
  private startedAt: number | undefined;
  private previousStart: number | undefined;
  private totals = { snapshot: 0, fog: 0, three: 0, provider: 0 };
  private lastReport = -Infinity;

  private newSamples(): Record<Timing, Samples> {
    return {
      interval: new Samples(), cpu: new Samples(), provider: new Samples(),
      step: new Samples(), snapshot: new Samples(), fog: new Samples(), three: new Samples(),
    };
  }

  begin(): void {
    const now = performance.now();
    if (this.previousStart !== undefined) this.samples.interval.add(now - this.previousStart);
    this.startedAt = now;
    this.previousStart = now;
    this.totals.snapshot = 0;
    this.totals.fog = 0;
    this.totals.three = 0;
    this.totals.provider = 0;
  }

  suspend(): void {
    this.startedAt = undefined;
    this.previousStart = undefined;
  }

  reset(): void {
    this.suspend();
    this.samples = this.newSamples();
    this.lastReport = -Infinity;
  }

  measure<T>(timing: keyof FrameProfiler['totals'], run: () => T): T {
    if (this.startedAt === undefined) return run();
    const start = performance.now();
    const result = run();
    this.totals[timing] += performance.now() - start;
    return result;
  }

  recordStep = (elapsedMs: number): void => {
    if (this.startedAt !== undefined) this.samples.step.add(elapsedMs);
  };

  finish(): string[] | undefined {
    if (this.startedAt === undefined) return;
    const now = performance.now();
    this.samples.cpu.add(now - this.startedAt);
    this.startedAt = undefined;
    this.samples.provider.add(this.totals.provider);
    this.samples.snapshot.add(this.totals.snapshot);
    this.samples.fog.add(this.totals.fog);
    this.samples.three.add(this.totals.three);
    if (now - this.lastReport < 1000) return;
    this.lastReport = now;
    return [
      `ms p50 / p95 / p99 · ${this.samples.interval.length}/${WINDOW_SIZE} intervalos`,
      `Quadro: ${this.samples.interval.summary()}`,
      `CPU cliente: ${this.samples.cpu.summary()}`,
      `Provider por quadro: ${this.samples.provider.summary()}`,
      `Sim offline por tick: ${this.samples.step.summary()}`,
      `Snapshots por quadro: ${this.samples.snapshot.summary()}`,
      `Névoa por quadro: ${this.samples.fog.summary()}`,
      `CPU Three por quadro: ${this.samples.three.summary()}`,
    ];
  }
}
