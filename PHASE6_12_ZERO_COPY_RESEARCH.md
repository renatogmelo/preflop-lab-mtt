# Fase 6.12 — Pesquisa de Zero-Copy

## O que foi medido

Copy accounting distingue leitura do arquivo, alocação do Buffer de entrada, cópias explícitas do payload, arrays próprios, views e bytes retidos. Cópias internas invisíveis permanecem \`null\`, não estimadas.

No S5:

- safe-copy: 59.768.748 bytes explicitamente copiados, nove backing arrays;
- shared-view: 0 bytes de payload explicitamente copiados, zero backing arrays adicionais, nove views;
- shared-view retém 59.771.960 bytes do arquivo;
- pico RSS mediano shared-view: 146.014.208 bytes;
- pico RSS mediano V1: 205.613.056 bytes.

## Conclusão honesta

Há **zero cópia explícita do payload na construção das views**, não zero-copy de ponta a ponta. \`readFile\` ainda traz o arquivo para memória. Node/V8 e o sistema operacional podem copiar bytes internamente, e isso não foi instrumentalizado. Nenhum mmap foi usado.

\`Object.freeze(tree)\` só congela as propriedades do objeto, não os bytes de typed arrays. O \`SharedTopologyLease\` mantém o backing buffer vivo e consegue recalcular o checksum para detectar mutação. O benchmark não recalcula o checksum imediatamente após o load, pois a integridade acabou de ser verificada; o consumidor pode auditar o lease em limites de confiança.

Mmap não foi implementado porque exigiria dependência nativa, protocolo de lifetime e proteção contra mutabilidade. A evidência atual não justifica essa complexidade.
