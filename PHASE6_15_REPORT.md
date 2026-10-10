# Preflop Lab Solver — Relatório da Fase 6.15

Versão `0.15.0`; baseline `c53579bd7b8d68d6bf7b48f4c68292b70099d1a2`.

## Resultado

O motor preservou integridade e recuperou estado correto nos cenários operacionais cobertos. A campanha canônica executou 18 cenários de falha/integridade, incluindo nove encerramentos abruptos reais de processos filhos. Dez recuperações foram tentadas e dez concluíram com igualdade bit a bit contra a execução contínua. Uma geração atual deliberadamente corrompida foi rejeitada e a geração anterior íntegra foi selecionada.

R1–R9 passaram dentro do escopo sintético declarado. Isso não é garantia universal contra perda de dados: não houve ensaio de queda de energia, fsync de diretório não é garantido no Windows e RSS continua sendo observação, não hard cap nativo. Gate D permanece `FAIL`, `Verified=0` e nenhuma estratégia de poker mudou.

## Respostas obrigatórias

1. Foram testados 18 cenários canônicos de falha/integridade, além dos casos cobertos nos 25 testes focais.
2. Ocorreram 9 encerramentos reais de processos filhos.
3. Dez recuperações foram bem-sucedidas, contando nove pós-terminação e um fallback explícito.
4. Nenhuma recuperação falhou.
5. Sim. Checkpoint V5 permaneceu compatível e seu formato não foi alterado.
6. Sim. A geração 2 corrompida foi rejeitada e a geração 1, iteração 2, foi restaurada.
7. Não. Zero estados parciais foram aceitos.
8. O maior delta de estado após recovery foi `0`.
9. O maior delta matemático de EV/NashConv/exploitability foi `0`.
10. A maior árvore irregular materializada teve 515.520 nós; o caso de 1.070.770 foi negado pelo preflight.
11. O maior RSS observado foi 699.142.144 bytes no processo de ~500k nós.
12. Resource Policy V3: 768 MiB, 30 s, Tier 0 até 250k; children da escala usaram old-space de 704 MiB e watchdog de 30 s.
13. Sim, dentro do contrato: ownership/generation foram validados, mutação é detectável e leases antigos foram invalidados. Typed arrays não são fisicamente read-only.
14. Sim, um conflito real entre writers ocorreu e o segundo writer foi rejeitado com `CONCURRENT_WRITER`; nenhum arquivo foi corrompido.
15. Sim. Descoberta, elegibilidade, retry limit, lock e prevenção de duplicata passaram.
16. Sim, bit a bit no mesmo ambiente/processos novos para Vanilla CFR, CFR+ e DCFR.
17. Windows `win32/x64`, Node `v24.20.0`, processos Node novos, Cache V1/V2 e diferentes tamanhos irregulares.
18. Outros sistemas operacionais, outras versões Node, queda de energia, filesystems remotos e storage controllers: `NOT TESTED`.
19. A validação final registra 286/286 testes TypeScript, incluindo 261 históricos + 25 novos, e 3/3 Rust.
20. R1, R2, R3, R4, R5, R6, R7, R8 e R9 passaram.
21. Permanecem riscos não testados de power loss, hard memory isolation, cross-OS, stale lock sem owner legível e mutabilidade física de typed arrays.
22. PASS: matemática, numérica, convergência empírica, compiler, cache, checkpoint, crash recovery, testes, documentação e limitações. PARTIAL: resource safety e reprodutibilidade multiplataforma.
23. Sim, para um marco 7.0 restrito ao motor de pesquisa de jogos sintéticos finitos, dois jogadores, soma zero e recordação perfeita, com as limitações publicadas.
24. Faltam evidências para poker, multijogador, soma não zero, recordação imperfeita, convergência universal, power-loss durability e compatibilidade geral de sistemas.

Artefato: `solver/artifacts/phase6-15-reliability-v0.15.0.json`.
