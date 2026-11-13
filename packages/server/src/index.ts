import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { BALANCE } from '@zombie-coop/shared';
import { roomRegistry } from './rooms/roomCode.js';
import { SurvivalRoom } from './rooms/SurvivalRoom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../..');

export async function createGameServer(port = Number(process.env.PORT) || 3000): Promise<{
  app: express.Express;
  httpServer: http.Server;
  colyseusServer: Server;
  port: number;
}> {
  const app = express();
  app.use(express.json());

  const httpServer = http.createServer(app);
  const colyseusServer = new Server({
    transport: new WebSocketTransport({
      server: httpServer,
    }),
  });

  colyseusServer.define('survival', SurvivalRoom);

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      stage: 4,
      protocolVersion: BALANCE.PROTOCOL_VERSION,
      tickRate: BALANCE.SIMULATION.TICK_RATE,
    });
  });

  // Endpoint de resolução de código de convite de 5 caracteres com validação de protocolo e lotação
  app.get('/api/rooms/:code', (req, res) => {
    const clientProtocol = Number(req.query.protocolVersion ?? BALANCE.PROTOCOL_VERSION);
    if (clientProtocol !== BALANCE.PROTOCOL_VERSION) {
      res.json({
        ok: false,
        errorCode: 'PROTOCOL_MISMATCH',
        message: `Versão de protocolo incompatível (cliente v${clientProtocol}, servidor v${BALANCE.PROTOCOL_VERSION}).`,
      });
      return;
    }

    const result = roomRegistry.lookup(req.params.code);
    if (!result.ok) {
      const msgMap = {
        INVALID_ROOM_CODE: 'Código inválido. Use 5 caracteres (sem O, 0, I, 1).',
        ROOM_NOT_FOUND: 'Sala não encontrada. Verifique o código de 5 caracteres.',
        ROOM_FULL: 'Esta sala privada já está cheia (2/2 jogadores).',
      } as const;

      res.json({
        ok: false,
        errorCode: result.errorCode,
        message: msgMap[result.errorCode],
      });
      return;
    }

    if (result.room.phase !== 'lobby' && result.room.phase !== 'countdown') {
      res.json({
        ok: false,
        errorCode: 'ROOM_FULL',
        message: 'A partida desta sala já está em andamento.',
      });
      return;
    }

    res.json({
      ok: true,
      room: result.room,
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';

  if (!isProd && !isTest) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: workspaceRoot,
      configFile: path.resolve(workspaceRoot, 'vite.config.ts'),
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true' ? { server: httpServer } : false,
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (isProd) {
    const clientDist = path.resolve(workspaceRoot, 'packages/client/dist');
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  await new Promise<void>((resolve) => {
    httpServer.listen(port, '0.0.0.0', () => resolve());
  });

  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  return { app, httpServer, colyseusServer, port: boundPort };
}

// Inicia automaticamente quando executado diretamente como entrypoint (`npm run dev` / `npm start`)
const isMainEntry =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainEntry) {
  createGameServer()
    .then(({ port }) => {
      console.log(`[Zombie Survival Coop] Servidor HTTP + Colyseus ativo em http://0.0.0.0:${port}`);
    })
    .catch((err) => {
      console.error('Erro fatal ao iniciar o servidor:', err);
      process.exit(1);
    });
}
