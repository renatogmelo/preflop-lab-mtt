# Rust Migration Decision

## KEEP TYPESCRIPT

A classificação é calculada, não escolhida antecipadamente:

- `RUST CORE RECOMMENDED` exigiria Rust/TS V2 ≤ 0,75 no S5 e equivalência;
- `HYBRID CANDIDATE` exigiria ratio ≤ 0,90 e equivalência;
- observado: 14.288,369 / 5.667,428 = **2,521**, com equivalência aprovada.

Rust é quase duas vezes mais lento que V2 no pipeline completo. Apesar de superar o baseline, ele adiciona build nativo, distribuição, protocolo, serialization e uma segunda fronteira de validação.

## Decisão arquitetural

1. Use Structural Cache V1 quando a identidade já existe.
2. Em miss, use TypeScript Compiler V2.
3. Mantenha o baseline para oracle/regressão.
4. Mantenha a CLI Rust como oracle diferencial e laboratório, sem dependência de produção.
5. Reavalie Rust somente após um protótipo que evite escrita/leitura intermediária e mostre ganho end-to-end ≥ 10%; core recomendado exige ≥ 25%.

A combinação vencedora desta fase é TypeScript V2 + cache estrutural, não um runtime híbrido obrigatório.