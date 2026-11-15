# Etapa 3 · Personagens animados

O sobrevivente tem mochila, jaqueta na cor do jogador e uma representação simples do item equipado. O zumbi tem postura, pele e movimentos próprios. As variantes existentes reaproveitam o modelo de zumbi, com escala e cor conforme o tipo. Os arquivos GLB são arte original gerada no projeto, sem texturas nem material de terceiros. O gerador reproduz os arquivos com `python scripts/generate-character-models.py`.

| Modelo | Tamanho | Triângulos | Esqueleto |
| --- | ---: | ---: | --- |
| Sobrevivente | 95.372 bytes | 616 | 11 articulações |
| Zumbi | 89.284 bytes | 560 | 11 articulações |

Os dois modelos têm pivô nos pés, altura de aproximadamente 38 unidades lógicas e frente no eixo +X. Cada GLB fornece uma malha esquelética de material único. O cliente reutiliza geometria, clipes e materiais e mantém pose independente por entidade.

## Animação e sincronização

- O cliente deriva os passos da velocidade e usa a mira para orientar o tronco. Membros inferiores continuam animados durante ataque e recarga.
- Eventos de disparo, golpe e dano disparam as reações. A recarga acompanha a fração restante do snapshot. Jogadores caídos ficam no chão até o resgate. O estado recuperado dispara o clipe de levantar.
- Um abate confirmado pode manter o zumbi por até 1,6 s na última posição visual, respeitando o campo de visão. Ataques de zumbi são representados quando o evento de dano identifica o atacante.
- Eventos repetidos ou vencidos são descartados. O cliente online separa as filas por seed e limpa eventos em espera após reconectar. Posição e combate continuam sob as regras da simulação.
- O 3D usa a representação anterior durante carregamento, falha de asset ou excesso de zumbis animados. Até 24 zumbis vivos visíveis recebem rigs. O painel `?debug` mostra o número de personagens animados e o custo total do Three. O caminho `?renderer=2d` continua disponível.

## Verificação

Os 78 testes passaram, incluindo carregamento dos GLBs, poses independentes, queda, recuperação, eventos repetidos e descarte de 150 instâncias em Node. Typecheck e build passaram e os dois modelos foram incluídos na saída de produção.

O navegador integrado executou a seed 4242 no modo exploração, com movimento, golpe e zumbi renderizado. Dois clientes renderizaram dois sobreviventes no mesmo tick 373, com o segundo cliente em `?lag=120`. Também foram verificados o sobrevivente em 360 × 800 e a alternativa 2D.

No PC i7-10700K e RTX 3060 Ti, com 1280 × 720 e DPR 1, as amostras com um e dois rigs registraram p95 de 7,9 ms entre quadros. O p95 do bloco Three foi de 0,5 ms com um rig e 0,4 ms com dois em outra janela. As janelas são amostras de carga leve. O bloco inclui preparação e renderização e não isola o custo dos mixers.

Continuam pendentes a captura sustentada com horda, o aparelho físico, a validação visual ponta a ponta de recarga, resgate e recuperação de contexto, e combate com seis clientes gráficos. O teste de 150 rigs valida criação e descarte em Node.
