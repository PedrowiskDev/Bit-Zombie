# Etapa 1 · Projeção e referência de desempenho

## Contrato de apresentação

O Phaser continua responsável pelo ciclo de quadros, canvas interativo e elementos 2D. Após o Phaser preparar e renderizar sua câmera, a cena usa os cantos do viewport em coordenadas de mundo para estabelecer a projeção vertical do chão. O Three usa esse mesmo retângulo para o frustum e o centro da câmera. Isso alinha a geometria 3D com o seguimento, os limites e a trepidação já aplicados à névoa e aos efeitos no Phaser.

`GroundProjection` converte coordenadas lógicas, em ambas as direções, usando um retângulo na tela. A mira usa o retângulo CSS do canvas do Phaser e a última posição real do ponteiro. O indicador de aliado usa a mesma projeção. O joystick recebe explicitamente o canvas interativo, independentemente da ordem dos elementos. A perspectiva permanece vertical e os vetores de toque mantêm as regras existentes.

A cena cria e descarta o renderizador Three e a assinatura de pós-renderização. O renderizador Three possui seu canvas, contexto e recursos. O canvas é passivo para entrada, fica abaixo do Phaser e é ocultado ao perder contexto. A cena redesenha o fallback ou o 3D conforme a disponibilidade. `IWorldProvider` e o protocolo continuam iguais. O provider offline aceita um observador opcional de tempo por tick. A apresentação compartilha o estado interpolado pós-update entre áudio, efeitos, visão, loot e desenho.

## Como medir

1. Rode `npm run dev` e abra `http://localhost:3000/?debug&seed=4242&mode=offline&gameMode=exploration`. Para o cooperativo, remova `mode=offline`, crie uma sala e inicie com pelo menos dois jogadores.
2. Registre aparelho, navegador, resolução CSS, DPR, qualidade, seed, modo e zumbis totais e no campo de visão. Teste a mesma rota e carga em PC e celular. Faça aquecimento e tente manter cinco minutos de jogo ativo por condição. Registre amostras em vários momentos, incluindo cargas comparáveis de 0, 30, 75 e 150 zumbis, quando alcançáveis.
3. O painel atualiza uma vez por segundo. Registre os percentis p50, p95 e p99 da janela móvel de até 600 amostras por métrica. O intervalo usa relógio real entre quadros ativos. A CPU cliente mede o tempo decorrido entre o início da atualização e o fim da apresentação. As linhas de provider, snapshots, névoa e Three mostram custos por quadro. A simulação offline usa amostras por tick de `Simulation.step`.
4. Registre chamadas, triângulos e as contagens de recursos do Three. Use `&renderer=2d` para testar a alternativa 2D. Os contadores do Three não incluem Phaser e não medem bytes de VRAM. CPU Three inclui preparação, visibilidade e envio de comandos. Tempo de GPU exige captura separada. RX e TX são estimativas já fornecidas pelo provider online.
5. Use a página sem `?debug` durante o jogo normal. O diagnóstico exclui pausa offline, lobby, fim de jogo e aba oculta. O histórico é reiniciado ao trocar/reiniciar a partida ou redimensionar.

## Primeiras amostras

PC Windows com Core i7-10700K e GeForce RTX 3060 Ti, navegador integrado do Codex, build de desenvolvimento, seed 4242, modo exploração, qualidade padrão, DPR 1. Cada linha é uma leitura pontual da janela móvel em uma partida curta. O viewport em retrato foi executado no mesmo PC.

| Cenário | Viewport CSS | Jogadores / zumbis totais / na visão | Quadro p50 / p95 / p99 (ms) | CPU cliente p95 (ms) | Névoa p95 (ms) | CPU Three p95 (ms) | Chamadas / triângulos Three |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Offline 3D | 1366 × 768 | 1 / 13 / 1 | 7,50 / 8,00 / 8,10 | 1,40 | 0,40 | 0,30 | 24 / 376 |
| Offline 3D, retrato | 360 × 800 | 1 / 14 / 0 | 7,50 / 7,60 / 7,70 | 1,50 | 0,30 | 0,30 | 19 / 284 |
| Online 3D, convidado | 1280 × 720 | 2 / 14 / 1 | 7,40 / 8,00 / 8,10 | 1,30 | 0,30 | 0,40 | 24 / 376 |
| Offline 2D | 1280 × 720 | 1 / 13 / 1 | 7,50 / 8,00 / 8,20 | 1,20 | 0,40 | — | — |

Os pontos 3D registraram três geometrias, zero texturas e um programa no Three. O step offline teve p95 de 0,30 ms nas três leituras offline. Essas leituras têm cargas e viewports diferentes. Para quantificar um ganho, compare execuções com a mesma configuração e percurso.

## Validação e pendências

- Navegador integrado com partidas solo 3D e 2D, pausa/retomada e sala online com dois jogadores. Os clientes online exibiram o mesmo tick 122. Checados 1366 × 768, 360 × 800, 800 × 360 e 768 × 1024 com DPR 1. Clique a sudeste do personagem em 768 × 1024 resultou em orientação de 23°.
- Vitest cobre ida e volta entre mundo e tela, deslocamento do canvas e resolução de buffer dobrada. A suíte existente cobre reconexão, capacidade do lobby e 6.000 ticks de simulação com dois bots.
- Faltam uma sessão gráfica sustentada de cinco minutos por carga, celular físico identificado, toque real, combate com seis navegadores, perda/restauração de contexto induzida e medição de GPU. O benchmark Node de 6.000 ticks cobre tempo simulado e não substitui a sessão gráfica.
