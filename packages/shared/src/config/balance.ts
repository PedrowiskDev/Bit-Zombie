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

  /** Atributos de referência da pistola (mantido para compatibilidade e referência base) */
  PISTOL: {
    DAMAGE: 12,
    FIRE_RATE_PER_SEC: 3,
    RANGE_PX: 320,
    PROJECTILE_SPEED_PX_PER_SEC: 520,
    PROJECTILE_RADIUS: 4,
  },

  /** Catálogo centralizado de armas (Etapa 3 — Começar com faca e encontrar armas) */
  WEAPONS: {
    KNIFE: {
      ID: 'knife',
      NAME: 'Faca Tática',
      ROLE: 'Emergência e ataques silenciosos',
      CATEGORY: 'melee',
      DAMAGE: 18,
      FIRE_RATE_PER_SEC: 3.125,
      RANGE_PX: 56,
      ARC_DEG: 95,
      WINDUP_MS: 50,
      ACTIVE_MS: 100,
      RECOVERY_MS: 150,
      KNOCKBACK_PX: 26,
      PELLETS: 1,
      SPREAD_DEG: 0,
      PIERCE_COUNT: 0,
      PROJECTILE_SPEED_PX_PER_SEC: 0,
      PROJECTILE_RADIUS: 0,
      AMMO_TYPE: 'none',
      MAG_SIZE: 0,
      RELOAD_MS: 0,
      NOISE_RADIUS_PX: 45,
    },
    BAT: {
      ID: 'bat',
      NAME: 'Bastão Reforçado',
      ROLE: 'Maior alcance e empurrão',
      CATEGORY: 'melee',
      DAMAGE: 26,
      FIRE_RATE_PER_SEC: 2.4,
      RANGE_PX: 78,
      ARC_DEG: 112,
      WINDUP_MS: 90,
      ACTIVE_MS: 100,
      RECOVERY_MS: 220,
      KNOCKBACK_PX: 48,
      PELLETS: 1,
      SPREAD_DEG: 0,
      PIERCE_COUNT: 0,
      PROJECTILE_SPEED_PX_PER_SEC: 0,
      PROJECTILE_RADIUS: 0,
      AMMO_TYPE: 'none',
      MAG_SIZE: 0,
      RELOAD_MS: 0,
      NOISE_RADIUS_PX: 80,
    },
    PISTOL: {
      ID: 'pistol',
      NAME: 'Pistola 9mm',
      ROLE: 'Arma de fogo versátil',
      CATEGORY: 'firearm',
      DAMAGE: 12,
      FIRE_RATE_PER_SEC: 3,
      RANGE_PX: 320,
      ARC_DEG: 0,
      WINDUP_MS: 0,
      ACTIVE_MS: 0,
      RECOVERY_MS: 0,
      KNOCKBACK_PX: 0,
      PELLETS: 1,
      SPREAD_DEG: 3,
      PIERCE_COUNT: 0,
      PROJECTILE_SPEED_PX_PER_SEC: 520,
      PROJECTILE_RADIUS: 4,
      AMMO_TYPE: 'light',
      MAG_SIZE: 12,
      RELOAD_MS: 1100,
      NOISE_RADIUS_PX: 320,
    },
    SHOTGUN: {
      ID: 'shotgun',
      NAME: 'Escopeta Cal. 12',
      ROLE: 'Forte a curta distância',
      CATEGORY: 'firearm',
      DAMAGE: 11,
      FIRE_RATE_PER_SEC: 1.25,
      RANGE_PX: 230,
      ARC_DEG: 0,
      WINDUP_MS: 0,
      ACTIVE_MS: 0,
      RECOVERY_MS: 0,
      KNOCKBACK_PX: 22,
      PELLETS: 5,
      SPREAD_DEG: 6.5,
      PIERCE_COUNT: 0,
      PROJECTILE_SPEED_PX_PER_SEC: 490,
      PROJECTILE_RADIUS: 4,
      AMMO_TYPE: 'shells',
      MAG_SIZE: 6,
      RELOAD_MS: 1500,
      NOISE_RADIUS_PX: 460,
    },
    SMG: {
      ID: 'smg',
      NAME: 'Submetralhadora',
      ROLE: 'Alta cadência e consumo de munição',
      CATEGORY: 'firearm',
      DAMAGE: 8,
      FIRE_RATE_PER_SEC: 8.5,
      RANGE_PX: 290,
      ARC_DEG: 0,
      WINDUP_MS: 0,
      ACTIVE_MS: 0,
      RECOVERY_MS: 0,
      KNOCKBACK_PX: 5,
      PELLETS: 1,
      SPREAD_DEG: 5.5,
      PIERCE_COUNT: 0,
      PROJECTILE_SPEED_PX_PER_SEC: 540,
      PROJECTILE_RADIUS: 3.5,
      AMMO_TYPE: 'light',
      MAG_SIZE: 28,
      RELOAD_MS: 1350,
      NOISE_RADIUS_PX: 380,
    },
    RIFLE: {
      ID: 'rifle',
      NAME: 'Rifle de Precisão',
      ROLE: 'Precisão e alcance',
      CATEGORY: 'firearm',
      DAMAGE: 34,
      FIRE_RATE_PER_SEC: 1.6,
      RANGE_PX: 440,
      ARC_DEG: 0,
      WINDUP_MS: 0,
      ACTIVE_MS: 0,
      RECOVERY_MS: 0,
      KNOCKBACK_PX: 18,
      PELLETS: 1,
      SPREAD_DEG: 1,
      PIERCE_COUNT: 1,
      PROJECTILE_SPEED_PX_PER_SEC: 680,
      PROJECTILE_RADIUS: 4.5,
      AMMO_TYPE: 'heavy',
      MAG_SIZE: 8,
      RELOAD_MS: 1600,
      NOISE_RADIUS_PX: 500,
    },
  },

  /** Regras de Loot no chão, recipientes pesquisáveis e munição (Etapa 3) */
  LOOT: {
    PICKUP_RADIUS_PX: 54,
    CONTAINER_INTERACT_RADIUS_PX: 68,
    STARTING_RESERVE: {
      LIGHT: 12,
      SHELLS: 4,
      HEAVY: 2,
    },
    AMMO_PACK_AMOUNT: {
      LIGHT: 16,
      SHELLS: 6,
      HEAVY: 6,
    },
    WORLD_GROUND_ITEMS_COUNT: 10,
    WORLD_CONTAINERS_COUNT: 8,
    STARTER_RING_MIN_RADIUS: 130,
    STARTER_RING_MAX_RADIUS: 220,
    STARTER_SLOW_ZOMBIE_SPEED_FACTOR: 0.72,
  },

  /** Recursos de sobrevivência, cura e suprimentos (Etapa 4 — Abrigo, Recursos e Fortificação) */
  SURVIVAL: {
    STARTING_WOOD: 4,
    STARTING_SCRAP: 2,
    STARTING_MEDKITS: 1,
    MEDKIT_HEAL_HP: 45,
    CONTAINER_BONUS_WOOD: 3,
    CONTAINER_BONUS_SCRAP: 2,
    WAVE_BONUS_WOOD: 2,
    WAVE_BONUS_SCRAP: 1,
  },

  /** Catálogo de fortificações, barricadas, armadilhas e reparo (Etapa 4) */
  STRUCTURES: {
    BUILD_OFFSET_PX: 52,
    REPAIR_RADIUS_PX: 78,
    REPAIR_WOOD_COST: 1,
    REPAIR_HP_AMOUNT: 90,
    ZOMBIE_ATTACK_INTERVAL_MS: 800,
    MAX_STRUCTURES: 48,
    WOOD_BARRICADE: {
      KIND: 'wood_barricade',
      NAME: 'Barricada de Madeira',
      WOOD_COST: 2,
      SCRAP_COST: 0,
      MAX_HP: 180,
      RADIUS_PX: 20,
      BLOCKS_MOVEMENT: true,
    },
    SCRAP_BARRICADE: {
      KIND: 'scrap_barricade',
      NAME: 'Barricada Reforçada',
      WOOD_COST: 2,
      SCRAP_COST: 2,
      MAX_HP: 320,
      RADIUS_PX: 22,
      BLOCKS_MOVEMENT: true,
    },
    SPIKE_TRAP: {
      KIND: 'spike_trap',
      NAME: 'Armadilha de Espinhos',
      WOOD_COST: 1,
      SCRAP_COST: 1,
      MAX_HP: 140,
      RADIUS_PX: 22,
      BLOCKS_MOVEMENT: false,
      DAMAGE_PER_TICK: 14,
      TICK_INTERVAL_MS: 500,
      SELF_WEAR_PER_HIT: 14,
      SLOW_MULTIPLIER: 0.55,
    },
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

  /** Campo de visão direcional orientado pela mira e Fog of War (Etapa 2) */
  VISION: {
    /** Abertura angular total do cone de visão em graus */
    CONE_ANGLE_DEG: 110,
    /** Alcance máximo do cone de visão em pixels */
    RANGE_PX: 480,
    /** Percepção imediata de proximidade corporal (desde que sem parede no meio) */
    CLOSE_SENSE_RADIUS_PX: 32,
    /** Tamanho de cada célula da malha de exploração (4000 / 80 = 50x50 células) */
    FOG_CELL_SIZE_PX: 80,
    /** Quantidade de raios lançados para compor o cone de visão recortado por obstáculos */
    RAY_COUNT: 96,
  },

  /** Resolução lógica da câmera / viewport */
  VIEWPORT: {
    WIDTH: 960,
    HEIGHT: 540,
    MAX_DPR: 3,
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
