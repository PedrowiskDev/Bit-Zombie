import type { RenderWorldState } from '../network/WorldProvider.js';

/**
 * Painel de diagnóstico em tempo real ativado exclusivamente pelo parâmetro `?debug` na URL.
 * Exibe FPS, Ping (ms), Tick, Número de Entidades, Banda por jogador (RX/TX B/s) e Lag simulado (`?lag=N`).
 */
export class DebugOverlay {
  private readonly el: HTMLDivElement | null = null;
  private readonly enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      return;
    }

    const div = document.createElement('div');
    div.id = 'debug-overlay';
    div.setAttribute('data-testid', 'debug-overlay');
    Object.assign(div.style, {
      position: 'fixed',
      top: '14px',
      right: '14px',
      backgroundColor: 'rgba(10, 15, 12, 0.88)',
      border: '1px solid #3c5444',
      borderRadius: '6px',
      padding: '8px 12px',
      fontFamily: 'monospace',
      fontSize: '12px',
      lineHeight: '1.45',
      color: '#95f0b2',
      zIndex: '35',
      pointerEvents: 'none',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'pre',
    });

    document.body.appendChild(div);
    this.el = div;
  }

  update(fps: number, state: RenderWorldState): void {
    if (!this.enabled || !this.el) {
      return;
    }

    const entitiesCount = state.players.length + state.zombies.length;
    const { pingMs, rxBytesPerSec, txBytesPerSec, pendingInputsCount, simulatedLagMs } =
      state.telemetry;

    this.el.textContent = [
      `FPS: ${Math.round(fps)}  |  MODO: ${state.roomCode === 'SOLO' ? 'OFFLINE' : `ONLINE (${state.roomCode})`}`,
      `PING: ${pingMs} ms${simulatedLagMs > 0 ? ` (lag=${simulatedLagMs}ms)` : ''}  |  TICK: ${state.tick}`,
      `ENTIDADES: ${entitiesCount} (${state.players.length}P + ${state.zombies.length}Z)`,
      `BANDA: RX ${rxBytesPerSec} B/s  |  TX ${txBytesPerSec} B/s  |  PEND: ${pendingInputsCount}`,
    ].join('\n');
  }

  destroy(): void {
    this.el?.remove();
  }
}
