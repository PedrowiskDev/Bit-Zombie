import { MapSchema, Schema, type } from '@colyseus/schema';
import {
  BALANCE,
  type ExplorationSubPhase,
  type GameMode,
  type RoomPhase,
  type RoundSubPhase,
} from '@zombie-coop/shared';

export class PlayerSchema extends Schema {
  @type('string') id: string = '';
  @type('number') colorIndex: number = 0;
  @type('number') x: number = BALANCE.PLAYER.SPAWN_X;
  @type('number') y: number = BALANCE.PLAYER.SPAWN_Y;
  @type('number') vx: number = 0;
  @type('number') vy: number = 0;
  @type('number') facingAngle: number = 0;
  @type('number') radius: number = BALANCE.PLAYER.RADIUS;
  @type('number') hp: number = BALANCE.PLAYER.MAX_HP;
  @type('number') maxHp: number = BALANCE.PLAYER.MAX_HP;
  @type('boolean') alive: boolean = true;
  @type('boolean') connected: boolean = true;
  @type('boolean') ready: boolean = false;
  @type('string') aimMode: string = 'auto';
  @type('number') invulnMs: number = 0;
  @type('number') kills: number = 0;
  @type('number') lastProcessedSeq: number = 0;
  @type('number') reviveProgress: number = 0;
  @type('string') pendingUpgradesCsv: string = '';
  @type('number') pendingUpgradeTimerMs: number = 0;
  @type('number') upgradesChosenCount: number = 0;
  @type('boolean') readyForNextRound: boolean = false;
  @type('number') damageDealt: number = 0;
  @type('number') revivesCount: number = 0;
}

export class ZombieSchema extends Schema {
  @type('number') id: number = 0;
  @type('string') kind: string = 'common';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') vx: number = 0;
  @type('number') vy: number = 0;
  @type('number') facingAngle: number = 0;
  @type('number') radius: number = BALANCE.ZOMBIES.COMMON.RADIUS;
  @type('number') hp: number = BALANCE.ZOMBIES.COMMON.HP;
  @type('number') maxHp: number = BALANCE.ZOMBIES.COMMON.HP;
  @type('boolean') isElite: boolean = false;
}

export class SurvivalRoomState extends Schema {
  @type('number') protocolVersion: number = BALANCE.PROTOCOL_VERSION;
  @type('string') roomCode: string = '';
  @type('string') gameMode: GameMode = 'rounds';
  @type('string') phase: RoomPhase = 'lobby';
  @type('number') countdownMs: number = BALANCE.NETWORK.COUNTDOWN_DURATION_MS;
  @type('number') tick: number = 0;
  @type('number') elapsedMs: number = 0;
  @type('number') seed: number = BALANCE.SIMULATION.DEFAULT_SEED;
  @type('number') mapWidth: number = BALANCE.MAP.WIDTH;
  @type('number') mapHeight: number = BALANCE.MAP.HEIGHT;
  @type('boolean') gameOver: boolean = false;
  @type('number') kills: number = 0;
  @type('number') totalDamageDealt: number = 0;
  @type('number') totalRevives: number = 0;
  @type('number') structuresBuilt: number = 0;
  @type('number') xp: number = 0;
  @type('number') level: number = 1;
  @type('number') xpToNextLevel: number = BALANCE.XP.BASE_XP;
  @type('number') weaponDamage: number = BALANCE.PISTOL.DAMAGE;
  @type('number') weaponFireRate: number = BALANCE.PISTOL.FIRE_RATE_PER_SEC;
  @type('string') lastLevelBonusLabel: string = '';

  // Estado Modo 1 — Sobrevivência por Rodadas
  @type('number') roundNumber: number = 1;
  @type('string') roundPhase: RoundSubPhase = 'active';
  @type('boolean') isSpecialEliteRound: boolean = false;
  @type('number') roundTotalZombies: number = 0;
  @type('number') roundRemainingZombies: number = 0;
  @type('number') intermissionRemainingMs: number = 0;
  @type('number') roundsCompleted: number = 0;

  // Estado Modo 2 — Exploração e Abrigo
  @type('string') explorationPhase: ExplorationSubPhase = 'exploring';
  @type('number') daysSurvived: number = 1;
  @type('number') hordeNumber: number = 0;
  @type('number') hordesCleared: number = 0;
  @type('number') timeUntilNextHordeMs: number = BALANCE.EXPLORATION.FIRST_HORDE_DELAY_MS;
  @type('number') warningRemainingMs: number = 0;
  @type('number') recoveryRemainingMs: number = 0;
  @type('number') hordeTotalZombies: number = 0;
  @type('number') hordeRemainingZombies: number = 0;
  @type('number') sectorsExplored: number = 0;

  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: ZombieSchema }) zombies = new MapSchema<ZombieSchema>();
}

