# Fase 6.13 — Limitações

- A prova é empírica e diferencial dentro das hipóteses formais; não é uma prova mecânica do código.
- Convergência em profundidade não foi certificada. Os runs de 2.000 iterações são somente sanity checks; a Fase 6.14 deve estudar taxas, limites e estabilidade por seeds/iterações longas.
- O oráculo de BR enumera políticas puras e é propositalmente combinatório; não escala para árvores de poker.
- A correção foi aplicada aos caminhos ativos compacto, indexado e orientado a objetos; o diferencial independente principal promove o compacto, e a equivalência histórica cobre os demais.
- Compiler V2/V3, Structural Cache V2, Resource Policy V3 e Checkpoint V5 foram preservados; a fase não revalida toda a segurança operacional anterior.
- Nenhum range, estratégia, abstração, árvore de apostas ou dataset de poker foi validado.
- `Verified` permanece 0 e Gate D histórico permanece `FAIL`.
- CFR em jogos de recordação imperfeita, mais de dois jogadores, soma não zero, jogos infinitos e MCCFR está fora do escopo.
