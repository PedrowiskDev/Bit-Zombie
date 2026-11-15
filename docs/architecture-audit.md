# Auditoria de arquitetura e evolução 2.5D

Data: 14/11/2026. Escopo: código presente no workspace, incluindo alterações ainda não commitadas. Nenhuma implementação estrutural está autorizada por este documento. A solicitação atual cobre análise, skills e AGENTS.md.

## Resultado

O jogo já possui geometria 3D, mas sua apresentação ainda é vista superior. É viável evoluir para personagens e ambientes 3D com câmera ortográfica inclinada preservando a simulação planar, o multiplayer e os modos atuais. O primeiro problema a resolver é a projeção compartilhada entre câmera, controles, névoa e elementos do mundo. Substituir a engine inteira não tem justificativa na evidência disponível.

## Stack realmente encontrada

Confirmada por imports, package.json, lockfile e `npm ls --depth=0`, não por versões descritas em documentação antiga.

| Componente | Versão instalada | Uso |
| --- | --- | --- |
| Phaser | 3.90.0 | Cenas, ciclo de frames, controles e objetos/gráficos 2D |
| Three.js / @types/three | 0.187.0 / 0.187.0 | Mundo 3D em canvas separado |
| @colyseus/core / colyseus.js | 0.16.22 / 0.16.22 | Servidor autoritativo e cliente multiplayer |
| @colyseus/schema | 3.0.76 | Estado replicado |
| @colyseus/ws-transport | 0.16.5 | WebSocket |
| Express | 4.22.3 | HTTP e integração do servidor |
| TypeScript / tsx | 7.0.2 / 4.23.15 | Tipagem, compilação e execução de desenvolvimento |
| Vite / Vitest | 8.3.8 / 5.1.0 | Build e testes Node |
| Node / npm desta auditoria | 24.21.0 / 12.0.2 | Ambiente efetivamente executado |

Three e seus tipos estão declarados com `^0.187.0`. As demais dependências diretas principais estão fixadas. Não atualizar dependências como parte da evolução visual sem necessidade demonstrada.

Em `packages/client/src/main.ts`, Phaser usa `Phaser.AUTO`, canvas transparente e antialias. O backend escolhido pelo AUTO depende do navegador e não foi inspecionado nesta auditoria. Em `packages/client/src/render/WorldRenderer3D.ts`, Three usa explicitamente `WebGLRenderer`, com antialias e preferência de baixo consumo. Normalmente haverá dois contextos gráficos quando Phaser selecionar WebGL. Não há renderizador WebGPU nem engine física 3D configurada.

## Como o jogo funciona hoje

### Simulação e rede

`packages/shared/src/sim/Simulation.ts` concentra a lógica e avança em passos de 50 ms, 20 Hz. `OfflineProvider.ts` usa acumulador e interpola snapshots. `OnlineProvider.ts` faz predição local, reconciliação por `lastProcessedSeq` e interpolação remota. `SurvivalRoom.ts` executa a simulação autoritativa, patches de 50 ms e transmite eventos de gameplay.

Há suporte a seis jogadores, mínimo de dois para início online, prontidão no lobby e reconexão de 20 segundos. Eventos e snapshots são contratos distintos. A posição visual interpolada não pode substituir a posição autoritativa no combate. Modelos, materiais e matrizes de câmera não precisam trafegar pela rede.

### Câmera, controles e camadas

`WorldRenderer3D.render()` coloca a câmera em `(view.x, 900, view.y)` e aponta para `(view.x, 0, view.y)`, com `up=(0,0,-1)`. Isso é uma câmera ortográfica vertical. O espaço lógico `(x,y)` vira `(x,altura,z=y)` no Three. A posição da câmera é reaplicada diretamente, sem amortecimento temporal próprio.

Phaser acompanha o sprite local com fatores de acompanhamento iguais a 1. `GameScene.syncViewportOrientation()` calcula a área lógica pela diagonal e adapta o buffer ao DPR. Esse redimensionamento não é qualidade adaptativa baseada no custo do frame. O Three limita DPR a 1,5 e a 1 no modo de economia manual.

`readAimInput()` converte mouse para mundo somando coordenadas lógicas a `camera.worldView`. Joystick direito fornece vetor de mira, enquanto ataque usa entrada independente. Essa conversão supõe vista superior. Uma câmera inclinada exige projeção e inversa comuns também para movimento relativo à tela, loot, barras de vida, indicadores, efeitos, construção e seleção.

O canvas Three fica sob o Phaser transparente. Névoa, loot, efeitos e parte das estruturas continuam 2D. Sprites Phaser de personagens e zumbis ainda são criados e atualizados antes de serem ocultados no modo 3D. Existe seleção de fallback `?renderer=2d` e tentativa de fallback em perda de contexto, cuja recuperação visual precisa de teste em navegador.

### Personagens e animações

Cada ator Three tem cinco meshes de primitivas, com geometria/material compartilhados. Só posição, rotação, escala e visibilidade são atualizadas. Não há carregamento de GLB/glTF, rig, AnimationMixer, caminhada articulada ou clipes de ataque, ferimento e morte. Feedback 2D inclui flashes e efeitos. O ator Three do jogador usa `alive` como visibilidade, então o corpo do jogador caído desaparece, embora haja indicadores de revive em outras camadas.

### Mapa e colisões

`urbanMap.ts` gera seis prédios retangulares por seed no mapa padrão, com portas, janelas e tipos de estabelecimento. Há pisos, paredes e telhados de primitivas, além de props como carros, arbustos e caixas. Não existe um sistema de cômodos mobiliados ou andares. O telhado simplesmente desaparece quando o jogador local entra no retângulo do prédio. Não há transparência gradual de paredes entre personagem e câmera.

Colisões são implementadas em TypeScript no shared, com círculos, segmentos, limites e testes contínuos de projéteis. `vision.ts` e estruturas fornecem flags separadas de bloqueio de movimento, visão e tiro. Janelas do mapa bloqueiam movimento, mas permitem visão e tiro. Portas abertas/destruídas alteram obstáculos. `SpatialHashGrid` ajuda na separação dos zumbis, mas não indexa automaticamente todas as consultas de obstáculos.

Esse plano físico é compatível com uma apresentação 3D inclinada. Andares transitáveis, saltos e tiros com altura física exigiriam um projeto separado de protocolo e simulação.

### IA

`zombiePerception.ts` mantém estados de vagar, investigar ruído, perseguir e procurar na última posição. A visão usa distância e linha de visão, sem teste angular de orientação do zumbi. Portanto, a percepção visual dos zumbis é omnidirecional dentro do alcance, diferente do cone direcional do jogador.

A navegação contorna retângulos de prédios e desvia localmente de props. Não é uma busca geral de caminhos por cômodos, corredores ou conjuntos de obstáculos. Diretores de rodadas/exploração e ataques especiais já existem. O limite atual é 150 zumbis vivos. Preservar esses sistemas ao melhorar a IA.

## Problemas e riscos encontrados

| Prioridade | Evidência no código | Consequência e encaminhamento |
| --- | --- | --- |
| Alta | Projeções independentes em GameScene e WorldRenderer3D | Inclinar só a câmera quebra alinhamento visual e mira. Criar adaptador de projeção antes da migração visual. |
| Alta | Fog canvas de 1024² recomposto e enviado à textura por frame, com consultas de visão para células/entidades | Candidato a custo de CPU, upload e preenchimento. Medir frequência, reaproveitar resultados e projetar máscara na geometria correta. |
| Alta | Cinco meshes por ator, sem instancing ou LOD | Até 750 meshes para 150 zumbis criados. Isso não significa 750 draw calls observadas, pois visibilidade e frustum reduzem o conjunto. Medir e agrupar repetições. |
| Alta | Corpo 3D ocultado quando jogador cai, efeitos e itens continuam 2D | Paridade visual incompleta. Preservar leitura de revive, dano, loot e combate durante cada etapa. |
| Média | GameScene concentra entrada, UI, áudio, visão e renderização em mais de 3.000 linhas | Aumenta risco de regressão. Extrair pequenos adaptadores na área alterada, preservando providers. |
| Média | Sprites ocultos continuam atualizados e providers constroem coleções de render state | Trabalho e alocações redundantes por frame. Confirmar no profiler antes de introduzir caches e invalidadores. |
| Média | IA percorre jogadores/ruídos/obstáculos e navega por retângulos | Novos interiores podem produzir zumbis presos e custo crescente. Testar rotas e escalonar percepção sem reduzir autoridade. |
| Média | Bundle único grande e duas bibliotecas gráficas | Custo de transferência, parse e memória. Medir carregamento e avaliar imports tardios sem retirar Phaser agora. |
| Média | Indicador fora da tela usa apenas o primeiro aliado encontrado | Sala aceita seis pessoas, mas esse elemento de UI ainda cobre um aliado. Incluir na regressão cooperativa. |
| Média | Sem profiling gráfico automatizado ou teste real de celular | Testes Node não demonstram FPS, bateria, compatibilidade de GPU nem comportamento touch. |

Os custos gráficos acima são riscos deduzidos do código, não gargalos comprovados por perfil de GPU. A quantidade real de draw calls, uso de memória gráfica, FPS sustentado e aquecimento ainda não foi medida.

`docs/decisions.md` é histórico. Seu ambiente Node/npm difere do atual, a afirmação de todas as versões fixas não inclui o Three com caret, e o protocolo descrito ficou menor que o protocolo existente. Seus números antigos de benchmark não são medições desta auditoria. O teste de banda atual estima inputs/eventos em JSON e não representa todo o tráfego de patches WebSocket.

## Compatibilidade e direção proposta

| Mudança | Compatibilidade | Condição |
| --- | --- | --- |
| Câmera inclinada, zoom e follow | Sem mudar protocolo | Centralizar worldToScreen/screenToGround e converter entradas, névoa e overlays juntos |
| Modelos GLB/glTF e animações | Principalmente cliente | Gameplay continua dirigido por ticks, estados e eventos existentes |
| Materiais, luz e textura | Cliente | Reutilização de recursos e perfil simples para celular |
| Instancing, LOD e resolução adaptativa | Cliente | Não alterar colisões, visibilidade lógica ou simulação online |
| Casa com cômodos e móveis sólidos | Shared + cliente + predição | Layout e colisão determinísticos, paridade servidor/offline e revisão das rotas |
| Percepção e navegação novas | Shared | Manter custos por tick e testar comportamento de gameplay |
| Altura física, múltiplos andares ou troca de engine | Estrutural | Fora da primeira migração, exige justificativa e plano específico |

Usar câmera ortográfica com inclinação fixa e modelos 3D. A projeção ortográfica mantém tamanho independente da distância. A inversão de coordenadas pode usar raycasting sobre o plano do chão. São capacidades já disponíveis em [OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html) e [Raycaster](https://threejs.org/docs/pages/Raycaster.html).

Repetições estáticas podem usar [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html), com geometria/material compatíveis. Personagens esqueléticos precisam de estratégia própria. O [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) já faz parte dos addons do Three. Verificar APIs no pacote 0.187.0 instalado antes de usar exemplos de documentação que evolui.

## Validação executada

- `npm test`: 16 arquivos e 62 testes aprovados.
- `npm run typecheck`: aprovado nos três workspaces.
- `npm run build`: aprovado, com alerta de chunk acima de 500 kB. JS principal de 2.104,72 kB minificado e 559,01 kB gzip.
- Suíte existente cobre simulação, combate, modos, visão, estruturas, IA, recursos, abrigo, hordas e WebSocket. Há reconexão com dois clientes e teste de entrada de seis/rejeição do sétimo.
- O teste de estabilidade simula cinco minutos com dois bots. Os limites de média inferior a 5 ms, p95 inferior a 15 ms e máximo inferior a 50 ms por step passaram nesta máquina. Não foi emitida nova série de tempos exatos.
- Não foram executados testes de navegador, screenshot, GPU, aparelho físico, carga de combate com seis navegadores nem testes visuais das futuras skills.

## Plano incremental proposto

Cada etapa deve terminar em uma versão jogável e comparável com a anterior. A aprovação solicitada antes de alterações estruturais vem do pedido do usuário. Este plano não inicia a implementação.

1. **Medição e contratos de apresentação.** Instrumentar custo de frame, fog, simulação, chamadas Three e memória de recursos. Definir adaptador de projeção e ownership de canvas, mantendo o visual atual. Saída: baseline em PC e celular identificado, testes de ida/volta de coordenadas e contratos de provider preservados.
2. **Câmera e controles em um cenário pequeno.** Inclinar a câmera, implementar zoom limitado e follow independente do FPS. Adaptar mira, movimento, fog, barras, loot e efeitos pela mesma projeção. Saída: alvos continuam sob a mira em retrato/paisagem, mudanças de DPR e bordas do mapa, sem expor spawns ou inimigos fora da visão.
3. **Um sobrevivente e um zumbi completos.** Introduzir GLB leve e animações de locomoção, ataque, ferimento, queda/morte e revive aplicável. Saída: estados coerentes offline/online, sem root motion autoritativo ou dano dirigido por animação.
4. **Uma casa completa.** Construir um módulo com interior, porta, janela, móveis e vegetação. Implementar oclusão de paredes/telhado e preservar bloqueios físicos. Saída: exploração e perseguição consistentes ao entrar/sair, abrir/destruir portas e construir junto à casa.
5. **Escala e qualidade adaptativa.** Expandir módulos após medir instancing, LOD de geometria/animação, resolução dinâmica e custo de sombras. Saída: cena de horda no aparelho alvo dentro do orçamento, sem variação de regras por qualidade gráfica.
6. **IA para interiores e hordas.** Melhorar busca de caminhos e percepção conforme os casos demonstrados na casa. Cone angular de zumbi é mudança de gameplay e precisa de parâmetros explícitos. Saída: rotas estáveis, audição coerente, sem atravessar sólidos e sem estourar tick.
7. **Regressão e liberação gradual.** Validar seis clientes em combate, reconexão, modos, toque, mouse, pausa offline, fullscreen e fallback. Só então avaliar redução do caminho visual antigo com justificativa e mecanismo de reversão.

### Orçamentos de trabalho propostos

Metas iniciais para calibrar após a etapa 1, sem alegação de desempenho já alcançado: celular intermediário com p95 de frame até 33,3 ms e PC de referência até 16,7 ms. Registrar modelo, navegador, resolução, DPR, qualidade, seed e contagem visível. Usar aquecimento e sessão de pelo menos cinco minutos, incluindo offline e online.

Começar investigando perfil baixo com até 200 chamadas Three por frame e 150 mil triângulos visíveis, sombras dinâmicas desligadas e DPR até 1. Esses números são hipóteses de orçamento, não limites universais. Contabilizar separadamente Phaser/composição e CPU. Ajustar com evidência. Manter os 150 zumbis e seis jogadores suportados, reduzindo detalhe visual antes de alterar gameplay.

## Skills criadas

As skills foram criadas em `C:/Users/Pedro/.codex/skills`, conforme localização padrão da skill-creator, com descrições restritas ao Bit-Zombie. Não fazem parte do Git deste repositório. Para outra máquina, copiar os sete diretórios para o diretório de skills do Codex. `AGENTS.md` registra a associação e as regras permanentes.

Os sete SKILL.md passaram no `quick_validate.py` da skill-creator e foram revisados quanto a escopo, referências, critérios e procedimentos. O validador precisou de PyYAML, instalado em diretório temporário isolado, sem alterar dependências do jogo. Isso valida a estrutura das skills, não a execução futura das funcionalidades. A comparação SHA-256 de 72 arquivos de código/configuração/testes e README confirmou que permaneceram inalterados durante a criação dos documentos.

| Skill | Responsabilidade |
| --- | --- |
| isometric-camera | Projeção, entrada, zoom, follow e oclusão visual |
| threejs-rendering | Recursos 3D, materiais, iluminação e ciclo de vida |
| mobile-optimization | Medição, instancing, LOD e qualidade adaptativa |
| character-animation | Assets esqueléticos e animação derivada do gameplay |
| zombie-ai | Percepção e navegação autoritativas |
| world-building | Layout, interiores, obstáculos e construções |
| gameplay-testing | Regressão funcional, gráfica, mobile e de rede |
