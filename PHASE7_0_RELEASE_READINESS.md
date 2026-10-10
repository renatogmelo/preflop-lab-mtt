# Fase 7.0 — Release readiness

| Gate | Critério | Estado final |
|---|---|---|
| S1 | Public API estável e testes de contrato | PASS |
| S2 | 12 comandos CLI funcionais/documentados | PASS |
| S3 | SDK TypeScript e eventos | PASS |
| S4 | compatibilidade V2/V3, Cache V1/V2, Checkpoint V5 | PASS |
| S5 | provider→artifact ponta a ponta | PASS |
| S6 | segurança e Resource Policy preservadas | PASS |
| S7 | build/checksum/versionamento reproduzível | PASS |
| S8 | documentação e dez exemplos executáveis | PASS |
| S9 | manifesto, testes e limitações completos | PASS |

Evidência final: typecheck, lint, build, 301/301 TypeScript, regressão 80/80, 3/3 Rust, dez exemplos e artefato `34111b6e5006759a`.

Mesmo com S1–S9 aprovados, o release cobre somente infraestrutura sintética finita de dois jogadores/soma zero/recordação perfeita. Gate D histórico continua `FAIL`, `Verified=0` e poker não é certificado.
