# Phase 6.11 — Fast Compiler, Structural Cache and Rust Spike

## Resultado

A fase terminou em **PASS**, com C1–C9 aprovados e 40/40 execuções isoladas concluídas. Arquitetura recomendada:

`Compiler V2 TypeScript em cache miss → Structural Cache V1 em reuso → solver compacto → Checkpoint V5 para estado numérico`

Rust permanece como oracle diferencial experimental. No S5 levou 14,288 s end-to-end contra 5,667 s do TypeScript V2 (2,521× o tempo), portanto não justifica migração.

Artefato: `solver/artifacts/phase6-11-fast-compiler-v0.11.0.json`; hash `800f715766ed8c5b`.

## Respostas obrigatórias

1. **Operação dominante:** trabalho repetido por nó no provider genérico, sobretudo lookup linear de nível, revalidação de transições e criação/split de strings e arrays temporários para históricos terminais.
2. **Principal otimização TypeScript:** percurso sequencial por níveis, cálculo direto da topologia sintética e escrita em typed arrays exatamente pré-alocados, sem dispatch genérico repetido.
3. **Aceleração fria:** S3 2,87×, S4 2,33× e S5 2,92×; S5 caiu de mediana 16,569 s para 5,667 s.
4. **Memória:** na repetição S5 sem exportar cache, 190,90 MiB contra 189,13 MiB do baseline, aumento de ~0,9%; não houve redução material. A mediana V2 incluindo uma repetição que serializou cache foi 254,36 MiB; não se afirma redução geral do pipeline com cache write.
5. **Incremental:** sim. Estado parcial é explícito, `finish()` recusa árvore incompleta, budgets e `AbortSignal` são verificados por chunk e buffers podem ser liberados.
6. **Chunk escolhido:** 65.536. Em S4, 4.096 e 65.536 empataram na prática (308,784 e 302,731 ms); 65.536 equilibra throughput e dois checks. Todos produziram o mesmo hash.
7. **Cache estrutural:** sim, binário, versionado, checksummed e validado.
8. **Load S5:** mediana 722,292 ms para cache TypeScript; execuções 746,942 e 697,642 ms. Cache Rust-gerado: 617,499 ms de mediana.
9. **Tamanho S5:** 59.772.069 bytes (~57,00 MiB).
10. **Invalidation:** passou para configuração, identidade, versão, checksum, corrupção, tamanhos, offsets e invariantes.
11. **Rust:** sim, CLI experimental isolada, sem dependências e com `unsafe_code = "forbid"`.
12. **Rust S5:** 14,288 s end-to-end de mediana; compilação nativa interna observada de 8,962 s.
13. **Integração Rust:** serialização 245,579 ms, escrita 1.709,716 ms, startup/protocolo 50,539 ms e load/validação TypeScript 4,398 s; validação dentro do load 4,353 s.
14. **Ganho Rust:** 1,16× contra baseline, mas 2,521× mais lento que V2; não é ganho sobre a melhor implementação.
15. **Mesma topologia:** sim para inteiros/ordering S0–S5; chance error zero e utility error máximo 2,22e-16.
16. **Hashes:** baseline/V2/cache TypeScript coincidiram. Rust difere bit a bit por `tanh` entre runtimes, mas o contrato tolerante/canônico passou; métricas estratégicas ficaram dentro de 1e-10.
17. **Testes matemáticos:** sim; EV, best response, exploitability e NashConv foram consumidos pelo avaliador existente sem divergência material.
18. **Checkpoint V5:** compatível. Cache + restore + continuação gerou o mesmo state hash da execução contínua.
19. **Pico RSS S5:** baseline 189,13 MiB; V2 pipeline 254,36 MiB (190,90 MiB compiler-only); Rust pipeline 283,18 MiB (228,26 MiB compiler-only); cache TS 208,16 MiB; cache Rust 206,89 MiB.
20. **Regressões:** nenhuma funcional ou matemática. Cache write adiciona pico temporário documentado.
21. **Gates:** C1–C9 passaram.
22. **Testes:** 198/198 TypeScript e 3/3 Rust passaram.
23. **Rust deve substituir TypeScript?** Não.
24. **Arquitetura híbrida recomendada?** Não como runtime principal. V2 + cache é a combinação recomendada; Rust fica como oracle experimental.
25. **Gargalo restante:** utilities/históricos no cold compile e hash/validação/cópia dos ~57 MiB no cache load.
26. **Próxima pesquisa:** cache memory-mapped/zero-copy ou streaming validado; depois, generalização do V2 para providers sem contagem exata.

## Integridade histórica

Nenhuma estratégia, range ou recomendação de poker foi alterada. Gate D continua FAIL. Verified continua em zero. Resource Policy V3 e Checkpoint V5 foram preservados.