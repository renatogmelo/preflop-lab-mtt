# Research Engine 1.0 — Processo de release

## Pipeline reproduzível

1. `npm ci`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test:research`
5. `npm run test:release`
6. `npm run build`
7. `npm test`
8. `cargo test --manifest-path solver/native/phase611-compiler/Cargo.toml --release`
9. `npm run research:release`

O gerador confirma consistência de `package.json`, `SOLVER_VERSION` e `RESEARCH_ENGINE_VERSION`, valida package exports e calcula SHA-256 ordenado de path+conteúdo para a superfície distribuível. O artefato final também possui checksum semântico. Não publica em npm, Sites ou outro registry.

CI rápida cobre API/SDK/CLI e regressão matemática 6.13–6.15. `npm test` preserva toda a suíte histórica. Campanhas longas 6.14/6.15 ficam num job manual separado para não transformar toda alteração pequena em campanha pesada.

Plataforma efetivamente executada nesta fase: Windows `win32/x64`, Node `v24.20.0`. Linux, macOS e outras versões Node permanecem `NOT TESTED`; não são anunciados como compatíveis.

Versão 1.0 significa estabilidade da fachada pública dentro do escopo declarado, não estabilidade absoluta do software nem certificação estratégica.
