export { BALANCE, getXpForLevel } from './config/balance.js';
export {
  SpatialHashGrid,
  checkCircleCollision,
  distanceBetween,
  sweepCircleCircle,
  type CircleOverlapResult,
} from './math/collision.js';
export { SeededRng } from './math/rng.js';
export {
  clampPositionToArena,
  normalizeInputVector,
  stepEntityMovement,
  type Vec2,
} from './math/vec2.js';
export {
  type AimMode,
  type BaseGameEvent,
  type ExplorationModeStateSnapshot,
  type ExplorationSubPhase,
  type GameEvent,
  type GameMode,
  type HordeClearedEvent,
  type HordeStartedEvent,
  type HordeWarningEvent,
  type InputCmd,
  type LevelUpBonusKind,
  type LevelUpEvent,
  type NetworkErrorCode,
  type PlayerDamagedEvent,
  type PlayerRevivedEvent,
  type PlayerSpawnedEvent,
  type PlayerStateSnapshot,
  type ProjectileHitEvent,
  type PropData,
  type PropKind,
  type RoomPhase,
  type RoundCompletedEvent,
  type RoundStartedEvent,
  type RoundSubPhase,
  type RoundsModeStateSnapshot,
  type TickInputMap,
  type UpgradeChosenEvent,
  type WeaponFireEvent,
  type WorldSnapshot,
  type ZombieKind,
  type ZombieStateSnapshot,
} from './types/protocol.js';
export {
  findClosestLivingPlayer,
  findClosestZombieInRange,
  resolvePlayerZombieCollisionsAndContactDamage,
  stepAutoFireWeapons,
  stepPlayerReviveMechanics,
  stepProjectilesAndHits,
  stepZombiesMovementAndSeparation,
  type PlayerManualAimInput,
  type SimulatedProjectile,
  type WeaponStatsPerPlayer,
} from './sim/combat.js';
export {
  ExplorationDirector,
  computeHordeThreatBudget,
  type ExplorationDirectorCallbacks,
  type ExplorationTimingOverrides,
  type QueuedHordeZombie,
} from './sim/directors/ExplorationDirector.js';
export {
  RoundsDirector,
  computeRoundThreatBudget,
  type QueuedRoundZombie,
  type RoundsDirectorCallbacks,
} from './sim/directors/RoundsDirector.js';
export { generateMapProps } from './sim/propsGenerator.js';
export {
  PlayerInputQueue,
  generateRoomCode,
  interpolateRemoteEntities,
  isValidRoomCode,
  lerpAngle,
  reconcileLocalPlayer,
  type TimedEntitySnapshot,
} from './sim/reconciliation.js';
export {
  computeSpawnRatePerSec,
  createZombieEntity,
  getZombieStats,
  pickRingSpawnPosition,
  pickZombieKind,
  type ZombieStatsConfig,
} from './sim/spawner.js';
export {
  ALL_UPGRADE_IDS,
  UPGRADE_CATALOG,
  computeEffectiveWeaponStats,
  getAutoBonusForLevel,
  getAutomaticUpgradesForLevel,
  isValidUpgradeId,
  rollUpgradeOptionsForPlayer,
  type AppliedUpgradeStack,
  type EffectiveWeaponStats,
  type PendingUpgradeOffer,
  type UpgradeCategory,
  type UpgradeDefinition,
  type UpgradeEffectModifiers,
  type UpgradeId,
} from './sim/upgrades.js';
export { Simulation, type SimulationOptions } from './sim/Simulation.js';
