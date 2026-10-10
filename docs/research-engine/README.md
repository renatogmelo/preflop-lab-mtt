# Research Engine 1.0 — Portal do desenvolvedor

## Getting started e instalação

Use Node `>=22.13.0`, execute `npm ci` e importe `createResearchSdk` de `preflop-lab/research`. Para o monorepo, rode `npm run research -- info` e valide `examples/research-engine/experiment.json`.

## Architecture

A fachada pública valida configuração/capabilities; o compiler seleciona V2 ou V3; um worker isolado executa Compact CFR/CFR+/DCFR; avaliação, Checkpoint V5 e Result V1 completam o pipeline. Consulte `PHASE7_0_ARCHITECTURE_AUDIT.md`.

## Public API e SDK

Contratos: `PHASE7_0_PUBLIC_API.md`. Integração: `PHASE7_0_SDK.md`.

## CLI

Os 12 comandos e códigos de saída estão em `PHASE7_0_CLI.md`.

## Providers e algorithms

Provider V3 declara identidade, capabilities e limites; V2 usa adaptador. Os algoritmos públicos são Vanilla CFR, CFR+ e DCFR, todos sobre `compact-cfr-v0.13.0`; suas convenções matemáticas permanecem as da Fase 6.13.

## Experiments, checkpoints e recovery

Experimentos usam `research-experiment-v1`; checkpoints continuam V5. Resume valida game/config/algoritmo/checksum antes de restaurar. Falhas não viram resultados completos.

## Validation

Validação estrutural sempre distingue evidência do run de certificação de poker. Diferencial pequeno é executado quando solicitado e viável. `Verified` permanece separado.

## Troubleshooting

Use `preflop-research doctor`; depois confira status/eventos do run. `RESOURCE_LIMIT` exige reduzir o caso, não elevar limites silenciosamente. `CHECKPOINT_ERROR` exige um checkpoint íntegro e compatível.

## Compatibility e limitations

Consulte `PHASE7_0_COMPATIBILITY.md` e `PHASE7_0_LIMITATIONS.md` antes de integrar ou interpretar resultados.
