# Etapa 2 · Câmera isométrica

A vista 3D usa câmera ortográfica com azimute de 45° e elevação de aproximadamente 35,3°. O acompanhamento usa a posição interpolada do jogador, amortecimento por tempo e limite de atraso de 48 unidades. O enquadramento adapta-se à proporção do viewport e aceita três níveis de zoom. O zoom na rolagem atua sobre o canvas e o botão em **Opções** funciona com mouse ou toque.

`GroundProjection` define a transformação entre mundo e tela. A mira do mouse inverte a projeção no chão. Teclado e joysticks seguem os eixos da tela, preservando intensidade analógica e o controle separado de disparo. No zoom mínimo, os cantos do chão ficam a até 490 unidades do centro. Somado ao limite de acompanhamento, o alcance fica abaixo das 580 unidades do anel de spawn regular.

No modo 3D, a câmera Phaser aplica a mesma projeção aos gráficos do chão, incluindo itens, efeitos, indicadores de vida e áreas de resgate. A névoa usa a máscara existente como textura de mundo no Three, o que permite que paredes e props sejam escurecidos conforme sua posição. Telhados são ocultados ao entrar nos prédios e paredes ou telhados do mapa que encobrem o jogador podem perder opacidade de forma gradual. A visibilidade lógica de zumbis, portas e colisões continua consultando os dados de simulação. O fallback `?renderer=2d` usa câmera vertical e a névoa pelo Phaser.

## Validação

- Vitest compara a projeção com a câmera ortográfica do Three nos três níveis de zoom e em quatro proporções, incluindo posição próxima à borda. Também cobre o limite do anel, a direção do joystick e o acompanhamento a 30, 60 e 120 Hz.
- No navegador integrado, a seed 4242 foi conferida em 360 × 800, 800 × 360, 768 × 1024, 1280 × 720 e no fallback em 1366 × 768, com DPR 1. O clique à direita do jogador em 1280 × 720 produziu direção de 45° no mundo. O botão mudou o zoom de 100% para 115%.
- Dois clientes iniciaram a mesma partida online e exibiram o tick 354. O console não mostrou erros na verificação final da apresentação.
- Toque em celular físico, GPU mobile, oclusão em todas as construções e recuperação após perda de contexto ainda precisam de validação prática.
