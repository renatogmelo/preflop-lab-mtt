# Fase 6.14 — Limitações

- As curvas são observações empíricas, não provas formais de convergência.
- Apenas jogos sintéticos pequenos/médios foram usados; nenhuma conclusão estratégica de poker decorre deles.
- Avaliação independente por políticas puras é combinatória e limitada a jogos pequenos.
- O pico RSS é o observado pelo processo isolado nos pontos amostrados; picos entre amostras podem escapar.
- Time-matched depende de CPU, sistema operacional, runtime e carga concorrente.
- O fit log-log é sensível ao intervalo, zeros e transientes; não é extrapolado.
- Platô pode significar equilíbrio já atingido, resolução numérica, oscilação ou progresso lento; não é automaticamente bug.
- Cache V1/V2 + Checkpoint V5 foi validado em topologias controladas, não em toda combinação possível.
- Nenhuma migração para Rust, mudança de compiler ou otimização de algoritmo foi realizada.
- Gate D permanece `FAIL`; `Verified` permanece 0.
