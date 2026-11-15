# Personagens piloto · Etapas 1 a 4

Execute `npm run dev` na raiz e abra `http://localhost:3000/tools/character-preview/index.html`. Os controles comparam a escala padrão da câmera com uma aproximação de 2,5× e permitem girar os modelos.

Para recriar os GLBs locais com Python e Pillow:

```powershell
py scripts/prepare-character-preview.py 'C:/Users/Pedro/Desktop/modelo 3d'
node scripts/rig-character-preview.mjs
```

Os pilotos são `sobrevimente_homem_1.glb` e `zumbi_normal.glb`, recebidos do usuário como exportações do Tripo. Os dois preservam a frente em +X e foram normalizados para 38 unidades lógicas de altura com pivô no chão. Cada variante mantém os mapas de cor, metálico/rugosidade e normal do original.

| Piloto | Triângulos | Original | 512 px | 1024 px |
| --- | ---: | ---: | ---: | ---: |
| Sobrevivente | 2.944 | 7.930.472 B | 343.808 B | 915.624 B |
| Zumbi normal | 2.916 | 8.507.600 B | 381.244 B | 1.005.492 B |

Os quatro GLBs estáticos carregaram com Meshopt no navegador integrado. A prévia mede o pivô e a altura de cada malha decodificada e foi conferida em tela estreita e a 1280 × 800.

## Animações piloto

O botão **Animações** abre os sete modelos de 512 px com 11 ossos e pesos normalizados por vértice. O gerador ajusta os pontos das articulações por modelo e adapta os dez clipes já existentes. Os sobreviventes têm locomoção, golpe, disparo, recarga, ferimento, queda e revive. Os zumbis reaproveitam locomoção, investida, ferimento e queda de morte. A altura animada é corrigida no GLB para manter contato visual com o chão.

| GLB animado | Tamanho |
| --- | ---: |
| `survivor-rig.glb` | 453.328 B |
| `survivor-female-rig.glb` | 456.620 B |
| `zombie-rig.glb` | 490.624 B |
| `zombie-fast-rig.glb` | 461.904 B |
| `zombie-spitter-rig.glb` | 523.932 B |
| `zombie-demolisher-rig.glb` | 476.232 B |
| `zombie-brute-rig.glb` | 204.308 B |

A verificação com Three amostrou 610 poses por modelo, confirmou os pesos normalizados e encontrou até 0,039 unidade lógica abaixo do chão entre quadros. A galeria carregou os sete GLBs texturizados no navegador.

## Modelos no jogo

Os modelos texturizados são o padrão no renderizador 3D em desenvolvimento e produção. Para o modo solo de Exploração com seed fixa, use `/?mode=offline&gameMode=exploration&seed=4242`.

Os sobreviventes preservam os materiais dos GLBs, usam um encaixe para o item na mão direita e mantêm a cor do jogador pelo círculo no chão. Para jogar solo com a variante feminina, acrescente `&survivor=female`. Na cooperação, os modelos alternam conforme o índice de cor do jogador.

Os modelos de zumbi correspondem aos tipos comum, rápido, cuspidor, demolidor e bruto. O arquivo do explosivo é a aparência do demolidor, que continua com o comportamento atual. Invocadores e elites usam a apresentação anterior. O cliente carrega cada GLB piloto quando um ator visível recebe a representação detalhada, reaproveitando o arquivo em todas as instâncias dessa variante.

Se o GLB texturizado falhar ou estiver ausente, o cliente usa o modelo anterior. O fallback 2D continua disponível com `renderer=2d`.

Na seed 4242, o navegador executou Rodadas e Exploração solo e em coop com dois clientes, um com 120 ms de latência simulada. Em Exploração solo, foi possível coletar a pistola, atirar enquanto o personagem andava em outra direção e iniciar a recarga. Em Rodadas solo, foi confirmado um reinício após derrota. O jogo também foi aberto em 360 × 800, 800 × 360, 768 × 1024 e 1366 × 768 com DPR 1. Os 95 testes, o typecheck e o build passaram. A verificação ainda não cobre um ciclo completo de revive online, aparelho físico, hordas sustentadas ou seis clientes gráficos.

Na etapa 4, a sobrevivente feminina coletou e disparou com a pistola em Exploração solo. Os dois sobreviventes renderizaram na mesma partida cooperativa de Rodadas. Os zumbis especiais foram inspecionados na galeria, sem uma partida que percorresse todos os tipos especiais. Os 95 testes, o typecheck e o build voltaram a passar.

Os GLBs estáticos da comparação ficam em `assets/`. Os sete GLBs animados são gerados em `public/models/` e incluídos no build. O usuário confirmou que os sete originais foram gerados após a assinatura do Tripo e autorizou o uso no jogo. [Termos do Tripo, seção 5.2.2](https://www.tripo3d.ai/terms)
