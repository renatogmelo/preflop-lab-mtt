# Preflop Lab — Research Engine 1.0.0 (Fase 7.0)

Baseline: `be5bd289f339535c6cbf1fe5788a8564e923538e`. Escopo: produto de pesquisa para jogos extensivos sintéticos finitos, dois jogadores, soma zero, recordação perfeita e chance explícita.

## Implementação

Foram adicionados Public API V1, Provider V3/adaptador V2, capability negotiation, Experiment/Result/Event/Error schemas, seleção Compiler V2/V3, processo isolado, watchdog, cancelamento, Checkpoint V5/resume, artefatos checksummed, SDK TypeScript, CLI de 12 comandos, doctor, package exports, exemplos, CI e release manifest. Algoritmos, caches, formatos históricos e estratégias de poker não foram alterados.

## Respostas obrigatórias

1. Sim, a API pública está implementada; a validação final define o readiness.
2. 14 operações públicas.
3. Sim, a CLI está funcional.
4. 12 comandos, além de `help`.
5. Sim, a SDK TypeScript está funcional e usa resultados discriminados.
6. Sim: API, Provider, Experiment, Event e Result possuem versões explícitas.
7. Sim, Provider V2 permanece compatível por adaptador delegante.
8. Sim, Compiler V2/V3 permanecem compatíveis e são escolhidos por capabilities.
9. Sim, Cache V1/V2 não foi alterado.
10. Sim, Checkpoint V5 não foi alterado e falha fechado em corrupção/incompatibilidade.
11. Sim. Provider → validation → compiler → algorithm → isolated execution → evaluation → Checkpoint V5 → artifact passou.
12. 301/301 testes TypeScript e 3/3 testes Rust passaram.
13. Traversal/absoluto/symlink, overwrite, schema, provider externo, resource exhaustion, command injection, artifact tampering, checkpoint e concorrência por run.
14. `win32/x64`, Node `v24.20.0`; outras plataformas não testadas.
15. Sim, dentro do ambiente declarado; o SHA-256 do pacote é `a348f825607c39feac7c0b7cb4ed45fa18c38ab41a2ce4decb3488bd9a051071`.
16. Nenhum formato persistido histórico mudou. Experiment V1 e Result V1 são formatos novos.
17. Permanecem as limitações de escopo sintético, multiplayer, poker, cross-OS, hard cap Windows e power loss.
18. S1, S2, S3, S4, S5, S6, S7, S8 e S9 passaram.
19. Sim, para o escopo sintético declarado; não para poker ou multiplayer.
20. A Fase 7.1 pode consumir API/SDK, Status/Event/Result V1 e os modelos `FutureUi*`.

Artefato obrigatório: `solver/artifacts/phase7-0-research-engine-v1.0.0.json`.

## Validação final

Typecheck, lint, build Vinext, 301/301 testes TypeScript, regressão de release 80/80, 3/3 testes Rust e geração/verificação do artefato passaram. Artifact checksum: `34111b6e5006759a`. S1–S9: PASS. Gate D: FAIL. Verified: 0.
