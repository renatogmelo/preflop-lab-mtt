# Rust Decision Gate — Phase 6.8

## Parecer

**Não migrar para Rust nesta fase.**

- **CPU é gargalo?** Sim, traversal cresce exponencialmente; S4 caiu para ~1,10 milhão de nós/s em DCFR.
- **Memória é gargalo?** Sim. O heap observado chegou a 421,6 MB e o S5 foi recusado por orçamento combinado estimado.
- **Estrutura de dados é gargalo?** Sim. A definição e a árvore compilada eager dominam a projeção de S5, embora os arrays indexados usem apenas ~40 bytes/nó.
- **GC é o gargalo?** Não há evidência suficiente. GC não foi instrumentado nativamente; atribuir o limite a GC seria especulação.
- **Rust resolveria?** Poderia reduzir overhead e melhorar locality, mas não remove a explosão combinatória nem a dupla materialização. Sem mudar a arquitetura, apenas deslocaria o limite.
- **Custo de manutenção:** segundo runtime, FFI/WASM ou binário nativo, serialização duplicada, toolchain, CI e necessidade de manter o oracle TypeScript.
- **Alternativa TypeScript:** topologia lazy/iterativa, evitar a árvore objeto duplicada, compactar metadados, batch de avaliação, profiling com heap nativo e só depois testar workers determinísticos.

## Critério futuro

Reabrir Rust apenas após um benchmark isolado demonstrar que, depois de remover a materialização redundante, o hot loop numérico continua sendo o limite e que uma implementação nativa protótipo preserva os hashes diferenciais com ganho material no mesmo ambiente.

