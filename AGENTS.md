# Regras do Bit-Zombie

## Escopo e fontes

O objetivo é apresentação 2.5D com personagens, zumbis e ambiente 3D, câmera ortográfica inclinada e prioridade para navegadores de celulares intermediários. Consulte `docs/architecture-audit.md` para o diagnóstico de 14/11/2026 e o plano. Esse documento distingue o que existe do que está proposto. Revalide versões e trechos relevantes antes de implementar. `docs/decisions.md` contém histórico parcialmente desatualizado.

A solicitação de auditoria autoriza documentação e criação de skills. Aguarde aprovação do usuário antes de iniciar a migração estrutural descrita no plano. Uma aprovação posterior vale para o escopo aprovado, sem exigir reconfirmação de cada edição rotineira.

## Arquitetura

- Preserve o monorepo npm com `packages/shared`, `packages/server` e `packages/client`. Não reescreva o jogo nem troque Phaser, Three ou Colyseus sem problema demonstrado, alternativa avaliada e plano de compatibilidade.
- Mantenha shared livre de DOM, Phaser e Three. Gameplay, colisão, IA e geração lógica pertencem à simulação compartilhada. Servidor e offline devem usar as mesmas regras.
- Preserve passo fixo de 50 ms, validação de inputs, sequência/ack, predição, reconciliação e interpolação. Renderização e qualidade gráfica não alteram velocidade, dano, hitboxes ou tempo de simulação.
- Preserve `IWorldProvider`/`RenderWorldState` como fronteira de apresentação. Evolua em módulos pequenos e evite adicionar responsabilidades gráficas à `Simulation` ou novas responsabilidades extensas à `GameScene`.
- Mantenha `(x,y)` como coordenadas lógicas e use `(x,altura,z=y)` na apresentação Three. Centralize escala, convenção angular e projeção/inversa. Física vertical, andares transitáveis e root motion autoritativo exigem escopo separado.
- Câmera isométrica é projeção de geometria 3D. Arte com sprites pré-renderizados não satisfaz a direção visual solicitada.

## Compatibilidade de gameplay

- Preserve seis jogadores, fluxo do lobby, reconexão, modos de rodadas/exploração, inventário, recarga, loot, progressão, revive, recursos, abrigo, portas e hordas.
- Preserve mira e disparo independentes no touch, controles de PC, tela cheia e pausa apenas offline. Lobby offline não deve avançar a simulação. Menu local online não pausa a sala.
- Projeção nova deve adaptar mouse, joysticks, fog, efeitos, barras, loot, construção e indicadores juntos. DPR não pode mudar coordenadas lógicas. Zoom não pode expor spawns antes ocultos nem ampliar visão autoritativa inadvertidamente.
- Transparência visual de uma parede não muda seus bloqueios de visão, movimento ou projétil. Preserve distinção entre cenário explorado e inimigos atualmente visíveis.
- Não use colisão das malhas GLB como fonte física independente. Layouts sólidos, portas e móveis usam dados compartilhados por cliente, predição, servidor e offline.
- Alterações no protocolo exigem atualização coordenada de tipos shared, Schema, cópia do servidor, parser/provider e testes. Não envie skeletons, matrizes ou frames de animação pela rede.
- Preserve fallback 2D enquanto a migração não demonstrar paridade. Não o remova implicitamente numa melhoria visual.

## Desempenho e recursos

- Meça antes e depois na mesma seed, carga e aparelho. Distingua tempo de simulação, CPU de renderização, GPU, composição e rede. FPS em PC e testes Node não comprovam desempenho mobile.
- Metas iniciais propostas: p95 até 33,3 ms/frame no celular alvo e até 16,7 ms no PC de referência. Calibre orçamento de draw calls/triângulos após baseline, usando os valores experimentais da auditoria como ponto de partida.
- Preserve os limites atuais de 150 zumbis e seis jogadores. Otimize apresentação antes de mudar limites de gameplay.
- Reutilize geometria, materiais e texturas. Considere instancing por material/geometria e região para props repetidos. Não pressuponha instancing convencional para esqueletos independentes.
- Use LOD e escalonamento de animação com base em tamanho projetado/visibilidade. Em câmera ortográfica, distância por si só não determina tamanho aparente.
- Perfil mobile básico deve funcionar sem pós-processamento caro e sombras dinâmicas. Resolução adaptativa precisa de histerese, limites e opção manual, sem alterar alcance visual ou input.
- Defina ownership e descarte de recursos, mixers e listeners. Evite carregar assets/criar materiais no loop de frame. Teste reinício, reconexão, perda/restauração de contexto e alternância de qualidade.
- Consulte APIs da versão instalada. Não adicione física 3D, framework UI ou biblioteca de navegação sem necessidade técnica identificada. Não atualize lockfile em tarefas de documentação.

## Validação e entrega

- Para código, execute checks pertinentes. Integrações estruturais exigem `npm test`, `npm run typecheck` e `npm run build`. Não escreva testes que apenas repitam a implementação.
- Câmera/renderização exigem também navegador e comparação visual. Use retrato e paisagem mobile, tablet e PC, múltiplos DPRs e touch/mouse. Registre o que não pôde ser validado.
- Mudanças de rede ou gameplay exigem testes de regressão correspondentes, incluindo reconexão e limite de sala. Teste de seis entradas no lobby não equivale a seis clientes renderizando uma horda.
- Preserve alterações pré-existentes no workspace. Relate arquivos alterados, comportamento, evidência e limitações. Não declare testes físicos ou benchmarks que não foram executados.

## Skills específicas

Instaladas no perfil local do Codex, em `C:/Users/Pedro/.codex/skills`. Abra a skill relevante ao trabalho solicitado. Em outra máquina, localize-a no diretório de skills configurado. Se ausente, informe a ausência e use as regras deste arquivo sem fingir ter lido a skill.

- [isometric-camera](C:/Users/Pedro/.codex/skills/isometric-camera/SKILL.md) — projeção, câmera, input e oclusão.
- [threejs-rendering](C:/Users/Pedro/.codex/skills/threejs-rendering/SKILL.md) — recursos e apresentação 3D.
- [mobile-optimization](C:/Users/Pedro/.codex/skills/mobile-optimization/SKILL.md) — profiling e qualidade.
- [character-animation](C:/Users/Pedro/.codex/skills/character-animation/SKILL.md) — modelos e animações.
- [zombie-ai](C:/Users/Pedro/.codex/skills/zombie-ai/SKILL.md) — percepção e navegação.
- [world-building](C:/Users/Pedro/.codex/skills/world-building/SKILL.md) — interiores, props e construções.
- [gameplay-testing](C:/Users/Pedro/.codex/skills/gameplay-testing/SKILL.md) — testes de comportamento e compatibilidade.
