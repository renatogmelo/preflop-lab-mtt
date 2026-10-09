# Phase 6.11 — Cross-Language Validation

Rust e TypeScript foram comparados em S0, S1, S2, S3, S4 e S5 autorizado.

## Contrato

- kind/actor/first child/child count: igualdade exata;
- information-set IDs, offsets e action counts: igualdade exata;
- child/action ordering: igualdade exata;
- chance probabilities: tolerância 1e-12;
- terminal utilities: tolerância 1e-12;
- node counts, reachability, perfect recall claims e game identity: validados;
- topology Rust consumida diretamente por solver e evaluator TypeScript.

## Resultado

Todas as escalas passaram. Maximum chance error: 0. Maximum utility error: 2,22e-16. A diferença vem de `Math.tanh` versus `f64::tanh`, ambos IEEE-754 double; igualdade bit a bit não é o contrato adequado.

Baseline/V2/cache TypeScript têm SHA-256 estrutural idêntico. Rust possui checksum/hash de transporte próprio e, após reconstrução, comparação canônica/tolerante. EV, best response, exploitability e NashConv diferiram no máximo 1e-10.

H7: SUPPORTED.