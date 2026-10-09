# Fase 6.13 — Auditoria matemática

Baseline auditado: `8cd893ff0118ebcd84ee9abfd37baf2538f2c600`.

Foram revisados os relatórios 6.7–6.12, `SOLVER_VALIDATION.md`, `SOLVER_PROGRESS.md`, `PROGRESS.md` e as implementações reais de CFR orientado a objetos, indexado e compacto, regret matching, médias, avaliadores de EV/BR/NashConv e Checkpoint V5.

## Achados

Os motores CFR promovidos implementavam atualização alternada, CFR+, DCFR e média ponderada conforme suas funções públicas. Porém, seus regrets eram mutados imediatamente em cada ocorrência de um infoset. Quando o mesmo infoset aparecia em múltiplas histórias, a segunda ocorrência podia usar uma estratégia diferente da primeira dentro da mesma travessia. Isso viola a definição de uma iteração CFR, que exige um perfil fixo para calcular todos os deltas daquela atualização.

A correção congela o vetor de estratégia no início da travessia de cada jogador, acumula deltas de regret e de média em buffers separados e só então os aplica. CFR+ recorta depois da soma completa do infoset. A atualização alternada entre jogadores foi preservada.

O defeito foi reproduzido numa árvore com chance, informação privada e um infoset de P1 compartilhado por duas histórias. Após a correção, a comparação independente produziu delta zero por iteração em CFR, CFR+ e DCFR.

## Classificação dos componentes

| Componente | Evidência 6.13 | Classificação interna |
|---|---|---|
| Regret matching / matching+ | vetores analíticos e bordas | Nível 1 |
| Compact CFR/CFR+/DCFR | diferencial independente 0/1/2/25 | Nível 2 |
| EV compacto genérico | oráculo recursivo direto | Nível 2 |
| Best response / NashConv | enumeração independente de políticas puras | Nível 2 |
| Propriedades/metamorfismos | 32 jogos, 96 casos algorítmicos | Nível 3 |
| Checkpoint V5 | retomada bit-exata nos 3 algoritmos | Nível 3 |
| Convergência profunda | apenas sanity check de 2.000 iterações | não promovida |
| Estratégias/datasets de poker | fora do escopo | Unverified |

O solver não foi usado como próprio oráculo: a referência percorre diretamente o Provider V2, mantém estado em `Map`/arrays JS e não importa topologia compacta, acumuladores ou avaliador de BR do motor de produção.
