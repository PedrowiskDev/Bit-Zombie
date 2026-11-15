import { describe, expect, it } from 'vitest';
import { GraphicsQuality } from '../src/render/GraphicsQuality.js';

function frames(quality: GraphicsQuality, ms: number, count: number): void {
  for (let i = 0; i < count; i++) quality.sample(ms);
}

describe('qualidade gráfica adaptativa', () => {
  it('reduz com lentidão sustentada e exige mais tempo para recuperar', () => {
    const quality = new GraphicsQuality();
    frames(quality, 40, 25);
    expect(quality.profile.name).toBe('Padrão');
    frames(quality, 40, 25);
    expect(quality.profile.name).toBe('Equilibrado');
    frames(quality, 40, 50);
    expect(quality.profile.name).toBe('Economia');
    frames(quality, 20, 450);
    expect(quality.profile.name).toBe('Economia');
    frames(quality, 20, 50);
    expect(quality.profile.name).toBe('Equilibrado');
  });

  it('não reage à suspensão da aba e respeita os modos manuais', () => {
    const quality = new GraphicsQuality();
    frames(quality, 40, 25);
    quality.sample(500);
    frames(quality, 40, 25);
    expect(quality.profile.name).toBe('Padrão');
    quality.setMode('standard');
    frames(quality, 80, 100);
    expect(quality.profile.name).toBe('Padrão');
    quality.setMode('economy');
    frames(quality, 16, 2000);
    expect(quality.profile.name).toBe('Economia');
  });
});
