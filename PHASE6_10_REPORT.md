# Phase 6.10 — Resource-Safe Million-Node Research

## Resultado

A arquitetura compacta processou S5 com segurança operacional e resultado reproduzível. Cada repetição construiu e validou 2.097.149 nós, executou uma iteração DCFR, avaliou EV/best response/NashConv/exploitability, persistiu Checkpoint V5 e liberou o estado. Os dois processos terminaram dentro dos limites, com o mesmo hash semântico `802fdfa46193da98`.

Isto não significa que S5 convergiu. Uma iteração produziu exploitability `0,3955868135582671` e NashConv `0,7911736271165342`. O resultado comprova a infraestrutura e a execução controlada, não uma estratégia resolvida.

| Indicador | Resultado |
|---|---:|
| Baseline auditado | `fdc8e9dd6c0628bd9281bb78cf1574208e5eb764` |
| Versão | Research Solver 0.10.0 |
| S5 | 2.097.149 nós / 174.762 infosets / profundidade 19 |
| Iterações por repetição | 1 |
| Runtime total | 16,946 s / 17,669 s |
| Pico conservador | 200.675.328 B = 191,38 MiB |
| Preflight calibrado | 352.411.221 B e 19,263 s |
| Resource tier | Tier 2, autorização explícita |
| Repetibilidade | hashes semânticos idênticos |
| Trust | Experimental |
| Verified | 0 |
| Gate D histórico | FAIL, preservado |

O artefato canônico é `solver/artifacts/phase6-10-resource-safe-v0.10.0.json`.

## Respostas obrigatórias

1. **O runner isolado foi implementado?** Sim. O processo pai cria um filho identificado e o cálculo roda em um Worker; PID, hashes, timestamps, métricas, exit code e causa de término são persistidos.
2. **O watchdog funciona?** Sim. Testes confirmam timeout, falta de heartbeat, excesso de RSS, crash e recusa estrutural sem preflight.
3. **Como os limites de memória são aplicados?** O pai amostra `WorkingSet64/PeakWorkingSet64` no Windows, impõe teto observado, limita o old space do V8 e também recebe RSS/`maxRSS` do filho. Windows não oferece aqui um hard cap nativo via Job Object; essa limitação permanece explícita.
4. **Qual o pico real observado em S4?** O máximo conservador entre SO e autorrelato foi 89.837.568 B (85,68 MiB). O maior pico amostrado independentemente pelo pai foi 82.391.040 B (78,57 MiB).
5. **Qual a diferença entre memória estimada e observada?** A estimativa V3 inicial de S4 foi 76.676.872 B; o pico conservador ficou 13.160.696 B acima. A frequência de subestimação inicial foi 100%; por isso o multiplicador variável foi recalibrado para `2,6713132854`.
6. **O estimador foi calibrado?** Sim, com duas execuções isoladas de S2, S3 e S4, separando overhead fixo e crescimento variável.
7. **O Tier 1 foi validado?** A política, autorização e envelope Tier 1 foram validados por testes e pelas seis medições. Não houve um benchmark adicional rotulado como Tier 1; S2–S4 permaneceram Tier 0 e S5 foi Tier 2.
8. **O Tier 2 foi autorizado?** Sim, explicitamente apenas para S5, uma iteração, após os gates de isolamento, watchdog, calibração, memória e runtime.
9. **S5 foi executado?** Sim, duas vezes.
10. **Se não, por quê?** Não se aplica. Tentativas anteriores ao gate final foram corretamente recusadas enquanto a calibração ainda não sustentava a autorização.
11. **Se sim, quantos nós foram processados?** A árvore contém 2.097.149 nós. Uma iteração para os dois jogadores visitou 4.194.298 nós; a avaliação exata visitou 10.485.745.
12. **Qual foi o runtime?** 16.946,44 ms e 17.669,10 ms totais.
13. **Qual foi o pico de memória?** 200.675.328 B (191,38 MiB) no maior dos dois runs.
14. **Quantas iterações foram concluídas?** Uma por run, conforme o limite Tier 2.
15. **Qual exploitability?** `0,3955868135582671`, após uma iteração; não é convergência.
16. **Qual NashConv?** `0,7911736271165342`, após uma iteração.
17. **Checkpoint V5 foi implementado?** Sim, binário, versionado, little-endian, com hashes, metadados de arrays, checksum e hash semântico.
18. **Quanto o arquivo diminuiu?** Em S4, de 927.392 B para 349.995 B: redução de 62,26%.
19. **Quanto a serialização acelerou?** De 13,8512 ms para 7,6247 ms: `1,82×` ou 44,95% menos tempo nesta amostra.
20. **Quanto a memória temporária diminuiu?** De 1.276.896 B para 349.995 B: redução de 72,59%.
21. **Checkpoint/resume permaneceu determinístico?** Sim. Estado, iteração, regrets, strategy sums e average strategy são idênticos ao run contínuo.
22. **Os testes de corrupção passaram?** Sim: truncamento, payload corrompido, versão, jogo, algoritmo, representação, comprimentos e valores não finitos são recusados.
23. **Os testes diferenciais passaram?** Sim. Os gates M1–M7 e oracles A/B/C da Fase 6.9 foram preservados; a validação de subárvore S5 teve erro de EV zero a tolerância `1e-12`.
24. **Houve regressões?** Não após a correção do fixture de crash; a validação final cobre typecheck, ESLint, build e 180 testes. Nenhuma estratégia de poker foi modificada.
25. **Quais gates R1–R8 passaram?** Todos: isolamento, watchdog, calibração, integridade matemática, checkpoint V5, execução S5 segura, performance honesta e pesquisa reproduzível.
26. **Quantos testes totais passaram?** 180/180 na validação final.
27. **Qual gargalo permanece?** Compilação: 15,435–16,097 s, mais de 90% do runtime S5. O cálculo ainda é single-process/single-worker e o hard cap de memória no Windows é amostrado, não um Job Object.
28. **Qual próxima pesquisa recomendada?** Reduzir o custo de compilação com construção em blocos/mapeamento binário, adicionar hard limits nativos por plataforma e só depois pesquisar múltiplas iterações S5 sob um novo gate — sem confundir escala com convergência.

## Gates

| Gate | Estado |
|---|---|
| R1 — Isolation Integrity | PASS |
| R2 — Watchdog Reliability | PASS |
| R3 — Estimator Calibration | PASS |
| R4 — Mathematical Integrity | PASS |
| R5 — Binary Checkpoint Integrity | PASS |
| R6 — Safe Large-Scale Execution | PASS |
| R7 — Honest Performance Reporting | PASS |
| R8 — Reproducible Research | PASS |

## Resposta final da fase

Sim: dentro do jogo sintético e dos limites declarados, a arquitetura executou milhões de nós de forma isolada, matematicamente consistente e reproduzível, sem aumento arbitrário do teto de 768 MiB. A conclusão não se estende a verdade GTO de poker, datasets Verified ou convergência de S5.
