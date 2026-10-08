# Phase 6.8 Scalability

## Escalas executadas

| Nível | Nós | Infosets | Profundidade | Iterações finais por algoritmo | Status |
|---|---:|---:|---:|---:|---|
| S0 | 53 | 6 | 5 | 5.000 | concluído |
| S1 | 509 | 42 | 7 | 2.500 | concluído |
| S2 | 8.189 | 682 | 11 | 250 | concluído |
| S3 | 32.765 | 2.730 | 13 | 50 | concluído |
| S4 | 131.069 | 10.922 | 15 | 2 | concluído |
| S5 | 2.097.149 estimados | 174.762 estimados | 19 | 0 | safe abort |

O gerador parametriza estados privados, sinais públicos, estágios, ações, seed e complexidade de dependência. O estimador tem fórmula exata para esta família e coincidiu com os números materializados em S0–S4.

## Interpretação

O crescimento é exponencial porque cada estágio contém decisão seguida de chance pública. S4 é 4.228 vezes maior que o maior jogo de 31 nós da Fase 6.7. Concluir duas iterações em S4 prova que a infraestrutura materializa e atravessa essa escala; não prova convergência naquela escala.

S5 é a primeira escala inviável sob os budgets declarados: limite de 250.000 nós, 768 MiB estimados e 30 s por run. O preflight estimou 2.097.149 nós, 704 MiB para a definição, 496 MiB para a árvore compilada e 85,3 MiB para a representação indexada. Como definição + compilado ultrapassam o budget, a árvore não foi criada.

## Segurança de recursos

- node budget: 250.000;
- memory budget: 768 MiB estimados;
- runtime budget: 30.000 ms por run;
- iteration budget: 25.000;
- checkpoint interval de referência: 500;
- controle de runtime confirmou abort após 1 ms, antes das 25.000 iterações solicitadas;
- S5 preservado como failure/safe-abort artifact, sem omissão silenciosa.

