# Phase 6.8 Limitations

1. Os benchmarks são jogos sintéticos de dois jogadores, soma zero e perfect recall; não geram estratégia de poker.
2. Ground truth independente por forma normal é viável somente em S0. Em escalas maiores, BR/NashConv e o solver compartilham componentes.
3. S4 executou apenas duas iterações; sua exploitability não representa convergência.
4. S5 foi apenas estimado e recusado pelo preflight; não houve materialização parcial.
5. Peak heap é amostrado, não medido por profiler nativo, e GC não foi forçado.
6. Tempos de microkernel para regrets/acumulação são estimativas calibradas, não decomposição exata do runtime.
7. A árvore declarativa ainda é eager e baseada em objetos; o ganho indexado não elimina o custo da definição e compilação.
8. Não houve paralelismo, worker threads, SIMD, WASM ou Rust.
9. Tolerâncias floating-point dependem da transformação: `1e-12` diferencial, `1e-10` metamórfico S0 e `2e-8` no teste ramificado de ordem/permutação.
10. Não houve comparação externa com outro solver para S1–S4.
11. O Gate D histórico permanece FAIL, `Verified = 0` e a Fase 7 de poker não é autorizada por estes resultados.

