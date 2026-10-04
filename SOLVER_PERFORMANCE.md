# Solver Performance — Phase 4

Data: 2026-10-03. Runtime: Node.js/TypeScript, `number` (f64), single-thread, Windows. Números são observações desta máquina e não garantias.

## Baselines

| Workload | Configuração | Runtime |
|---|---:|---:|
| Leduc Vanilla CFR | 2.000 iterações, 18.914 nós/iteração | 26.256 ms |
| Leduc CFR+ | 2.000 iterações, 18.914 nós/iteração | 25.504 ms |
| Leduc DCFR | 2.000 iterações, 18.914 nós/iteração | 25.953 ms |
| Hold'em Preflop V2 | 5.000 deals amostrados, árvore de 51 nós/deal | 29.020 ms |
| Subgame pós-flop | 200 iterações, 17.958 nós, BR exato | 13.254 ms observado na execução isolada |

Compilar a árvore imutável reduziu Leduc DCFR 1.000 de aproximadamente 26,7 s para 12,8 s sem alterar EV, regrets ou exploitability.

## Perfil qualitativo

O custo dominante é traversal recursivo e atualização/lookup de infosets. Em métricas finais, best response reconstrói e percorre a árvore; no subgame isso também é relevante. Chance e hand evaluator dominam apenas os workloads Hold'em. Serialização é pequena diante do solve, exceto no artefato combo-level V2.

Ainda falta instrumentação de tempo por função para separar precisamente traversal, chance, evaluator, infoset lookup, BR e serialization. Essa ausência está registrada como débito de profiling, não preenchida com estimativas falsas.

## Precisão

Todos os cálculos continuam em JS `number`/f64. Não há evidência que justifique f32. Probabilidades, utilities e regrets falham em NaN/Infinity.

## Critério para Rust

Não migrar agora. Rust passa a ser justificável quando profiling reproduzível mostrar que arrays/arena/worker threads em TypeScript não permitem a árvore ou o throughput necessários, especialmente para:

- BR exato combo-level de Hold'em;
- acoplamento de muitos subgames;
- chance sampling em centenas de milhões/bilhões de iterações;
- limite de memória das tabelas de infosets.

Uma migração deve portar apenas hot paths e manter testes diferenciais contra esta referência TypeScript. Não há justificativa atual para rewrite total.
