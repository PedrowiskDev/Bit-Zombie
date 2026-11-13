import type {
  AimMode,
  ExplorationModeStateSnapshot,
  GameEvent,
  GameMode,
  PlayerStateSnapshot,
  PropData,
  RoomPhase,
  RoundsModeStateSnapshot,
  Vec2,
  ZombieStateSnapshot,
} from '@zombie-coop/shared';

export interface NetworkTelemetry {
  pingMs: number;
  rxBytesPerSec: number;
  txBytesPerSec: number;
  pendingInputsCount: number;
  simulatedLagMs: number;
}

export interface FrameAimInput {
  aimMode: AimMode;
  aimX: number;
  aimY: number;
  firing: boolean;
}

export interface RenderWorldState {
  gameMode: GameMode;
  tick: number;
  elapsedMs: number;
  seed: number;
  mapWidth: number;
  mapHeight: number;
  roomCode: string;
  phase: RoomPhase;
  countdownMs: number;
  gameOver: boolean;
  kills: number;
  totalDamageDealt: number;
  totalRevives: number;
  structuresBuilt: number;
  xp: number;
  level: number;
  xpToNextLevel: number;
  weaponDamage: number;
  weaponFireRate: number;
  lastLevelBonusLabel: string;
  localPlayerId: string;
  /** Lista de jogadores já interpolados/reconciliados para o frame visual atual */
  players: PlayerStateSnapshot[];
  /** Lista de zumbis já interpolados para o frame visual atual */
  zombies: ZombieStateSnapshot[];
  /** Props decorativos sem colisão */
  props: PropData[];
  /** Estado do Diretor de Rodadas (quando gameMode === 'rounds') */
  roundsState?: RoundsModeStateSnapshot;
  /** Estado do Diretor de Exploração e Hordas (quando gameMode === 'exploration') */
  explorationState?: ExplorationModeStateSnapshot;
  /** Fator de interpolação [0, 1] entre o último tick de 20 Hz e o atual */
  interpolationAlpha: number;
  /** Métricas de rede e sincronização */
  telemetry: NetworkTelemetry;
}

/**
 * Contrato de origem de dados consumido pela GameScene.
 * A cena Phaser apenas desenha o `RenderWorldState` e anima os `GameEvent`s,
 * sem saber se os dados vêm da Simulation local (`OfflineProvider`) ou do servidor Colyseus (`OnlineProvider`).
 */
export interface IWorldProvider {
  readonly mode: 'offline' | 'online';
  readonly localPlayerId: string;

  /**
   * Atualiza o provider com o delta de renderização do frame (`frameDtMs`),
   * a direção de intenção atual do jogador (`rawInput`) e o estado de mira/tiro (`aimInput`).
   */
  updateFrame(frameDtMs: number, rawInput: Vec2, aimInput?: FrameAimInput): void;

  /**
   * Retorna o estado do mundo pronto para desenhar no frame atual (sem efeitos colaterais).
   */
  getRenderState(): RenderWorldState;

  /**
   * Consome explicitamente os eventos transitórios ainda não processados pelo cliente,
   * garantindo que cada `eventId` seja entregue apenas uma vez.
   */
  consumeNewEvents(): GameEvent[];

  /**
   * Reinicia a partida (ex.: botão "Jogar de Novo" na tela de fim de jogo).
   */
  restart(newSeed?: number): void;

  /**
   * Alterna estado de "Pronto" no lobby multiplayer.
   */
  setReady?(ready?: boolean): void;

  /**
   * Solicita antecipar o intervalo entre rodadas no Modo 1.
   */
  skipRoundIntermission?(): void;

  /**
   * Envia a escolha de uma carta de upgrade na Fase 2 sem pausar a partida.
   */
  chooseUpgrade?(upgradeId: string): void;

  /**
   * Encerra conexão/recursos do provider.
   */
  disconnect?(): Promise<void>;
}
