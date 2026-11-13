/**
 * Contratos de protocolo, estado persistente (Snapshot) e eventos transitórios.
 * Zero dependências externas (TypeScript puro).
 */

/** Estados possíveis de uma sala multiplayer */
export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'gameover';

/** Modos de jogo disponíveis no mesmo mapa-base (Etapa 1) */
export type GameMode = 'rounds' | 'exploration';

/** Subfases do Modo 1 — Sobrevivência por Rodadas */
export type RoundSubPhase = 'active' | 'intermission';

/** Subfases do Modo 2 — Exploração e Abrigo */
export type ExplorationSubPhase =
  | 'exploring'
  | 'horde_warning'
  | 'horde_active'
  | 'recovery';

/** Modo de disparo escolhido pelo jogador: automático (mira no zumbi mais próximo) ou manual (lado direito / mira livre) */
export type AimMode = 'auto' | 'manual';

/** Tipo de bônus automático concedido ao subir de nível na Fase 1 */
export type LevelUpBonusKind = 'damage' | 'fire_rate';

/** Códigos padronizados de erro de rede / protocolo */
export type NetworkErrorCode =
  | 'PROTOCOL_MISMATCH'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'INVALID_ROOM_CODE'
  | 'CONNECTION_LOST';

/**
 * Comando de intenção de movimento e mira enviado pelo cliente para um passo fixo de 50 ms.
 * - `seq`: inteiro positivo monotônico crescente por jogador (1, 2, 3...).
 * - `dx`, `dy`: componentes do vetor de direção desejado; o servidor valida e limita a magnitude <= 1.
 * - `aimMode`: 'auto' (padrão) ou 'manual'.
 * - `aimX`, `aimY`: componentes do vetor de direção da mira manual (normalizado no servidor).
 * - `firing`: indica se o gatilho manual está pressionado neste passo.
 */
export interface InputCmd {
  seq: number;
  dx: number;
  dy: number;
  aimMode?: AimMode;
  aimX?: number;
  aimY?: number;
  firing?: boolean;
}

/** Mapa de comandos do tick indexado pelo `playerId` */
export type TickInputMap = Record<string, InputCmd | undefined>;

/** Tipos de props decorativos sem colisão espalhados pelo mapa */
export type PropKind = 'car' | 'crate' | 'bush' | 'rubble';

export interface PropData {
  id: number;
  kind: PropKind;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  variant: number;
}

/** Três tipos base de zumbis */
export type ZombieKind = 'common' | 'fast' | 'brute';

export interface ZombieStateSnapshot {
  id: number;
  kind: ZombieKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingAngle: number;
  radius: number;
  hp: number;
  maxHp: number;
  /** Indica se é um inimigo de Elite (ex.: a cada 5 rodadas ou líder de horda) */
  isElite?: boolean;
  /** Origem do spawn para rastreamento dos diretores ('round' | 'ambient' | 'horde' | 'manual') */
  spawnSource?: 'round' | 'ambient' | 'horde' | 'manual';
}

export interface PlayerStateSnapshot {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingAngle: number;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Indica se o jogador está conectado (false durante a janela de 20s de reconexão) */
  connected: boolean;
  /** Indica se o jogador marcou pronto no lobby */
  ready: boolean;
  colorIndex: number;
  /** Modo de disparo ativo para este jogador ('auto' ou 'manual') */
  aimMode?: AimMode;
  /** Tempo restante de invulnerabilidade por dano de contato em ms */
  invulnMs: number;
  /** Cooldown restante para o próximo disparo em ms */
  fireCooldownMs: number;
  /** Total de zumbis eliminados por este jogador */
  kills: number;
  /** Último `seq` efetivamente processado pela simulação para reconciliação no cliente */
  lastProcessedSeq: number;
  /** Progresso de resgate (0..1) quando este jogador está caído e um aliado está na zona (Fase 2) */
  reviveProgress?: number;
  /** Opções de upgrade pendentes para escolha interativa na Fase 2 (ex.: 3 cartas) */
  pendingUpgradeOptions?: string[];
  /** Tempo restante em ms para escolha automática da oferta atual de upgrade (Fase 2) */
  pendingUpgradeTimerMs?: number;
  /** Quantidade de upgrades já escolhidos por este jogador na partida (Fase 2) */
  upgradesChosenCount?: number;
  /** Indica se o jogador concordou em antecipar o intervalo para a próxima rodada (Modo Rodadas) */
  readyForNextRound?: boolean;
  /** Dano total causado por este jogador na partida */
  damageDealt?: number;
  /** Quantidade de resgates realizados por este jogador na partida */
  revivesCount?: number;
}

/** Estado detalhado do Diretor de Rodadas (Modo 1 — Sobrevivência por Rodadas) */
export interface RoundsModeStateSnapshot {
  roundNumber: number;
  roundPhase: RoundSubPhase;
  isSpecialEliteRound: boolean;
  roundTotalZombies: number;
  roundSpawnedZombies: number;
  roundRemainingZombies: number;
  intermissionRemainingMs: number;
  roundsCompleted: number;
  threatBudget: number;
  readyPlayersCount: number;
  livingPlayersCount: number;
}

/** Estado detalhado do Diretor de Exploração e Hordas (Modo 2 — Exploração e Abrigo) */
export interface ExplorationModeStateSnapshot {
  explorationPhase: ExplorationSubPhase;
  daysSurvived: number;
  dayProgressRatio: number;
  hordeNumber: number;
  hordesCleared: number;
  timeUntilNextHordeMs: number;
  warningRemainingMs: number;
  recoveryRemainingMs: number;
  hordeTotalZombies: number;
  hordeSpawnedZombies: number;
  hordeRemainingZombies: number;
  ambientZombiesAlive: number;
  sectorsExplored: number;
  totalSectors: number;
}

/**
 * Fotografia persistente do estado do mundo no tick `tick`.
 * Retornada por `Simulation.getSnapshot()` sem efeitos colaterais.
 */
export interface WorldSnapshot {
  protocolVersion: number;
  gameMode: GameMode;
  tick: number;
  elapsedMs: number;
  seed: number;
  mapWidth: number;
  mapHeight: number;
  gameOver: boolean;
  kills: number;
  xp: number;
  level: number;
  xpToNextLevel: number;
  weaponDamage: number;
  weaponFireRate: number;
  lastLevelBonusLabel: string;
  totalDamageDealt: number;
  totalRevives: number;
  structuresBuilt: number;
  roundsState: RoundsModeStateSnapshot;
  explorationState: ExplorationModeStateSnapshot;
  players: PlayerStateSnapshot[];
  zombies: ZombieStateSnapshot[];
  props: PropData[];
}

/**
 * Eventos transitórios ocorridos durante um tick da simulação.
 * Cada evento possui `eventId` único e monotônico dentro da partida e o `tick` em que ocorreu.
 * Consumidos explicitamente por `Simulation.consumeEvents()`.
 */
export interface BaseGameEvent {
  eventId: number;
  tick: number;
}

export interface PlayerSpawnedEvent extends BaseGameEvent {
  type: 'player_spawned';
  playerId: string;
  x: number;
  y: number;
}

export interface WeaponFireEvent extends BaseGameEvent {
  type: 'fire';
  projectileId: number;
  ownerId: string;
  targetZombieId: number;
  fromX: number;
  fromY: number;
  dirX: number;
  dirY: number;
  speed: number;
  range: number;
}

export interface ProjectileHitEvent extends BaseGameEvent {
  type: 'hit';
  projectileId: number;
  ownerId: string;
  zombieId: number;
  zombieKind: ZombieKind;
  x: number;
  y: number;
  damage: number;
  killed: boolean;
}

export interface PlayerDamagedEvent extends BaseGameEvent {
  type: 'player_hit';
  playerId: string;
  zombieId: number;
  damage: number;
  hpRemaining: number;
  killed: boolean;
}

export interface LevelUpEvent extends BaseGameEvent {
  type: 'level_up';
  newLevel: number;
  bonusKind: LevelUpBonusKind;
  bonusLabel: string;
  weaponDamage: number;
  weaponFireRate: number;
}

export interface PlayerRevivedEvent extends BaseGameEvent {
  type: 'player_revived';
  revivedPlayerId: string;
  saviorPlayerId: string;
  x: number;
  y: number;
  hpRestored: number;
}

export interface UpgradeChosenEvent extends BaseGameEvent {
  type: 'upgrade_chosen';
  playerId: string;
  upgradeId: string;
  upgradeName: string;
  autoSelected: boolean;
}

export interface RoundStartedEvent extends BaseGameEvent {
  type: 'round_started';
  roundNumber: number;
  totalZombies: number;
  isSpecialEliteRound: boolean;
}

export interface RoundCompletedEvent extends BaseGameEvent {
  type: 'round_completed';
  roundNumber: number;
  intermissionMs: number;
}

export interface HordeWarningEvent extends BaseGameEvent {
  type: 'horde_warning';
  hordeNumber: number;
  warningMs: number;
}

export interface HordeStartedEvent extends BaseGameEvent {
  type: 'horde_started';
  hordeNumber: number;
  totalZombies: number;
}

export interface HordeClearedEvent extends BaseGameEvent {
  type: 'horde_cleared';
  hordeNumber: number;
  recoveryMs: number;
}

export type GameEvent =
  | PlayerSpawnedEvent
  | WeaponFireEvent
  | ProjectileHitEvent
  | PlayerDamagedEvent
  | LevelUpEvent
  | PlayerRevivedEvent
  | UpgradeChosenEvent
  | RoundStartedEvent
  | RoundCompletedEvent
  | HordeWarningEvent
  | HordeStartedEvent
  | HordeClearedEvent;
