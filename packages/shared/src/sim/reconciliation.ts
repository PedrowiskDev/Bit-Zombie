import { BALANCE } from '../config/balance.js';
import { normalizeInputVector, stepEntityMovement } from '../math/vec2.js';
import type {
  InputCmd,
  PlayerStateSnapshot,
  ZombieStateSnapshot,
} from '../types/protocol.js';

/**
 * Valida código de convite de 5 caracteres (apenas caracteres de ROOM_CODE_ALPHABET, sem O, 0, I, 1).
 */
export function isValidRoomCode(code: unknown): code is string {
  if (typeof code !== 'string') {
    return false;
  }
  const normalized = code.trim().toUpperCase();
  if (normalized.length !== BALANCE.NETWORK.ROOM_CODE_LENGTH) {
    return false;
  }
  const alphabet = BALANCE.NETWORK.ROOM_CODE_ALPHABET;
  for (let i = 0; i < normalized.length; i += 1) {
    if (!alphabet.includes(normalized[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Gera um código de sala de 5 caracteres sem O, 0, I, 1.
 */
export function generateRoomCode(randomFloat: () => number = Math.random): string {
  const alphabet = BALANCE.NETWORK.ROOM_CODE_ALPHABET;
  let code = '';
  for (let i = 0; i < BALANCE.NETWORK.ROOM_CODE_LENGTH; i += 1) {
    const idx = Math.min(alphabet.length - 1, Math.max(0, Math.floor(randomFloat() * alphabet.length)));
    code += alphabet[idx];
  }
  return code;
}

/**
 * Fila e validador de comandos de entrada por jogador no servidor autoritativo.
 * - Valida tipos (`seq` inteiro positivo seguro, `dx`/`dy` finitos).
 * - Limita o tamanho do vetor a 1 (`normalizeInputVector`).
 * - Aplica rate limit por segundo (`MAX_INPUT_RATE_PER_SEC`).
 * - Descarta duplicados ou atrasados (`seq <= lastProcessedSeq`).
 * - Mantém fila ordenada por `seq` crescente, limitada a `MAX_INPUT_QUEUE = 8`.
 * - Fornece no máximo 1 comando por tick de 50 ms do servidor.
 */
export class PlayerInputQueue {
  private readonly queue: InputCmd[] = [];
  private lastProcessedSeq = 0;
  private windowStartMs = 0;
  private messagesInWindow = 0;

  constructor(
    private readonly maxQueueSize: number = BALANCE.SIMULATION.MAX_INPUT_QUEUE,
    private readonly maxRatePerSec: number = BALANCE.NETWORK.MAX_INPUT_RATE_PER_SEC
  ) {}

  enqueue(rawPayload: unknown, nowMs: number = Date.now()): boolean {
    if (nowMs - this.windowStartMs >= 1000) {
      this.windowStartMs = nowMs;
      this.messagesInWindow = 0;
    }
    this.messagesInWindow += 1;
    if (this.messagesInWindow > this.maxRatePerSec) {
      return false;
    }

    if (typeof rawPayload !== 'object' || rawPayload === null) {
      return false;
    }
    const candidate = rawPayload as Record<string, unknown>;
    const seq = candidate.seq;
    const dx = candidate.dx;
    const dy = candidate.dy;

    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= 0) {
      return false;
    }
    if (typeof dx !== 'number' || !Number.isFinite(dx)) {
      return false;
    }
    if (typeof dy !== 'number' || !Number.isFinite(dy)) {
      return false;
    }

    if (seq <= this.lastProcessedSeq) {
      return false;
    }

    for (let i = 0; i < this.queue.length; i += 1) {
      if (this.queue[i].seq === seq) {
        return false;
      }
    }

    const norm = normalizeInputVector(dx, dy);
    const sanitized: InputCmd = {
      seq,
      dx: norm.x,
      dy: norm.y,
    };

    if (candidate.aimMode === 'manual' || candidate.aimMode === 'auto') {
      sanitized.aimMode = candidate.aimMode;
    }
    if (typeof candidate.aimX === 'number' && typeof candidate.aimY === 'number') {
      if (Number.isFinite(candidate.aimX) && Number.isFinite(candidate.aimY)) {
        const normAim = normalizeInputVector(candidate.aimX, candidate.aimY);
        sanitized.aimX = normAim.x;
        sanitized.aimY = normAim.y;
      }
    }
    if (typeof candidate.firing === 'boolean') {
      sanitized.firing = candidate.firing;
    }

    this.queue.push(sanitized);
    this.queue.sort((a, b) => a.seq - b.seq);

    while (this.queue.length > this.maxQueueSize) {
      this.queue.shift();
    }

    return true;
  }

  popNextTickCommand(): InputCmd | undefined {
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (next.seq > this.lastProcessedSeq) {
        this.lastProcessedSeq = next.seq;
        return next;
      }
    }
    return undefined;
  }

  getLastProcessedSeq(): number {
    return this.lastProcessedSeq;
  }

  getPendingCount(): number {
    return this.queue.length;
  }

  reset(): void {
    this.queue.length = 0;
    this.lastProcessedSeq = 0;
    this.messagesInWindow = 0;
  }
}

/**
 * Reconcilia a posição do jogador local com o estado autoritativo recebido do servidor:
 * 1. Descarta comandos pendentes com `seq <= authoritative.lastProcessedSeq`.
 * 2. Parte de `(authoritative.x, authoritative.y)` e reaplica em ordem todos os comandos
 *    pendentes com `seq > authoritative.lastProcessedSeq`.
 */
export function reconcileLocalPlayer(
  authoritative: PlayerStateSnapshot,
  pendingInputs: readonly InputCmd[],
  mapWidth: number = BALANCE.MAP.WIDTH,
  mapHeight: number = BALANCE.MAP.HEIGHT
): { reconciledPlayer: PlayerStateSnapshot; remainingInputs: InputCmd[] } {
  const remainingInputs = pendingInputs.filter(
    (cmd) => cmd.seq > authoritative.lastProcessedSeq
  );

  if (!authoritative.alive || !authoritative.connected) {
    return {
      reconciledPlayer: { ...authoritative, vx: 0, vy: 0 },
      remainingInputs,
    };
  }

  let x = authoritative.x;
  let y = authoritative.y;
  let vx = authoritative.vx;
  let vy = authoritative.vy;
  let facingAngle = authoritative.facingAngle;

  for (let i = 0; i < remainingInputs.length; i += 1) {
    const cmd = remainingInputs[i];
    const stepped = stepEntityMovement(
      x,
      y,
      cmd.dx,
      cmd.dy,
      BALANCE.PLAYER.SPEED_PX_PER_SEC,
      BALANCE.SIMULATION.TICK_DT_SEC,
      authoritative.radius,
      mapWidth,
      mapHeight
    );
    x = stepped.x;
    y = stepped.y;
    vx = stepped.vx;
    vy = stepped.vy;
    if (
      cmd.aimMode === 'manual' &&
      cmd.aimX !== undefined &&
      cmd.aimY !== undefined &&
      (cmd.aimX !== 0 || cmd.aimY !== 0)
    ) {
      facingAngle = Math.atan2(cmd.aimY, cmd.aimX);
    } else if (vx !== 0 || vy !== 0) {
      facingAngle = Math.atan2(vy, vx);
    }
  }

  return {
    reconciledPlayer: {
      ...authoritative,
      x,
      y,
      vx,
      vy,
      facingAngle,
    },
    remainingInputs,
  };
}

export interface TimedEntitySnapshot {
  serverTimeMs: number;
  players: Map<string, PlayerStateSnapshot>;
  zombies: Map<number, ZombieStateSnapshot>;
}

/**
 * Interpola linearmente ângulos no intervalo [-PI, PI] pelo menor arco.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff < -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;
  return a + diff * t;
}

/**
 * Interpola entidades remotas (outro jogador e zumbis) em `renderServerTimeMs`
 * (tipicamente `estimatedServerTimeMs - 100 ms`) usando o buffer de snapshots.
 */
export function interpolateRemoteEntities(
  buffer: readonly TimedEntitySnapshot[],
  renderServerTimeMs: number,
  localPlayerId: string
): {
  remotePlayers: PlayerStateSnapshot[];
  zombies: ZombieStateSnapshot[];
} {
  if (buffer.length === 0) {
    return { remotePlayers: [], zombies: [] };
  }

  if (buffer.length === 1 || renderServerTimeMs <= buffer[0].serverTimeMs) {
    const snap = buffer[0];
    return {
      remotePlayers: Array.from(snap.players.values())
        .filter((p) => p.id !== localPlayerId)
        .map((p) => ({ ...p })),
      zombies: Array.from(snap.zombies.values()).map((z) => ({ ...z })),
    };
  }

  const last = buffer[buffer.length - 1];
  if (renderServerTimeMs >= last.serverTimeMs) {
    return {
      remotePlayers: Array.from(last.players.values())
        .filter((p) => p.id !== localPlayerId)
        .map((p) => ({ ...p })),
      zombies: Array.from(last.zombies.values()).map((z) => ({ ...z })),
    };
  }

  let s0 = buffer[0];
  let s1 = buffer[buffer.length - 1];
  for (let i = 0; i < buffer.length - 1; i += 1) {
    if (
      buffer[i].serverTimeMs <= renderServerTimeMs &&
      renderServerTimeMs <= buffer[i + 1].serverTimeMs
    ) {
      s0 = buffer[i];
      s1 = buffer[i + 1];
      break;
    }
  }

  const span = Math.max(1, s1.serverTimeMs - s0.serverTimeMs);
  const alpha = Math.min(1, Math.max(0, (renderServerTimeMs - s0.serverTimeMs) / span));

  const remotePlayers: PlayerStateSnapshot[] = [];
  for (const [id, p1] of s1.players.entries()) {
    if (id === localPlayerId) {
      continue;
    }
    const p0 = s0.players.get(id) ?? p1;
    remotePlayers.push({
      ...p1,
      x: p0.x + (p1.x - p0.x) * alpha,
      y: p0.y + (p1.y - p0.y) * alpha,
      facingAngle: lerpAngle(p0.facingAngle, p1.facingAngle, alpha),
    });
  }

  const zombies: ZombieStateSnapshot[] = [];
  for (const [id, z1] of s1.zombies.entries()) {
    const z0 = s0.zombies.get(id) ?? z1;
    zombies.push({
      ...z1,
      x: z0.x + (z1.x - z0.x) * alpha,
      y: z0.y + (z1.y - z0.y) * alpha,
      facingAngle: lerpAngle(z0.facingAngle, z1.facingAngle, alpha),
    });
  }

  return { remotePlayers, zombies };
}
