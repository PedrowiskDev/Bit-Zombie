/**
 * Parâmetros centralizados de balanceamento e configuração do mundo.
 * Todos os números do jogo ficam neste módulo conforme o princípio 6 da arquitetura.
 */

export const BALANCE = {
  /** Versão do protocolo de rede e contratos de simulação */
  PROTOCOL_VERSION: 1,

  /** Frequência fixa da simulação autoritativa */
  SIMULATION: {
    TICK_RATE: 20,
    TICK_DT_MS: 50,
    TICK_DT_SEC: 0.05,
    DEFAULT_SEED: 133742,
    MAX_INPUT_QUEUE: 8,
    MAX_PENDING_INPUTS: 64,
    INTERP_DELAY_MS: 100,
  },

  /** Parâmetros de sala privada e rede (Etapa 4) */
  NETWORK: {
    ROOM_CODE_LENGTH: 5,
    /** Alfabeto sem O, 0, I, 1 */
    ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
    MAX_PLAYERS_PER_ROOM: 2,
    COUNTDOWN_DURATION_MS: 3000,
    RECONNECT_GRACE_SEC: 20,
    MAX_INPUT_RATE_PER_SEC: 40,
    SNAPSHOT_BUFFER_SIZE: 30,
  },

  /** Dimensões e decoração do mapa */
  MAP: {
    WIDTH: 4000,
    HEIGHT: 4000,
    SPAWN_CLEAR_RADIUS: 220,
    PROP_EDGE_MARGIN: 80,
    PROP_COUNT: 140,
    PROP_MIN_SPACING: 110,
  },

  /** Atributos iniciais do jogador */
  PLAYER: {
    MAX_HP: 100,
    SPEED_PX_PER_SEC: 180,
    RADIUS: 14,
    SPAWN_X: 2000,
    SPAWN_Y: 2000,
    INVULN_DURATION_SEC: 0.8,
  },

  /** Atributos da arma inicial (usados a partir da Etapa 3) */
  PISTOL: {
    DAMAGE: 12,
    FIRE_RATE_PER_SEC: 3,
    RANGE_PX: 320,
    PROJECTILE_SPEED_PX_PER_SEC: 520,
    PROJECTILE_RADIUS: 4,
  },

  /** Tipos de zumbis (usados a partir da Etapa 3) */
  ZOMBIES: {
    COMMON: {
      HP: 30,
      SPEED_PX_PER_SEC: 70,
      CONTACT_DAMAGE: 8,
      CONTACT_COOLDOWN_SEC: 0.8,
      RADIUS: 14,
      XP: 1,
    },
    FAST: {
      HP: 18,
      SPEED_PX_PER_SEC: 120,
      CONTACT_DAMAGE: 5,
      CONTACT_COOLDOWN_SEC: 0.8,
      RADIUS: 11,
      XP: 1,
    },
    BRUTE: {
      HP: 150,
      SPEED_PX_PER_SEC: 45,
      CONTACT_DAMAGE: 20,
      CONTACT_COOLDOWN_SEC: 0.8,
      RADIUS: 22,
      XP: 5,
    },
  },

  /** Regras de spawn (usadas a partir da Etapa 3) */
  SPAWN: {
    INITIAL_RATE_PER_SEC: 0.8,
    MINUTE_GROWTH_FACTOR: 0.1,
    MAX_ALIVE: 150,
    RING_MIN_RADIUS: 580,
    RING_MAX_RADIUS: 760,
  },

  /** Progressão de XP e bônus automáticos por nível (Etapa 5): 10 + 8 * (n - 1) */
  XP: {
    BASE_XP: 10,
    LINEAR_STEP: 8,
    /** +10% de dano nos níveis pares (2, 4, 6...) */
    AUTO_DAMAGE_BONUS_PER_LEVEL: 0.1,
    /** +8% de cadência nos níveis ímpares acima de 1 (3, 5, 7...) */
    AUTO_FIRE_RATE_BONUS_PER_LEVEL: 0.08,
    /** Tempo limite (ms) para escolher um upgrade na Fase 2 antes da seleção automática */
    UPGRADE_OFFER_TIMEOUT_MS: 12000,
    /** Quantidade de cartas oferecidas por subida de nível na Fase 2 */
    UPGRADE_OPTIONS_COUNT: 3,
  },

  /** Mecânica cooperativa de reviver aliado caído (Fase 2) */
  REVIVE: {
    RADIUS_PX: 64,
    DURATION_MS: 3000,
    DECAY_RATE: 0.5,
    RESTORE_HP_RATIO: 0.5,
    INVULN_DURATION_SEC: 1.6,
  },

  /** Modo 1 — Sobrevivência por Rodadas (Etapa 1) */
  ROUNDS: {
    /** Intervalo entre rodadas para recolher recursos, curar e reparar (25 segundos) */
    INTERMISSION_DURATION_MS: 25_000,
    /** Orçamento de ameaça inicial na Rodada 1 (por jogador base) */
    BASE_THREAT_BUDGET: 18,
    /** Aumento do orçamento de ameaça a cada nova rodada */
    THREAT_BUDGET_PER_ROUND: 12,
    /** Multiplicador de orçamento para dupla (2 jogadores) */
    COOP_THREAT_MULTIPLIER: 1.5,
    /** A cada 5 rodadas ocorre uma rodada especial com inimigo de elite */
    ELITE_ROUND_INTERVAL: 5,
    /** Intervalo base (ms) entre spawns da fila da rodada */
    SPAWN_INTERVAL_BASE_MS: 420,
    /** Intervalo mínimo (ms) entre spawns em rodadas avançadas */
    SPAWN_INTERVAL_MIN_MS: 180,
    /** Custo no orçamento de ameaça por variante */
    THREAT_COST: {
      COMMON: 1,
      FAST: 2,
      BRUTE: 4,
      ELITE: 8,
    },
    /** Multiplicadores do inimigo de Elite nas rodadas especiais (múltiplas de 5) */
    ELITE_HP_MULTIPLIER: 2.2,
    ELITE_DAMAGE_MULTIPLIER: 1.5,
    ELITE_RADIUS_PX: 26,
    ELITE_XP_REWARD: 15,
  },

  /** Modo 2 — Exploração e Abrigo (Etapa 1) */
  EXPLORATION: {
    /** Quantidade inicial de zumbis comuns espalhados pelo mundo no início da exploração */
    INITIAL_AMBIENT_COUNT: 14,
    /** Limite de zumbis ambientes simultâneos fora de horda */
    MAX_AMBIENT_ALIVE: 30,
    /** Intervalo (ms) para surgimento de pequenos grupos/encontros durante a exploração */
    ENCOUNTER_INTERVAL_MS: 14_000,
    /** Tamanho mínimo e máximo dos pequenos grupos de encontro */
    ENCOUNTER_GROUP_MIN: 2,
    ENCOUNTER_GROUP_MAX: 4,
    /** Primeira horda após 8 minutos (480.000 ms) */
    FIRST_HORDE_DELAY_MS: 8 * 60 * 1000,
    /** Aviso antecipado de horda com 60 segundos (60.000 ms) de antecedência */
    HORDE_WARNING_MS: 60 * 1000,
    /** Próximas hordas aproximadamente a cada 6 minutos (360.000 ms) após encerrar a anterior */
    SUBSEQUENT_HORDE_INTERVAL_MS: 6 * 60 * 1000,
    /** Janela de recuperação após concluir uma horda (45 segundos) */
    RECOVERY_WINDOW_MS: 45 * 1000,
    /** Orçamento de ameaça da Horda #1 */
    BASE_HORDE_THREAT_BUDGET: 24,
    /** Crescimento do orçamento a cada horda subsequente */
    HORDE_THREAT_GROWTH: 14,
    /** Cadência (ms) de chegada dos inimigos durante uma horda ativa */
    HORDE_SPAWN_INTERVAL_MS: 400,
    /** Duração (ms) de um dia no ciclo de sobrevivência (4 minutos) */
    DAY_DURATION_MS: 4 * 60 * 1000,
    /** Tamanho (px) de cada setor da grade de exploração (500x500 px -> 64 setores no mapa 4000x4000) */
    SECTOR_SIZE_PX: 500,
  },

  /** Resolução lógica da câmera / viewport */
  VIEWPORT: {
    WIDTH: 960,
    HEIGHT: 540,
    MAX_DPR: 2,
  },
} as const;

/**
 * Calcula o XP necessário para avançar do nível `level` para `level + 1`.
 * Fórmula: 10 + 8 * (n - 1)
 */
export function getXpForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  return BALANCE.XP.BASE_XP + BALANCE.XP.LINEAR_STEP * (safeLevel - 1);
}
