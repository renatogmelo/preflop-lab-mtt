# Fase 6.14 — Reprodutibilidade

Artefato principal: `solver/artifacts/phase6-14-convergence-v0.14.0.json`.

Ele registra commit, Node, sistema operacional, CPU, flags, versão de algoritmo/framework, hashes de jogo/topologia, seeds, configurações, agendas, budgets, séries, classificações, falhas e comandos.

Seeds de geração: `61400`–`61404`. O full-tree CFR é determinístico; variar o campo seed do solver sem alterar jogo/configuração não representa variabilidade real e não foi usado como evidência.

Comandos:

- `npm run solver:phase6-14`
- `node --import tsx --test tests/solver-phase6-14.test.mjs`
- `npm run check`
- `cargo test --manifest-path solver/native/phase611-compiler/Cargo.toml --release`

Iteration-matched e resumes são reproduzíveis bit a bit no mesmo contrato. Resultados time-matched são dependentes da máquina e carga; devem ser comparados pelo budget e ambiente registrados, não por igualdade de contagem de iterações.
