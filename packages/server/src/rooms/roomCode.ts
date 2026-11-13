import {
  generateRoomCode,
  isValidRoomCode,
  type GameMode,
  type RoomPhase,
} from '@zombie-coop/shared';

export interface ActiveRoomSummary {
  roomCode: string;
  colyseusRoomId: string;
  gameMode: GameMode;
  seed: number;
  phase: RoomPhase;
  clientsCount: number;
  maxClients: number;
}

/**
 * Registro em memória de salas privadas ativas indexadas pelo código de convite de 5 caracteres.
 */
class RoomRegistry {
  private readonly byCode = new Map<string, ActiveRoomSummary>();

  allocateUniqueCode(): string {
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const code = generateRoomCode();
      if (!this.byCode.has(code)) {
        return code;
      }
    }
    throw new Error('Não foi possível alocar um código de sala único.');
  }

  register(summary: ActiveRoomSummary): void {
    this.byCode.set(summary.roomCode.toUpperCase(), { ...summary });
  }

  update(roomCode: string, partial: Partial<ActiveRoomSummary>): void {
    const key = roomCode.toUpperCase();
    const existing = this.byCode.get(key);
    if (existing) {
      this.byCode.set(key, { ...existing, ...partial });
    }
  }

  unregister(roomCode: string): void {
    this.byCode.delete(roomCode.toUpperCase());
  }

  lookup(rawCode: unknown):
    | { ok: true; room: ActiveRoomSummary }
    | { ok: false; errorCode: 'INVALID_ROOM_CODE' | 'ROOM_NOT_FOUND' | 'ROOM_FULL' } {
    if (!isValidRoomCode(rawCode)) {
      return { ok: false, errorCode: 'INVALID_ROOM_CODE' };
    }
    const normalized = rawCode.trim().toUpperCase();
    const room = this.byCode.get(normalized);
    if (!room) {
      return { ok: false, errorCode: 'ROOM_NOT_FOUND' };
    }
    if (room.clientsCount >= room.maxClients) {
      return { ok: false, errorCode: 'ROOM_FULL' };
    }
    return { ok: true, room };
  }
}

export const roomRegistry = new RoomRegistry();
