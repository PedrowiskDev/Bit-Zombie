import type { GameEvent, WeaponId, PlayerStateSnapshot } from '@zombie-coop/shared';
import type { IWorldProvider } from '../network/WorldProvider.js';

type World = ReturnType<IWorldProvider['getRenderState']>;
const shots: Partial<Record<WeaponId, [number, number, number]>> = {
  pistol: [190, 0.12, 0.19], shotgun: [95, 0.23, 0.23],
  smg: [290, 0.08, 0.14], rifle: [135, 0.19, 0.24],
};

export class GameAudio {
  private context?: AudioContext;
  private output?: GainNode;
  private noise?: AudioBuffer;
  private listener?: PlayerStateSnapshot;
  private muted = false;
  private nextStep = 0;
  private nextGrowl = 0;
  private wasReloading = false;
  private readonly doors = new Map<number, string>();
  private shotKey = '';

  constructor() {
    try { this.muted = localStorage.getItem('bit-zombie-muted') === 'true'; } catch { /* optional storage */ }
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
  }

  private unlock = (): void => {
    if (this.muted) return;
    try {
      if (!this.context) {
        const context = new AudioContext();
        this.context = context;
        this.output = context.createGain();
        this.output.gain.value = 0.6;
        this.output.connect(context.destination);
        this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.3), context.sampleRate);
        const samples = this.noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      }
      if (this.context.state !== 'running') void this.context.resume().catch(() => {});
    } catch { /* Audio is optional on unsupported devices. */ }
  };

  toggle(): boolean {
    this.muted = !this.muted;
    if (this.output) this.output.gain.value = this.muted ? 0 : 0.6;
    if (!this.muted) this.unlock();
    try { localStorage.setItem('bit-zombie-muted', String(this.muted)); } catch { /* optional storage */ }
    return this.muted;
  }

  get isMuted(): boolean { return this.muted; }

  private play(frequency: number, duration: number, volume: number, x?: number, y?: number, noisy = false): void {
    const ctx = this.context;
    if (this.muted || ctx?.state !== 'running' || !this.output) return;
    const listener = this.listener;
    const dx = listener && x !== undefined ? x - listener.x : 0;
    const dy = listener && y !== undefined ? y - listener.y : 0;
    const distance = Math.hypot(dx, dy);
    if (distance > 700) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, dx / 260));
    gain.gain.setValueAtTime(Math.max(0.001, volume * (1 - distance / 720) ** 2), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    gain.connect(pan).connect(this.output);
    let source: AudioScheduledSourceNode;
    if (noisy && this.noise) {
      const buffer = ctx.createBufferSource();
      buffer.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = frequency * 8;
      buffer.connect(filter).connect(gain);
      buffer.onended = () => { filter.disconnect(); gain.disconnect(); pan.disconnect(); };
      source = buffer;
    } else {
      const oscillator = ctx.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.56, now + duration);
      oscillator.connect(gain);
      oscillator.onended = () => { gain.disconnect(); pan.disconnect(); };
      source = oscillator;
    }
    source.start(now);
    source.stop(now + duration);
  }

  event(event: GameEvent): void {
    switch (event.type) {
      case 'fire': {
        const key = event.tick + ':' + event.ownerId;
        if (this.shotKey === key) break;
        this.shotKey = key;
        const [frequency, duration, volume] = shots[event.weaponId ?? 'pistol'] ?? shots.pistol!;
        this.play(frequency, duration, volume, event.fromX, event.fromY, true);
        this.play(frequency, duration * 0.6, volume * 0.6, event.fromX, event.fromY);
        break;
      }
      case 'melee_swing': this.play(event.weaponId === 'bat' ? 180 : 440, 0.11, 0.13, event.x, event.y, true); break;
      case 'hit': this.play(105, 0.08, 0.12, event.x, event.y, true); break;
      case 'player_hit':
        if (event.playerId === this.listener?.id) this.play(82, 0.19, 0.16);
        break;
      case 'horde_warning': this.play(550, 0.75, 0.19); break;
      case 'horde_started': this.play(165, 0.85, 0.19); break;
      case 'horde_cleared': this.play(660, 0.6, 0.14); break;
    }
  }

  update(world: World): void {
    this.listener = world.players.find((player) => player.id === world.localPlayerId);
    const player = this.listener;
    if (!player?.alive) return;
    const now = world.elapsedMs;
    if (now >= this.nextStep && Math.hypot(player.vx, player.vy) > 15) {
      this.nextStep = now + 260;
      this.play(96, 0.09, 0.07, player.x, player.y, true);
    }
    const reloading = (player.reloadRemainingMs ?? 0) > 0;
    if (reloading !== this.wasReloading) this.play(reloading ? 530 : 770, 0.09, 0.11, player.x, player.y, true);
    this.wasReloading = reloading;
    if (now >= this.nextGrowl) {
      let nearest = 330;
      for (const zombie of world.zombies) {
        const distance = Math.hypot(zombie.x - player.x, zombie.y - player.y);
        if (zombie.hp > 0 && distance < nearest) nearest = distance;
      }
      const zombie = world.zombies.find(z => z.hp > 0 && Math.hypot(z.x - player.x, z.y - player.y) === nearest);
      if (zombie) {
        this.nextGrowl = now + 1400;
        this.play(zombie.kind === 'brute' ? 53 : 79, 0.29, 0.23, zombie.x, zombie.y);
      }
    }
    for (const door of world.structures ?? []) {
      if (door.kind !== 'map_door' && door.kind !== 'shelter_door') continue;
      const state = door.hp <= 0 ? 'broken' : door.open ? 'open' : 'closed';
      const previous = this.doors.get(door.id);
      if (previous && previous !== state) this.play(state === 'broken' ? 145 : 71, state === 'broken' ? 0.28 : 0.14, 0.2, door.x, door.y, true);
      this.doors.set(door.id, state);
    }
  }

  reset(): void {
    this.doors.clear();
    this.nextStep = this.nextGrowl = 0;
    this.wasReloading = false;
    this.shotKey = '';
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    if (this.context) void this.context.close().catch(() => {});
  }
}
