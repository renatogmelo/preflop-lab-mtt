# Phase 6.10 — Performance

## Como ler

O runtime externo do pai inclui startup do Node, loader `tsx`, protocolo, amostragem, criação/encerramento do Worker e cleanup. As métricas de estágio medem o trabalho interno. Os dois números são mantidos para não atribuir overhead de isolamento ao algoritmo.

## S4 isolado

| Run | Total pai | Compilação | Traversal | Avaliação | Checkpoint |
|---|---:|---:|---:|---:|---:|
| 1 | 1.576,29 ms | 868,77 ms | 32,12 ms | 55,79 ms | 78,24 ms |
| 2 | 1.626,40 ms | 868,67 ms | 29,66 ms | 50,94 ms | 126,64 ms |

A comparação direta com Fase 6.9 deve usar os estágios internos. O perfil da Fase 6.9 foi in-process e misturava outro contexto de warmup; o total isolado não é um substituto do pipeline antigo.

## S5

| Run | Total | Compilação | Traversal | Best response + EV | Checkpoint |
|---|---:|---:|---:|---:|---:|
| 1 | 16.946,44 ms | 15.434,61 ms | 272,81 ms | 214,45 ms | 410,13 ms |
| 2 | 17.669,10 ms | 16.097,49 ms | 329,93 ms | 208,63 ms | 395,29 ms |

Compilação responde por aproximadamente 91–92% do total. Traversal e avaliação escalam de forma aceitável; a construção e validação da topologia dominam o pipeline.

## Checkpoint

V5 reduziu tamanho em 62,26%, serialização em 44,95% e memória temporária em 72,59%. Desserialização ficou mais lenta na amostra S4 devido a checksum/validações, um trade-off aceito em favor de integridade e menor pico temporário.

## Reprodutibilidade

S2, S3 e S4 foram repetidos duas vezes, cada escala mantendo o mesmo hash semântico. S5 foi repetido duas vezes em PIDs distintos e também manteve `802fdfa46193da98`. Runtime e RSS variam; estado matemático não.

## Próximo alvo

O próximo ganho relevante não está em micro-otimizar uma iteração CFR. Deve-se reduzir compilação: materialização por blocos, persistência/mmap de topologia validada ou cache binário estrutural, sempre com identidade de jogo e validação antes de uso.
