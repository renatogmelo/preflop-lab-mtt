# Phase 4 — Validation and Continuation Report

## 1–5. Leduc

Variante: OpenSpiel default 2-player Leduc, seis cartas físicas (J/Q/K × dois naipes), ante 1, player 0 primeiro nas duas rodadas, raises de 2 e 4, máximo de dois raises por rodada e naipes observáveis. A árvore tem 9.457 nós e 936 infosets, exatamente o número documentado pelo OpenSpiel.

Oracle independente reproduzido: política uniforme tem EV P0 `−0,078125` e NashConv `4,747222222222222`.

| Algoritmo, 2.000 iterações | EV P0 | Exploitability | NashConv |
|---|---:|---:|---:|
| Vanilla CFR | -0,08722628 | 0,01354394 | 0,02708789 |
| CFR+ | -0,08597852 | 0,03445116 | 0,06890232 |
| DCFR | -0,08608346 | 0,03249502 | 0,06499005 |

Valor publicado de referência para o primeiro jogador: aproximadamente `−0,085606`. Os três EVs são compatíveis dentro de 0,002; os solves de 2.000 iterações são benchmarks de regressão, não soluções finais de alta precisão.

## 6–10. Hold'em Preflop V2

A árvore HU 10bb contém fold, limp (o `call` do SB no betting engine), opens 2x/2,5x, raise vs limp 3x, 3-bet 7,5x, 4-bet 9x e jam. Sizings vêm da configuração. São 51 nós, 16 decision nodes e 35 terminais por deal; limite potencial de 21.216 infosets combo-level e ~2,38 MB tabulares estimados.

O solve chance-sampled de 5.000 deals visitou 20.776 infosets em 29.020 ms. Ranges condicionais são derivados de reach/strategy e o inspector reporta prior, probabilidade da ação, peso condicional e peso normalizado. Card removal aceita blockers exatos.

Best response exato do V2 ainda não foi implementado; `exploitability` e `NashConv` permanecem `null`. Isso impede concluir integralmente o Milestone 2.

## 11–16. Continuation

O equity engine suporta enumeração exata, sampling determinístico com seed, ties e card removal. O hand evaluator cobre todas as nove categorias, wheel, kickers, board-play e ties.

Primeiro subgame: `AsAh` vs `KdKc`, flop `2s 3d 4c`, pote 4, stacks restantes 8/8, checks forçados em flop/turn e bet 50% no river. Turn/river são enumerados. Árvore: 17.958 nós, 8.012 infosets, 46 chance nodes. DCFR 200: utilities `[+1,64848551, −1,64848551]`, exploitability `0,0000010427`, NashConv `0,0000020854`.

`SolvedSubgameProvider-v0` e cache por hash completo estão implementados. No mesmo estado:

| Provider | Utility P0 |
|---|---:|
| strength-proxy-v1 | +0,05171429 |
| equity-provider-v1 | +1,64848485 |
| solved-subgame-provider-v0 | +1,64848551 |

Neste cenário a única aposta futura ocorre no river e a estratégia resolvida quase não altera a equity bruta; o proxy, porém, erra de forma material. A comparação completa de **estratégias preflop** entre os três providers continua pendente; o artefato não transforma esta comparação de utility em frequências inventadas.

## 17–22. Engenharia, bugs e bloqueadores

Testes novos cobrem BR genérico, oracle uniforme Leduc, convergência Leduc, evaluator, equity, card removal, subgame multi-street, V2, range conditioning, validation suite e golden artifact. A suíte completa é registrada no handoff final.

Bugs/débitos corrigidos:

- métricas CFR deixaram de depender de `KuhnPoker.bestResponseValue`;
- BR agora escolhe uma ação consistente por infoset, ponderada por reach contrafactual;
- árvore CFR é compilada uma vez, evitando recriar estados em cada iteração;
- continuation agora distingue proxy, equity e subgame resolvido;
- showdown Hold'em deixou de usar proxy;
- range/cache hashing é determinístico e documentado.

Gargalos: traversal tabular single-thread, BR exato materializado, 8.012 infosets mesmo no subgame estreito e ausência de BR Hold'em V2. Rust não é necessário neste momento; primeiro precisamos instrumentar e otimizar hot paths.

`Verified` continua em zero. Bloqueadores: BR/NashConv exatos para V2, ranges não-degenerados no subgame, acoplamento preflop↔postflop, todos os flops/boards relevantes, validação chance-sampled vs traversal enumerado e revisão independente/licenciamento do primeiro dataset candidato.
