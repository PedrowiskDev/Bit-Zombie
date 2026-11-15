import type { GameEvent, PlayerStateSnapshot } from '@zombie-coop/shared';

export type Motion = 'idle' | 'walk' | 'run' | 'shoot' | 'melee' | 'lunge' | 'hit' | 'reload' | 'fall' | 'revive';
type Reaction = 'shoot' | 'melee' | 'lunge' | 'hit';

export interface MotionCue {
  actor: string;
  action: Reaction | 'fall';
}

export function motionCues(event: GameEvent): MotionCue[] {
  switch (event.type) {
    case 'fire': return [{ actor: `player:${event.ownerId}`, action: 'shoot' }];
    case 'melee_swing': return [{ actor: `player:${event.ownerId}`, action: 'melee' }];
    case 'hit': return [{ actor: `zombie:${event.zombieId}`, action: event.killed ? 'fall' : 'hit' }];
    case 'player_hit': return [
      { actor: `zombie:${event.zombieId}`, action: 'lunge' },
      { actor: `player:${event.playerId}`, action: event.killed ? 'fall' : 'hit' },
    ];
    default: return [];
  }
}

export const REACTION_SECONDS: Record<Reaction, number> = {
  shoot: 0.23, melee: 0.33, lunge: 0.38, hit: 0.28,
};

export class CharacterMotion {
  private movement: 'idle' | 'walk' | 'run' = 'idle';
  private alive?: boolean;
  private recovery = 0;
  private reaction?: { action: Reaction; remaining: number };
  private lastCueTick = -1;

  react(action: Reaction, tick: number, ageSeconds: number): boolean {
    if (tick <= this.lastCueTick || ageSeconds >= REACTION_SECONDS[action] || this.alive === false) return false;
    if (this.reaction?.action === 'hit' && action !== 'hit') return false;
    this.lastCueTick = tick;
    this.reaction = { action, remaining: REACTION_SECONDS[action] - ageSeconds };
    return true;
  }

  get gait() {
    return this.movement;
  }

  update(
    speed: number, alive: boolean, dt: number,
    player?: Pick<PlayerStateSnapshot, 'reloadRemainingMs'>,
  ): Motion {
    if (speed > (this.movement === 'run' ? 130 : 150)) this.movement = 'run';
    else if (speed > (this.movement === 'idle' ? 10 : 5)) this.movement = 'walk';
    else this.movement = 'idle';
    if (this.alive === false && alive) this.recovery = 0.72;
    this.alive = alive;
    if (!alive) {
      this.recovery = 0;
      this.reaction = undefined;
      return 'fall';
    }
    if (this.recovery > 0) {
      this.recovery -= dt;
      return 'revive';
    }
    if (this.reaction) {
      this.reaction.remaining -= dt;
      if (this.reaction.remaining > 0) return this.reaction.action;
      this.reaction = undefined;
    }
    if ((player?.reloadRemainingMs ?? 0) > 0) return 'reload';
    return this.gait;
  }
}
