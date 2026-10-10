# Fase 6.15 — Crash injection

Seeds/configurações são fixas. Nove children foram encerrados abruptamente nos pontos: antes/durante serialização, após temp write, antes/após rename, antes/após manifesto, término externo e timeout do watchdog.

Cada caso reiniciou em novo processo lógico, descobriu a última geração íntegra, restaurou, continuou e comparou regrets, strategy sums, average strategy, state hash, EV, NashConv e exploitability. Resultado: 9/9 PASS, delta máximo zero.

No Windows, `child.kill("SIGKILL")` é a solicitação de término forçado oferecida pelo Node; não se presume equivalência perfeita com sinais POSIX. Outros sistemas operacionais não foram testados.
