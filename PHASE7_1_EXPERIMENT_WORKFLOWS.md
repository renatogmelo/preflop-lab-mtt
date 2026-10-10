# Fase 7.1 — Workflows de Experimento

## Criação

O wizard cobre: jogo, algoritmo, parâmetros, orçamento, avaliação, checkpoint, validação e execução. A configuração é enviada como `research-experiment-v1`; a UI não adapta silenciosamente valores rejeitados.

## Gestão

Listagem com busca por identidade/jogo/algoritmo, status, ordenação, paginação, progresso real, datas, duração e disponibilidade de resultado.

## Execução

Start cria o worker isolado via SDK. A tela mostra estado, iterações, elapsed/runtime final, throughput final, pico RSS, checkpoints e eventos reais. Cancelamento exige confirmação. Resume só é oferecido a estados interrompidos com checkpoint encontrado.

## Resultado

Result V1 expõe configuração, algoritmo, métricas, convergência, recursos, validação, hashes, limitações e histórico. JSON preserva o artefato integral; CSV contém série numérica e metadados de proveniência.

## Comparação

Dois ou três resultados podem ser comparados. Diferença de provider ou orçamento gera aviso de não comparabilidade; nenhuma curva é inventada quando a série está vazia.
