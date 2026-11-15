# Etapa 6 · IA para interiores e hordas

Os zumbis comuns, rápidos, brutos e demolidores adquirem alvos num cone de 210°, até 820 unidades. Dentro de 96 unidades, percebem em qualquer direção. Paredes opacas bloqueiam a visão em ambos os casos. O cuspidor e o chamador mantêm a percepção sem restrição angular. Zumbis recém-criados começam orientados em direção ao sobrevivente mais próximo e passam a usar as regras de percepção a partir do primeiro tick.

A aquisição de novos alvos é distribuída em três grupos de IDs. Alvos já vistos são conferidos a cada tick. Ao perder o contato visual, o zumbi procura a última posição por até 5,5 segundos. Ruídos audíveis iniciam uma investigação de até 14 segundos. Passos e portas quebrando não interrompem uma busca ou investigação em andamento. A audição usa os alcances de ruído existentes.

O planejamento usa portas, passagens e contornos do mapa como referências e pode traçar um desvio local em torno de móveis, props e segmentos sólidos. Cada busca tem alcance local de até 200 unidades, limite de 50 pontos e até oito buscas por tick. Portas fechadas e barricadas continuam sujeitas aos ataques existentes. Mudanças no conjunto de obstáculos invalidam rotas em cache, e trajetórias sem progresso podem ser recalculadas. Movimento, separação, contato e combate continuam nos ticks de 50 ms.

## Verificação

- Os 93 testes passaram, assim como a checagem de tipos e o build. Os casos novos cobrem visão frontal e traseira, alcance próximo, paredes opacas, memória, desvio em L e recálculo ao construir ou remover uma parede. Os testes existentes verificam a destruição da porta, a entrada na cozinha e o ataque à distância do cuspidor.
- Duas simulações independentes com a mesma seed, seis jogadores e 150 zumbis produziram os mesmos snapshots e eventos.
- Cenário de CPU em Node 24.21.0, i7-10700K, seed 482. Foram criados seis jogadores na cozinha e 150 zumbis no lado externo. O jogador p0 disparou uma vez, e a vida dos jogadores foi reposta entre ticks para prolongar o cenário. Foram medidos 500 ticks após 100 de aquecimento.

| Versão | p50 por tick | p95 por tick | p99 por tick | Máximo |
| --- | ---: | ---: | ---: | ---: |
| Antes | 1,68 ms | 2,85 ms | 3,65 ms | 6,51 ms |
| Etapa 6 | 1,43 ms | 2,89 ms | 4,31 ms | 7,11 ms |

O ensaio verificou margem no orçamento de 50 ms por tick nesse PC. A carga mudou durante o combate, de 150 a 68 zumbis vivos na versão anterior e de 150 a 65 na atual, e os trajetos diferem, portanto os valores não isolam o custo do planejador. Ainda faltam a sessão em navegador com seis clientes em combate e a medição em celular físico.
