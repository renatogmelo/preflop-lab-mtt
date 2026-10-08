# Phase 6.10 — Controlled S5 Experiment

## Autorização

S5 só foi executado depois que isolamento, watchdog, seis perfis de calibração, limite de memória, projeção de runtime, Tier 2 explícito, interrupção segura e persistência passaram. Durante o desenvolvimento, o safe abort permaneceu ativo até a evidência ser suficiente.

Preflight final:

- 2.097.149 nós;
- 174.762 information sets;
- profundidade 19;
- pico estimado calibrado 352.411.221 B;
- runtime estimado 19.263,35 ms;
- orçamento 805.306.368 B / 30.000 ms;
- uma iteração máxima.

## Estágios executados

1. Preflight V3 `ALLOW`.
2. Compilação compacta e verificação da contagem autorizada.
3. Validação estrutural: chance normalizada, zero-sum, reachability, information hiding e perfect recall.
4. Inicialização de regrets/strategy sums.
5. Uma iteração DCFR completa para os dois jogadores.
6. EV, best response, exploitability e NashConv exatos na árvore compacta.
7. Checkpoint V5, leitura, checksum e retomada.
8. Cleanup, GC observada e encerramento do processo.

## Resultado repetido

| Métrica | Run 1 | Run 2 |
|---|---:|---:|
| Runtime total | 16.946,44 ms | 17.669,10 ms |
| Pico RSS observado | 200.675.328 B | 198.795.264 B |
| Nós visitados no CFR | 4.194.298 | 4.194.298 |
| Exploitability | 0,3955868135582671 | 0,3955868135582671 |
| NashConv | 0,7911736271165342 | 0,7911736271165342 |
| Hash semântico | `802fdfa46193da98` | `802fdfa46193da98` |

Utilities: `[+0,3209103329888391, -0,3209103329888391]`. Best-response values: `[0,6490379716301542, 0,14213565548638]`.

## Validação de subárvore

Uma subárvore completa de 31 nós e profundidade 4 foi extraída com definição explícita. O traversal extraído e o provider calcularam EV `0,344970165434081`; erro `0` sob tolerância `1e-12`. O hash estrutural foi `7b593667447d6c23`.

Essa comparação valida estrutura, chance, utilities, identidade de infosets e traversal uniforme. Ela não prova que resolver a subárvore isolada gera a mesma estratégia do jogo completo.

## Interpretação

S5 foi compilado, validado, iterado e avaliado — não “resolvido”. Exploitability/NashConv altos depois de uma iteração são esperados e impedem qualquer declaração de equilíbrio aproximado ou convergência.
