# Fase 6.12 — Structural Cache V2

## Formato

O V2 usa prefixo fixo, manifesto JSON versionado e payload binário alinhado. O prefixo inclui magic \`PLSCV002\`, versão, comprimentos, offset e o SHA-256 completo de 32 bytes. O manifesto inclui identidade semântica, compiler/configuration hash, action ordering, utility model, structural hash, níveis e descritores de nove arrays.

Offsets, alinhamento, bounds, tipo, comprimento e endianness são verificados antes de construir os arrays. Depois vêm invariantes estruturais e structural hash.

## Modos

- **safe-copy:** aloca nove arrays próprios e copia 59.768.748 bytes no S5.
- **shared-view:** cria nove views, copia explicitamente 0 bytes de payload e retém o buffer de 59.771.960 bytes.
- **streaming integrity:** alimenta o SHA-256 em blocos de 1 MiB; não materializa outro payload, mas a leitura de arquivo continua sendo um Buffer.
- **V1 compatibility:** exige a identidade V1 explícita e passa pelo decoder legado.

## Trust policy

| Origem | Header | SHA-256 | Estrutural | Provider semântico |
|---|---|---|---|---|
| recém-gerado | obrigatório | obrigatório | obrigatório | não redundante |
| persistido local | obrigatório | obrigatório | obrigatório | opcional |
| importado | obrigatório | obrigatório | obrigatório | obrigatório |
| incompatível/corrompido | rejeitado | rejeitado | rejeitado | não usado |

A escrita atômica usa arquivo temporário, sync, releitura/validação e rename. Um destino válido é imutável; um destino incompatível não é sobrescrito.

## S5

V1: 59.772.060 bytes. V2: 59.771.960 bytes. Startups medianos foram 579,86 ms (V1), 584,39 ms (V2 safe), 587,11 ms (V2 streaming) e 559,33 ms (V2 shared). Shared-view reduziu pico RSS de 205.613.056 para 146.014.208 bytes, com a troca de manter o arquivo inteiro vivo.
