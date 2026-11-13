# Registro de Decisões Arquiteturais e Técnicas (`docs/decisions.md`)

Este documento registra as decisões de arquitetura, contratos de protocolo, compatibilidade de dependências e métricas de desempenho do projeto **Zombie Survival Coop — Fase 1**.

---

## 1. Ambiente, Validação de Dependências e Versões Exatas

### Ambiente Reprodutível Validado
- **Node.js**: `v22.23.2` (compatível com a faixa `>=22.12.0` exigida por `vite@8.3.8` e `vitest@5.1.0`).
- **npm**: `10.9.8` (com suporte nativo a `workspaces` e geração de `package-lock.json` v3 sem uso de `--force` ou `--legacy-peer-deps`).
- **Como reproduzir o ambiente**:
  1. Utilizar Node.js `22.x` (`>=22.12.0`) e npm `10.x`.
  2. Executar `npm ci` (ou `npm install` quando atualizando o lockfile) na raiz do monorepo.
  3. As referências entre pacotes internos utilizam `"@zombie-coop/shared": "0.1.0"`, que é a sintaxe padrão suportada pelo npm workspaces (diferente do prefixo `workspace:*` exclusivo de pnpm/Yarn).

### Matriz de Dependências Verificada (`dependencies`, `peerDependencies` e `engines`)
Todas as dependências diretas são fixadas com versões exatas (sem `^` ou `~`):

| Pacote | Versão Exata | Verificação de Compatibilidade (`engines` / `peerDependencies`) |
| :--- | :--- | :--- |
| `typescript` | `7.0.2` | Testado diretamente com `--experimentalDecorators` e `--useDefineForClassFields false`. Compila decoradores legados de propriedade (`@type`) sem erros. |
| `vite` | `8.3.8` | Requer `node: "^20.19.0 \|\| >=22.12.0"`. Todas as `peerDependencies` são marcadas como opcionais em `peerDependenciesMeta`. |
| `vitest` | `5.1.0` | **Correção em relação ao rascunho da Etapa 1**: `vitest@3.2.7` exige `"vite": "^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0-0"`, incompatível com `vite@8.3.8`; e `vitest@4.1.12` aciona erro no `@npmcli/arborist` do npm `10.9.8` (`Cannot read properties of null (reading 'edgesOut')`) ao resolver peers opcionais `@vitest/browser-*` contra `vitest@*`. Já `vitest@5.1.0` resolve a árvore e gera `package-lock.json` v3 de forma limpa sem `--force` ou `--legacy-peer-deps`. |
| `phaser` | `3.90.0` | Última versão estável da linha 3 (`Phaser 3`), mantendo a major 3 conforme exigido. |
| `@colyseus/core` | `0.16.22` | Requer `node: ">= 18.x"` e `peerDependencies: { "@colyseus/schema": "^3.0.0" }`. |
| `@colyseus/ws-transport` | `0.16.5` | Requer `peerDependencies: { "@colyseus/core": "0.16.x" }`. |
| `@colyseus/schema` | `3.0.76` | Atende exatamente ao peer `@colyseus/schema: "^3.0.0"` de `@colyseus/core@0.16.22` e `colyseus.js@0.16.22`. Exige `experimentalDecorators: true` e `useDefineForClassFields: false` no `tsconfig`. |
| `colyseus.js` | `0.16.22` | SDK cliente oficial da linha 0.16, contendo `getStateCallbacks(room)` e dependendo internamente de `@colyseus/schema@^3.0.0`. |
| `express` | `4.22.3` | Servidor HTTP base para compartilhar a porta única (`PORT`, padrão `3000`) entre o transporte WebSocket e os arquivos do cliente. |
| `tsx` | `4.23.15` | Executor TypeScript para desenvolvimento (`npm run dev`). |

---

## 2. Padronização dos Callbacks do Colyseus 0.16

Para evitar qualquer mistura entre a API de callbacks direta das versões antigas (`0.14`/`0.15`) e a API recomendada na linha `0.16`:
- No cliente (`packages/client`), todos os listeners de estado do Schema usarão exclusivamente o helper **`getStateCallbacks(room)`** importado de `"colyseus.js"`:
  ```ts
  import { Client, Room, getStateCallbacks } from 'colyseus.js';

  const $ = getStateCallbacks(room);
  $(room.state).players.onAdd((player, sessionId) => {
    $(player).onChange(() => {
      // Atualiza buffer de interpolação ou reconciliação
    });
  });
  ```
- Fica **proibido** chamar `room.state.players.onAdd(...)` ou `player.onChange(...)` diretamente na instância do estado.

---

## 3. Especificação do Protocolo de Movimento, Relógio e Reconciliação

### Significado de `seq` e Passo Fixo de 50 ms (20 Hz)
- A simulação avança a uma taxa fixa de **20 Hz** (`TICK_RATE = 20`, `TICK_DT_MS = 50` ms, `TICK_DT_SEC = 0.05` s).
- Cada comando de entrada `InputCmd` possui o formato `{ seq: number, dx: number, dy: number }`:
  - `seq` é um inteiro positivo monotônico crescente por jogador (`1, 2, 3, ...`), onde cada incremento de `1` representa a intenção de direção do jogador para **exatamente um passo fixo de 50 ms** da simulação.
  - O cliente **nunca** informa delta de tempo (`dt`) nem posição; a duração física aplicada por passo na simulação é sempre a constante `TICK_DT_SEC = 0.05` s.

### Relógio Autoritativo do Servidor vs. Taxa de Mensagens do Cliente
- A simulação avança **exclusivamente pelo relógio do servidor** (ou pelo acumulador fixo de 50 ms no `OfflineProvider`), executando `Simulation.step(50, inputsDoTick)` uma vez a cada 50 ms.
- Enviar mais mensagens pela rede **nunca** executa passos extras de movimento para um jogador. Em cada tick do servidor, cada jogador move-se no máximo uma vez (`1 passo de 50 ms`).

### Tratamento de Comandos Duplicados, Atrasados, Ausentes ou Fora de Ordem
1. **Validação de Entrada**:
   - `seq` deve ser inteiro seguro (`Number.isSafeInteger(seq) && seq > 0`).
   - `dx` e `dy` devem ser números finitos (`Number.isFinite`). Se `Math.hypot(dx, dy) > 1`, o vetor é normalizado na simulação para comprimento `1` (impedindo ganho de velocidade na diagonal ou via pacotes adulterados).
2. **Duplicados ou Atrasados (`seq <= lastProcessedSeq`)**:
   - São descartados silenciosamente pelo servidor antes de entrar na fila do jogador.
3. **Fora de Ordem**:
   - A fila de entrada por jogador no servidor é mantida ordenada por `seq` crescente (inserção ordenada ou descarte se já existir o mesmo `seq`).
4. **Limite de Fila e Rate Limit**:
   - Cada jogador possui um buffer de entrada no servidor limitado a no máximo `MAX_INPUT_QUEUE = 8` comandos pendentes (~400 ms). Se a fila estiver cheia, novos comandos acima do limite ou rajadas acima do rate limit descartam o comando mais antigo ou rejeitam o excesso, impedindo acúmulo de vantagem ou exaustão de memória.
5. **Comandos Ausentes (Starvation / Jitter de Rede)**:
   - Quando o relógio do servidor dispara um tick de 50 ms:
     - Se houver ao menos um comando na fila do jogador com `seq > lastProcessedSeq`, o servidor retira **um único** comando (o de menor `seq`), aplica o deslocamento de 50 ms e atualiza `lastProcessedSeq = cmd.seq`.
     - Se a fila estiver vazia naquele tick, o jogador executa o passo de 50 ms com vetor `(0, 0)` (parado) e `lastProcessedSeq` **permanece inalterado**.

### Quando `lastProcessedSeq` Avança e Como o Cliente Reconcilia
- `lastProcessedSeq` avança **somente** quando um comando `{ seq, dx, dy }` daquele jogador é efetivamente consumido em um tick de 50 ms da simulação.
- **Reconciliação no Cliente**:
  1. Ao gerar um comando local no passo fixo de 50 ms, o cliente incrementa `seq`, adiciona `{ seq, dx, dy }` à lista `pendingInputs` (limitada a `MAX_PENDING_INPUTS = 64`) e aplica imediatamente o passo de predição local.
  2. Ao receber o estado confirmado do servidor contendo `(serverX, serverY, lastProcessedSeq)`:
     - O cliente descarta todos os itens de `pendingInputs` com `input.seq <= lastProcessedSeq`.
     - Parte da posição autoritativa `(serverX, serverY)` e reaplica em ordem todos os comandos restantes em `pendingInputs` (`input.seq > lastProcessedSeq`), usando a mesma função pura de movimento e colisão com limites do mapa de `packages/shared`.

### Separação entre Simulação (20 Hz) e Renderização (60+ Hz)
- A simulação avança em passos discretos de **50 ms (20 Hz)**.
- A cena Phaser renderiza na taxa nativa do monitor (**60 Hz ou mais**).
- Para evitar que o jogador local aparente "pular" a 20 quadros por segundo:
  - O provider mantém a posição do tick anterior (`prevX`, `prevY`) e a posição pós-tick atual (`currX`, `currY`), além do acumulador de tempo `accumulatorMs` (`0 <= accumulatorMs < 50`).
  - A cada frame de renderização, calcula `alpha = Math.min(1, accumulatorMs / 50)` e fornece à cena a posição interpolada `renderX = prevX + (currX - prevX) * alpha`, `renderY = prevY + (currY - prevY) * alpha`.

---

## 4. Contratos de Eventos, Tempo dos Snapshots e Interpolação

### Separação entre Estado Persistente e Eventos Transitórios
- **Estado Persistente (`WorldSnapshot`)**:
  - Representa a fotografia completa do mundo após um tick: `tick` (inteiro monotônico da simulação, iniciando em `0`), `elapsedMs` (`tick * 50`), `seed`, `players`, `zombies` (Etapa 3+), `props` e métricas de partida.
  - **`Simulation.getSnapshot()` é uma operação de leitura pura (sem efeitos colaterais)**: chamá-la múltiplas vezes no mesmo tick retorna o mesmo estado sem limpar filas.
- **Eventos Transitórios (`GameEvent`)**:
  - Representam acontecimentos pontuais ocorridos durante um tick (ex.: `fire`, `hit`, `kill`, `levelup` a partir da Etapa 3).
  - Todo evento possui `{ eventId: number, tick: number, type: string, ... }`, onde `eventId` é um inteiro único e estritamente crescente dentro da partida (`1, 2, 3, ...`).
  - **`Simulation.consumeEvents()`** é o método explícito que retorna e esvazia a fila de eventos acumulados desde o último consumo.
  - **Regra de Consumo Único no Cliente**: o cliente registra `lastConsumedEventId` e ignora qualquer evento recebido cujo `eventId <= lastConsumedEventId`, garantindo que efeitos visuais/sonoros nunca sejam disparados duas vezes.

### Estimativa de Tempo do Servidor e Interpolação de Entidades Remotas (Etapa 4)
- Cada snapshot recebido pelo cliente carrega o `tick` autoritativo da simulação (`serverTimeMs = tick * 50`).
- O cliente mantém uma estimativa contínua do relógio do servidor e aplica um atraso de interpolação `INTERP_DELAY_MS = 100` ms (equivalente a 2 ticks de 50 ms).
- No instante de renderização `renderServerTime = estimatedServerTimeMs - INTERP_DELAY_MS`, o cliente localiza no buffer os dois snapshots consecutivos $S_0$ e $S_1$ tais que $S_0.\text{time} \le \text{renderServerTime} \le S_1.\text{time}$ e interpola linearmente as posições do outro jogador e dos zumbis.

---

## 5. Metas de Desempenho, Grade Espacial e Metodologia de Medição

### Metas a Medir (Não Garantias A Priori)
- **FPS**: meta de 60 FPS em desktop e ao menos 30 FPS em celular intermediário com dezenas de zumbis ativos. (Nota: testes em emulação de viewport em headless browser validam apenas layout e fluxo funcional, não substituindo medição em hardware mobile físico).
- **Banda de Rede**: bytes por segundo (`B/s`) enviados e recebidos por jogador serão medidos em tempo real no cliente/servidor (exibidos via `?debug` na Etapa 4 e consolidados no teste de 5 minutos com bots headless na Etapa 7).
- **Memória e Tempo de Tick**: duração do `Simulation.step()` em milissegundos e uso de heap Node.js serão coletados no teste de 5 minutos da Etapa 7.

### Comportamento da Grade Espacial (Spatial Hash Grid)
- A partir da Etapa 3, a separação suave entre zumbis utilizará uma grade espacial uniforme para reduzir comparações par-a-par quando os zumbis estão distribuídos pelo anel de aproximação.
- **Limitação conhecida**: quando muitas entidades se concentram na mesma célula ou em células adjacentes (ex.: dezenas de zumbis cercando o mesmo jogador), o custo local dentro daquelas células ainda se aproxima de comportamento quadrático $O(k^2)$. Por isso, o número máximo de zumbis vivos é limitado em `balance.ts` (`MAX_ALIVE = 150`) e o número de iterações de relaxamento por tick é fixo.

---

## 6. Resultados Medidos na Etapa 7 e Decisões Adicionais (Etapas 5–7)

### Modo de Tiro Automático vs. Manual (Twin-Stick no Lado Direito)
- O comando `InputCmd` foi estendido de forma retrocompatível com `{ aimMode?: 'auto' | 'manual', aimX?: number, aimY?: number, firing?: boolean }`:
  - **`auto` (Padrão)**: dispara automaticamente no zumbi vivo mais próximo dentro de `320 px`.
  - **`manual` (Lado Direito da Tela)**: a metade esquerda da tela controla o movimento (`MOVER`) e a metade direita controla o vetor de mira e disparo (`MIRAR / ATIRAR`), com linha guia tática a laser até `320 px`.
  - No servidor (`PlayerInputQueue`), o vetor `(aimX, aimY)` é validado e normalizado para comprimento unitário `(1.0)`, impedindo vetores inválidos (`NaN`/`Infinity`).

### Resolução Adaptativa Nativa por Aparelho (Zero Tarjas Pretas)
- `GameScene.syncViewportOrientation()` calcula a resolução lógica `(targetW, targetH)` preservando exatamente a razão de aspecto da janela (`window.innerWidth / window.innerHeight`) e mantendo a diagonal lógica constante ($\sqrt{960^2 + 540^2} \approx 1101{,}4\text{ px}$, meia-diagonal $\approx 550{,}7\text{ px} < 580\text{ px}$ do anel de spawn).
- Isso garante preenchimento de `100%` da tela sem faixas pretas em qualquer proporção (`16:9`, `19.5:9`, `20:9`, `4:3`, Retrato ou Paisagem), sem permitir que zumbis nasçam dentro da área visível e sem vantagem de campo de visão entre jogadores.

### Benchmark Medido — Simulação Contínua de 5 Minutos (6.000 Ticks a 20 Hz com 2 Bots Coop)
Executado em `packages/shared/test/stabilization.test.ts` (Node.js `v22.23.2`, Vitest `5.1.0`):
- **Duração simulada**: `300.000 ms` (`6.000 ticks` de `50 ms` com 2 bots ativos alternando mira automática e manual).
- **Tempo total de CPU para 6.000 ticks**: `~1,23 s` a `~1,60 s` em execução single-thread (`avgStepMs` $\approx 0{,}20\text{ ms} - 0{,}26\text{ ms}$ por tick de `50 ms`, utilizando menos de `0,6%` do orçamento de `50 ms` por tick).
- **Teto de entidades**: o número de zumbis vivos manteve-se estritamente $\le 150$ (`BALANCE.SPAWN.MAX_ALIVE`) em todos os 6.000 ticks.
- **Banda de comandos e eventos**:
  - Entrada (`InputCmd` a 20 Hz por jogador): $< 1{,}8\text{ KB/s}$ por jogador.
  - Eventos transitórios (`fire`, `hit`, `level_up`): $< 4{,}5\text{ KB/s}$ médios na partida.

