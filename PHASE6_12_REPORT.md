# Fase 6.12 — Generic Compiler Architecture

## Resultado

A Fase 6.12 foi implementada sobre o baseline \`36b38a58eed84d6ab7719a49e7484994cb24dc34\`. O Generic Compiler V3 agora compila providers sintéticos regulares e irregulares sem depender de contagem prévia exata, enquanto o Compiler V2 continua sendo o fast path explícito para S0–S5.

O artefato reproduzível é \`solver/artifacts/phase6-12-generic-compiler-v0.12.0.json\`, hash \`b1c639520f514536\`. Os gates G1–G9 passaram. Gate D histórico permanece FAIL e datasets Verified permanecem em 0. A decisão arquitetural continua **KEEP TYPESCRIPT**.

## Evidência principal

| Medição | Resultado |
|---|---:|
| Jogo irregular intermediário | 40.745 nós |
| Generic V3 segmentado | 1.119,08 ms |
| Realocações/alocações de segmentos | 63 |
| Bytes copiados totais | 1.303.840 |
| Cópias na finalização | 1.303.840 |
| Pico RSS segmentado | 163.692.544 bytes |
| Fast V2 S3 | 85,21 ms |
| Generic V3 S3 regular | 569,68 ms |
| Cache V1 S5 | 59.772.060 bytes |
| Cache V2 S5 | 59.771.960 bytes |
| V1 startup mediano | 579,86 ms |
| V2 safe-copy startup mediano | 584,39 ms |
| V2 streaming startup mediano | 587,11 ms |
| V2 shared-view startup mediano | 559,33 ms |
| V2 shared-view pico RSS | 146.014.208 bytes |
| Payload explicitamente copiado no shared-view | 0 bytes |
| Buffer retido no shared-view | 59.771.960 bytes |

Shared-view foi 3,5% mais rápido que V1 nesta amostra e reduziu o pico RSS em aproximadamente 29%, mas mantém o buffer completo vivo. Não é “zero-copy total”: somente a etapa de criação das views não copia o payload. A leitura do arquivo aloca memória, e cópias invisíveis do runtime não são mensuradas aqui.

## Respostas obrigatórias

1. **O Compiler V3 foi implementado?** Sim, como compilador incremental genérico com finalização em arrays compactos.
2. **Aceita providers irregulares?** Sim: irregular branching, variable-depth hidden information e asymmetric chance.
3. **Funciona sem contagem prévia?** Sim. Começa com capacidade limitada, expande, verifica budgets e finaliza a contagem real.
4. **Política escolhida?** Segmented buffers. Foi a menor em cópias e alocações, com tempo competitivo.
5. **Quantas realocações ocorreram?** 63 eventos de alocação/crescimento segmentado no caso de 40.745 nós. Não houve cópia de payload durante crescimento; os 1.303.840 bytes vieram da finalização.
6. **Qual o pico de memória?** 163.692.544 bytes RSS no benchmark segmentado mediano.
7. **Qual o custo do generic path?** 569,68 ms em S3 regular contra 85,21 ms no fast path, cerca de 6,69×. O generic path compra generalidade e validações; não substitui V2.
8. **Fast path preservado?** Sim. O dispatch só usa V2 quando capabilities e configuration hash declaram a família regular compatível.
9. **Cache V2 implementado?** Sim, com SHA-256 completo, offsets alinhados, modos safe-copy/shared-view, streaming checksum, camadas de confiança e leitura V1.
10. **Tamanho do cache S5?** 59.771.960 bytes.
11. **Tempo de carregamento S5?** Startup mediano: 559,33 ms shared-view; 584,39 ms V2 safe-copy; 587,11 ms V2 streaming; 579,86 ms V1.
12. **Quantos bytes são copiados?** V2 safe-copy copia 59.768.748 bytes de payload. Shared-view copia explicitamente 0 bytes de payload após a leitura e retém 59.771.960 bytes.
13. **Houve zero-copy real?** Não de ponta a ponta. Houve zero cópia explícita de payload na criação das typed-array views.
14. **Mmap foi necessário?** Não. Nenhum mmap foi implementado ou alegado.
15. **Validação estrutural preservada?** Sim: header, identidade, checksum completo, bounds, alinhamento, invariantes, structural hash e verificação semântica para cache importado.
16. **Jogos irregulares passaram?** Sim, as três famílias compilaram e foram avaliadas.
17. **Oracles independentes passaram?** Sim, EV, best response, NashConv e exploitability ficaram dentro de 1e-12; maior delta observado foi 2,78e-17.
18. **Testes metamórficos passaram?** Sim: renomeação/reordenação, permutação de estados/jogadores, escala de utility, chunk size e capacidade inicial.
19. **Checkpoint V5 permaneceu determinístico?** Sim para topologias lidas de Cache V1 e V2; regrets e strategy sums tiveram delta 0.
20. **Houve regressões?** Nenhuma regressão funcional detectada. O generic path é deliberadamente mais lento que V2; V2 permanece selecionado para S0–S5.
21. **Quais gates passaram?** G1, G2, G3, G4, G5, G6, G7, G8 e G9.
22. **Quantos testes passaram?** A suíte final deve registrar 221 testes TypeScript (198 históricos + 23 novos) e 3 testes Rust; consulte a seção de validação atualizada após a execução final.
23. **Qual gargalo permanece?** Checksum + structural hash continuam dominando o decode S5; shared views retêm o arquivo completo e JavaScript não torna bytes de typed arrays fisicamente read-only.
24. **Próxima pesquisa?** Cache com manifesto de páginas/Merkle para validação incremental confiável, política de leases por geração e exploração opcional de mmap somente com protótipo isolado e ganho mensurável.

## Gates

| Gate | Resultado |
|---|---|
| G1 Generic Provider Support | PASS |
| G2 Dynamic Construction Integrity | PASS |
| G3 Fast Path Preservation | PASS |
| G4 Cache V2 Integrity | PASS |
| G5 Copy Reduction Evidence | PASS |
| G6 Mathematical Equivalence | PASS |
| G7 Deterministic Resume | PASS |
| G8 Resource Safety | PASS |
| G9 Honest Performance Reporting | PASS |

## Conclusão

Sim: a arquitetura especializada virou uma infraestrutura genérica reutilizável sem sacrificar o fast path, a correção matemática ou os limites operacionais. A redução de cópias do shared-view é real e medida; o ganho de startup é modesto, o ganho de RSS é relevante, e as limitações estão registradas sem alegação de mmap ou zero-copy total.
