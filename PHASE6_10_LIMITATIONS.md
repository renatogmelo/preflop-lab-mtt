# Phase 6.10 — Limitations

1. S5 é um jogo sintético de arquitetura; não é uma árvore MTT 8-max verificada nem prova “poker perfeito”.
2. Uma iteração não demonstra convergência. Exploitability `0,3956` e NashConv `0,7912` confirmam que o estado não é equilíbrio aproximado.
3. A validação de subárvore prova estrutura/utilities/traversal no recorte, não equivalência estratégica independente do jogo completo.
4. RSS do Windows é amostrado a cada 500 ms. `maxRSS` do filho fecha parte da lacuna, mas nenhum deles é um hard cap nativo de Job Object.
5. `--max-old-space-size` limita heap antigo do V8, não toda memória external/ArrayBuffer/RSS.
6. O modelo foi calibrado nas escalas S2–S4 e extrapolado uma ordem de grandeza. S5 ficou abaixo da projeção, mas outros formatos exigem nova calibração.
7. Runtime inclui loader TypeScript. Produção compilada pode ter outro perfil; isso precisa de benchmark separado, não inferência.
8. O checkpoint V5 é menor e serializa mais rápido, mas desserializou mais lentamente em S4.
9. Atomic rename depende do filesystem/plataforma; backup recuperável não protege contra todos os cenários de hardware/energia.
10. A execução é single-process/single-worker e não usa SIMD/GPU/Rust. Nenhuma migração foi justificada automaticamente.
11. Compilação S5 domina o runtime e permanece o principal gargalo.
12. Tier 1 foi validado como política/envelope, mas não recebeu um benchmark separado rotulado Tier 1 nesta fase.
13. Os resultados de performance pertencem à máquina/execução registradas no artefato; não são garantia universal.
14. Gate D histórico continua FAIL e `Verified` continua 0.
15. Nenhuma estratégia, range ou recomendação de apostas do produto foi alterada.

## Escopo de confiança

O veredito `PHASE_6_10_RESEARCH_GATES_PASS` significa que a infraestrutura experimental passou seus gates R1–R8. Não promove dados de poker, não transforma S5 em solução convergida e não autoriza Tier 2 como padrão.
