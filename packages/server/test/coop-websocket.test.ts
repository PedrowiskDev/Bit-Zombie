import { Client, type Room } from 'colyseus.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BALANCE, generateUrbanMap, type GameEvent } from '@zombie-coop/shared';
import { createGameServer } from '../src/index.js';

interface State {
  phase: string;
  tick: number;
  kills: number;
  players: Map<string, { connected: boolean; hp: number; lastProcessedSeq: number }>;
  structures: Map<string, { x: number; y: number; open: boolean; hp: number }>;
  lootContainers: Map<string, { x: number; y: number; label: string }>;
}
const options = { protocolVersion: BALANCE.PROTOCOL_VERSION };
let server: Awaited<ReturnType<typeof createGameServer>>;
let client: Client;
const rooms: Room<State>[] = [];

beforeAll(async () => {
  server = await createGameServer(0);
  client = new Client(`ws://127.0.0.1:${server.port}`);
});

afterAll(async () => {
  await Promise.allSettled(rooms.map((room) => room.leave()));
  await server?.colyseusServer.gracefullyShutdown(false);
});

function track(room: Room<State>): Room<State> {
  rooms.push(room);
  room.onMessage('events', () => {});
  return room;
}

describe('Etapa 12 — coop por WebSocket', () => {
  it('sincroniza dois jogadores, replica alertas e restaura a sessão em andamento', async () => {
    const host = track(await client.create<State>('survival', { ...options, countdownDurationMs: 250 }));
    const guest = track(await client.joinById<State>(host.roomId, options));
    await expect.poll(() => host.state.players.size).toBe(2);
    expect(host.state.tick).toBe(0);

    host.send('ready', { ready: true });
    guest.send('ready', { ready: true });
    await expect.poll(() => host.state.phase).toBe('playing');

    guest.send('input', { seq: 1, dx: 1, dy: 0, aimMode: 'manual', aimX: 1, aimY: 0 });
    await expect.poll(() => host.state.players.get(guest.sessionId)?.lastProcessedSeq).toBe(1);
    await expect.poll(() => guest.state.players.get(guest.sessionId)?.lastProcessedSeq).toBe(1);

    const ping = new Promise(resolve => guest.onMessage('danger_ping', resolve));
    host.send('danger_ping', {});
    await expect(ping).resolves.toMatchObject({ x: expect.any(Number), y: expect.any(Number), colorIndex: 0 });

    const session = guest.sessionId;
    const token = guest.reconnectionToken;
    const previousTick = host.state.tick;
    const previousHp = host.state.players.get(session)?.hp;
    guest.connection.close();
    rooms.splice(rooms.indexOf(guest), 1);
    await expect.poll(() => host.state.players.get(session)?.connected).toBe(false);

    const returned = track(await client.reconnect<State>(token));
    expect(returned.sessionId).toBe(session);
    await expect.poll(() => returned.state.players.get(session)?.connected).toBe(true);
    expect(returned.state.players.get(session)?.hp).toBe(previousHp);
    expect(returned.state.tick).toBeGreaterThan(previousTick);
    returned.send('input', { seq: 2, dx: 0, dy: 1 });
    await expect.poll(() => host.state.players.get(session)?.lastProcessedSeq).toBe(2);
  }, 12000);

  it('aceita seis jogadores e rejeita o sétimo', async () => {
    const host = track(await client.create<State>('survival', options));
    for (let i = 1; i < BALANCE.NETWORK.MAX_PLAYERS_PER_ROOM; i++) {
      track(await client.joinById<State>(host.roomId, options));
    }
    await expect.poll(() => host.state.players.size).toBe(6);
    await expect(client.joinById(host.roomId, options)).rejects.toThrow();
    expect(host.state.tick).toBe(0);
  });

  it('replica combate entre seis clientes após reconexão e confirma os comandos de cada jogador', async () => {
    const host = track(await client.create<State>('survival', { ...options, seed: 4242, countdownDurationMs: 100 }));
    const peers = [host];
    for (let i = 1; i < 6; i++) peers.push(track(await client.joinById<State>(host.roomId, options)));
    await expect.poll(() => peers.every(peer => peer.state.players.size === 6)).toBe(true);
    const events = new Map(peers.map(peer => [peer, [] as GameEvent[]]));
    for (const peer of peers) {
      peer.onMessage('events', (batch: GameEvent[]) => events.get(peer)?.push(...batch));
      peer.send('ready', { ready: true });
    }
    await expect.poll(() => peers.every(peer => peer.state.phase === 'playing')).toBe(true);
    for (const peer of peers) peer.send('input', { seq: 1, dx: 0, dy: 0, aimMode: 'auto', firing: true });
    await expect.poll(() => peers.every(peer => peers.every(source =>
      peer.state.players.get(source.sessionId)?.lastProcessedSeq === 1))).toBe(true);

    const guest = peers[5];
    const token = guest.reconnectionToken;
    guest.connection.close();
    rooms.splice(rooms.indexOf(guest), 1);
    await expect.poll(() => host.state.players.get(guest.sessionId)?.connected).toBe(false);
    const returned = track(await client.reconnect<State>(token));
    peers[5] = returned;
    expect(returned.sessionId).toBe(guest.sessionId);
    events.set(returned, []);
    returned.onMessage('events', (batch: GameEvent[]) => events.get(returned)?.push(...batch));

    // All six send ordinary gameplay inputs. The first wave starts within melee range.
    let seq = 2;
    const interval = setInterval(() => {
      for (const peer of peers) {
        peer.send('input', { seq, dx: 0, dy: 0, aimMode: 'auto', firing: true });
      }
      seq++;
    }, 50);
    try {
      await expect.poll(() => peers.every(peer => (peer.state.players.get(returned.sessionId)?.lastProcessedSeq ?? 0) >= 2)).toBe(true);
      await expect.poll(() => {
        const hit = events.get(returned)?.find(e => e.type === 'hit' && e.killed);
        return hit && peers.every(peer => events.get(peer)?.some(e => e.eventId === hit.eventId));
      }, { timeout: 22000 }).toBe(true);
      await expect.poll(() => peers.every(peer => peer.state.kills > 0)).toBe(true);
    } finally {
      clearInterval(interval);
      await Promise.allSettled(peers.map(async peer => {
        rooms.splice(rooms.indexOf(peer), 1);
        await peer.leave();
      }));
    }
  }, 30000);

  it('sincroniza a porta e a caixa da casa e rejeita clientes do layout anterior', async () => {
    const seed = 4242;
    const { house, doors } = generateUrbanMap(seed);
    const host = track(await client.create<State>('survival', { ...options, seed }));
    const guest = track(await client.joinById<State>(host.roomId, options));
    const door = doors.find(candidate => candidate.id === house?.doorId)!;
    for (const peer of [host, guest]) {
      await expect.poll(() => peer.state.structures.get(String(door.id))).toMatchObject({
        x: door.x, y: door.y, open: false, hp: door.hp,
      });
      expect(Array.from(peer.state.lootContainers.values()).find(item => item.label === 'Casa'))
        .toMatchObject(house!.supply);
    }
    await expect(client.joinById(host.roomId, { protocolVersion: BALANCE.PROTOCOL_VERSION - 1 })).rejects.toThrow();
  });
});
