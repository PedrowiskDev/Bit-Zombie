# Etapa 7 · Regressão e liberação gradual

## Resultado

A versão passou pela regressão local. A validação em dispositivos físicos continua necessária antes de liberar a versão como otimizada para celulares. O caminho `?renderer=2d` segue disponível.

| Cenário | Resultado observado |
| --- | --- |
| Rodadas, seis abas 3D na mesma sala | Todos entraram na partida e exibiram o tick 429 com 24 zumbis. Houve ataque por mouse e dano recebido por jogadores em quatro das seis abas. |
| Combate e reconexão WebSocket | Teste automatizado confirmou os comandos dos seis jogadores, reconectou um deles com o mesmo ID e verificou a replicação do mesmo abate nos seis clientes. |
| Exploração offline | Aberta em 360 × 800, 800 × 360, 768 × 1024 e 1366 × 768 CSS, com DPR 1. |
| Lobby, partida solo e pausa | O lobby iniciou no menu. O botão Jogar solo avançou para a partida. A leitura do painel ficou estável durante a pausa e o botão Continuar encerrou a pausa. |
| Fallback 2D | Uma rodada abriu com `?renderer=2d` e o painel indicou renderização 2D. |
| Tela cheia no navegador integrado | O navegador recusou a solicitação. O jogo exibiu a mensagem de falha prevista. Entrada e saída em tela cheia ainda precisam de verificação em navegador externo. |
| Checagens do projeto | 94 testes aprovados. Typecheck, build e `git diff --check` passaram. O Vite manteve o alerta de tamanho do chunk principal. |

## Amostra do cooperativo

PC Windows, Core i7-10700K e RTX 3060 Ti. Seis abas do navegador integrado abertas no mesmo computador, servidor local em desenvolvimento, seed 4242, modo Rodadas, 1280 × 720 CSS e DPR 1. No tick 429, o p95 entre quadros variou de 24,9 a 25,2 ms entre abas. O Three registrou de 31 a 37 chamadas de desenho e de 6.396 a 9.756 triângulos por aba.

Essa amostra representa a carga local agregada de seis abas. O p95 ficou acima da referência de 16,7 ms para PC nesse cenário. Ela não permite estimar a taxa de quadros de um participante em dispositivo separado nem comprova a meta para celular.

## Validação em dispositivos e sequência de liberação

1. Rode `npm run dev` e teste uma partida solo e outra online em celular físico, com `?debug` e a seed 4242 para comparação. Registre modelo, navegador, DPR, qualidade efetiva e quantidade de zumbis visíveis.
2. Confirme mira e disparo simultâneos por toque, fullscreen, recarga, resgate e reconexão durante combate. Faça uma sessão de pelo menos cinco minutos, com atenção ao p95 de 33,3 ms e à estabilidade depois do aquecimento. A matriz no navegador integrado cobre DPR 1 e não substitui esse ensaio.
3. Faça a primeira rodada com um grupo pequeno em dispositivos separados e registre o que precisar de ajuste. Se houver problema de GPU ou WebGL, disponibilize a mesma partida com o parâmetro visual `?renderer=2d`. Continue usando os dois modos até validar a paridade no hardware alvo.
