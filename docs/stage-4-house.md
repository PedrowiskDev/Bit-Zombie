# Etapa 4 · Casa explorável

A casa mantém a posição, a janela e o identificador da porta definidos pela seed. Agora tem sala, cozinha, passagem central, sofá, armário, bancada, jardim e caixa de suprimentos em 3D. O telhado sai da vista ao entrar. Paredes que encobrem o personagem ficam translúcidas conforme o ângulo da câmera.

O layout em `packages/shared/src/sim/urbanMap.ts` fornece os obstáculos para servidor, modo solo e predição online. Sofá e bancada bloqueiam movimento. O armário também bloqueia visão e tiros. A janela continua permitindo visão e disparos e bloqueando passagem. A vegetação é decorativa. A IA usa o vão central ao cruzar os cômodos. Quando um zumbi derruba a porta, o ruído da porta não substitui seu alvo dentro da casa.

A versão de compatibilidade do multiplayer passou para 2 porque o cliente também gera o mapa para prever colisões. Reinicie o servidor e recarregue o jogo nos clientes após atualizar. Em produção, gere um novo build para cliente e servidor.

## Validação

- Testes automatizados cobrem o corredor com o raio do maior zumbi em quatro seeds, bloqueios da mobília, entrada, coleta, saída, perseguição após destruição da porta e replicação da porta e da caixa entre dois clientes WebSocket. A suíte também cobre reconexão, seis jogadores no lobby e regras de abrigo.
- No navegador integrado, em exploração com a seed 4242, abri a porta, atravessei a sala, confirmei o recorte do telhado e abri a caixa na cozinha. A madeira subiu de 4 para 6. Sem erros de console nessa sessão.
- Amostra na cozinha em 428 × 787 CSS, DPR 1, com um personagem animado e nenhum zumbi visível. O Three registrou 47 chamadas, 1.560 triângulos e 23 geometrias na cena inteira. A janela de 600 quadros registrou p95 de 6,20 ms entre quadros e 0,50 ms no bloco Three. A observação foi em navegador desktop, sem ensaio comparativo de desempenho.
- Faltam a verificação da casa em celular físico, a repetição do percurso completo em dois navegadores e a construção com reparo junto ao perímetro em uma partida real.
