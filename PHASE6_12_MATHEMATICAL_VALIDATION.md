# Fase 6.12 — Validação Matemática

A tolerância explícita é 1e-12.

## Oracles independentes

O oracle percorre diretamente estados do Provider Contract V2 e enumera políticas puras de best response. Ele não reutiliza o avaliador da árvore compilada. Nos três jogos pequenos:

| Família | Nós | EV P0 uniforme | NashConv | Delta máximo |
|---|---:|---:|---:|---:|
| Irregular branching | 31 | 0,0361359444 | 1,145110875 | 2,78e-17 |
| Variable-depth hidden | 37 | 0,125 | 0,75 | 0 |
| Asymmetric chance | 13 | 0,36125 | 0,28125 | 0 |

A independência termina na definição do provider e na aritmética de ponto flutuante do runtime. O oracle não compartilha arrays compilados nem o algoritmo de best response compacto.

## Diferencial

Legacy, Compiler V2 e Compiler V3 produziram delta estrutural máximo 0 no S2 regular e o mesmo structural hash. Chance probabilities, terminal utilities e information-set mapping são byte-equivalentes nesse caso.

## Metamórficos

Passaram renomeação e inversão de ações, reordenação de chance, permutação de state keys, permutação de jogadores, escala de utility, políticas de crescimento, chunk sizes e capacidades iniciais.

## Checkpoint

Cache V1 → solver → Checkpoint V5 → restore e Cache V2 → solver → Checkpoint V5 → restore chegaram ao mesmo state hash da execução contínua. Delta máximo em regrets e strategy sums: 0.
