# Phase 6.11 — Compiler Audit

Baseline obrigatório: `26d5af139ad685fd6df165749b48d2ed7517376a`.

O compilador 6.10 já pré-alocava typed arrays. O gargalo era o custo por nó do caminho genérico `CompactGameProvider`.

## Caminho antigo

- `level(state)` fazia busca linear repetida;
- `transition` repetia `level`, `legalActions` e `levels.indexOf`;
- terminais alocavam digits/tokens/strings e faziam `split` para reobter ações/sinais;
- chance criava labels e arrays temporários;
- `compileCompactGame` repetia dispatch para actor, utility, actions, transitions, chance e infosets;
- reachability era validada com `parentSeen`; chance e zero-sum eram acumulados;
- perfect recall/no leakage eram claims versionadas do provider;
- hashing estrutural vinha após population.

Mais de um milhão de terminais no S5 amplificavam esse custo. H1 foi suportada: eliminar recomputação/dispatch produziu 2,33×–2,92×.

## Profiling honesto

V2 mede initialization, allocation, population, perfect-recall contract check, hash, finalization, CPU e total. State enumeration, successor generation, infoset assignment e chance validation estão intercalados no mesmo loop; aparecem como `null`, não como rateio inventado.

Baseline registra compile wall, traversal, evaluation, heap/RSS, GC, hashes e configuração em processo isolado.

## Capacity planning

Baseline e V2 usam capacidade exata porque o provider sintético fornece contagens verificáveis. Não foi criado um dynamic-growth artificial; H3 é INCONCLUSIVE. Chunking controla execução/cancelamento, não fragmenta os buffers.