# Fase 6.15 — Checkpoint e recovery

Checkpoint V5 foi preservado: magic `PLCPV5`, versão 5, little-endian, metadata, comprimentos, arrays Float64, checksum de payload e hash semântico continuam iguais.

O protocolo durável usa arquivo temporário único, write, `sync`, decode completo, rename para uma geração nova e somente então atualização atômica do manifesto. A geração anterior nunca é apagada antes da promoção da seguinte. A retenção padrão é duas gerações válidas.

Recovery enumera candidatos, decodifica, valida checksum, algoritmo, versão, provider/configuração e iteração, ordena por iteração/generation e seleciona a válida mais recente. Timestamp não decide. Na campanha de fallback, geração 2 corrompida foi rejeitada e geração 1 restaurada; continuação até a iteração 8 foi bit a bit igual à baseline.

`file.sync()` e atomic rename foram usados. Não se afirma durabilidade contra queda de energia: fsync de diretório e persistência do dispositivo não foram provados no Windows disponível.
