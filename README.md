# Zombie Survival Coop — Fase 1

Protótipo jogável de sobrevivência zumbi cooperativo top-down 2D para **1 a 2 jogadores** pela internet, em **PC ou celular (Retrato e Paisagem)**, direto no navegador e sem instalação.

---

## Stack e Arquitetura (`npm workspaces`)

- **`packages/shared` (`@zombie-coop/shared`)**:
  - Simulação determinística em TypeScript puro (`Simulation.step(dt, inputs)`, `getSnapshot()`, `consumeEvents()`), sem importar Phaser nem Colyseus.
  - Passo fixo de **20 Hz (`50 ms`)**, RNG determinístico (`Mulberry32`), grade espacial (`SpatialHashGrid`), reconciliação por `seq`, interpolação de entidades remotas (`100 ms`), catálogo de upgrades (`UPGRADE_CATALOG`) e balanceamento centralizado em `packages/shared/src/config/balance.ts`.
- **`packages/server` (`@zombie-coop/server`)**:
  - Servidor autoritativo Node.js + Express + Colyseus `0.16.22` (`@colyseus/schema` `3.0.76`) servindo HTTP, Vite e WebSocket na mesma porta (`PORT || 3000`).
  - Salas privadas para até 2 jogadores com códigos de 5 caracteres sem `O, 0, I, 1`, validação estrita de input (`PlayerInputQueue`, vetor limitado a `1`, fila máx. `8`, rate-limit) e janela de **20 segundos** de reconexão (jogador desconectado permanece parado e invulnerável antes de contar como morto).
- **`packages/client` (`@zombie-coop/client`)**:
  - Renderizador Phaser `3.90.0` desacoplado da origem dos dados via `IWorldProvider` (`OfflineProvider` e `OnlineProvider` com `getStateCallbacks(room)` de `"colyseus.js"`).
  - Resolução adaptativa nativa que preenche **100% da tela de cada aparelho** (sem tarjas pretas em `16:9`, `19.5:9`, `20:9`, `4:3`, Retrato ou Paisagem), mantendo a diagonal lógica constante ($\approx 1101{,}4\text{ px}$) para que zumbis nasçam sempre fora da tela (`580..760 px`).

---

## Como Executar

```bash
# 1. Instalar dependências (Node.js >= 22.12.0, npm 10.x)
npm install

# 2. Rodar verificação de tipos (TypeScript 7.0.2 nos 3 pacotes)
npm run typecheck

# 3. Rodar todas as suítes de testes unitários e de stress (Vitest 5.1.0)
npm test

# 4. Gerar build de produção (shared, server e client)
npm run build

# 5. Iniciar servidor unificado em desenvolvimento (porta 3000)
npm run dev
```

---

## Controles (PC e Mobile)

- **Movimento (8 direções normalizadas / analógico)**:
  - **PC**: `WASD` ou Setas direcionais.
  - **Mobile / Touch**: Toque e arraste na **metade esquerda da tela** (`MOVER`).
- **Modo de Disparo (Alternável no Lobby, pelo botão inferior na HUD ou tecla `M`)**:
  - **Automático (Padrão)**: mira e atira automaticamente no zumbi vivo mais próximo dentro do alcance de `320 px`.
  - **Manual (Lado Direito da Tela)**: toque e arraste na **metade direita da tela** (`MIRAR / ATIRAR`) para orientar o feixe laser tático e disparar continuamente na direção escolhida.

---

## Parâmetros de Diagnóstico na URL

- `?debug`: exibe o painel de telemetria em tempo real (FPS, ping/RTT, tick, `lastProcessedSeq`, inputs pendentes, zumbis vivos, banda `B/s` e modo de mira).
- `?lag=150`: aplica atraso artificial de `150 ms` no envio e recebimento do cliente para inspecionar a predição local e a interpolação de entidades remotas.
- `?seed=12345`: define a seed determinística inicial para partidas no modo Solo/Offline.
