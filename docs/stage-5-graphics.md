# Etapa 5 · Qualidade gráfica adaptativa

Em **Opções**, o botão **Gráficos** alterna entre Automático, Padrão e Economia. A escolha fica salva no navegador e a preferência anterior por Economia é preservada. No automático, o Three começa em Padrão, reduz um nível após duas janelas de aproximadamente um segundo com p95 acima de 33,3 ms e sobe após dez janelas com p95 abaixo de 24 ms. Pausa, menu, aba oculta e redimensionamento reiniciam a amostragem.

| Perfil aplicado | Escala do buffer Three | Teto de DPR antes da escala | Zumbis vivos com esqueleto | Cadência da pose de zumbis |
| --- | ---: | ---: | ---: | ---: |
| Padrão | 100% | 1,5 | 24 | até 30 Hz |
| Equilibrado | 85% | 1,25 | 16 | até 24 Hz |
| Economia | 70% | 1 | 8 | até 15 Hz |

O tamanho projetado determina se a silhueta de um zumbi comporta o modelo animado. O restante usa uma malha simplificada compartilhada, com uma chamada de desenho por zumbi. Personagens de jogadores mantêm a cadência normal. A posição visual recebe atualização em todos os quadros, inclusive quando se reutiliza a pose. O orçamento de animação não muda o limite de 150 zumbis, o alcance de visão nem as colisões.

Carros, caixas e arbustos compartilham lotes de instâncias por setor, geometria e material. A névoa considera a posição de cada instância e usa uma textura de 512 × 512 no Three em Economia. A máscara original ainda é calculada em 1024 × 1024. O benefício esperado é reduzir transferência da textura e preenchimento no GPU. O custo da composição original continua presente. O renderizador continua sem mapas de sombras dinâmicas.

## Verificação

No navegador integrado do desktop, a mesma partida de exploração com seed 4242 registrou 17 chamadas e 1.016 triângulos nos modos Padrão e Economia, numa janela com um sobrevivente animado e nenhum zumbi visível. Em 1280 × 720 CSS e DPR 1, o DPR efetivo do Three passou de 1 para 0,7. Isso reduz a quantidade de pixels do buffer em cerca de 51%, sem representar uma medida de FPS ou de bateria.

Economia permaneceu ativa após recarregar em 360 × 800, 800 × 360 e 768 × 1024, com DPR 1. A preferência de teste voltou para Automático. Os testes automatizados cobrem a redução e a recuperação do perfil, a suspensão da amostragem, a escolha manual e a posição/rotação dos lotes de objetos.

O painel `?debug` exibe perfil aplicado, DPR efetivo, número de personagens animados e contadores de desenho. A referência em celular físico, a sessão sustentada de horda e a comparação antes/depois com o mesmo número de inimigos ainda estão pendentes.
