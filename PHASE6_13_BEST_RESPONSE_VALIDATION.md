# Fase 6.13 — Validação de best response

O novo oráculo enumera políticas puras completas de um jogador e avalia cada uma por recursão direta contra a estratégia comportamental fixa do oponente. A escolha de uma ação é compartilhada por todas as histórias do mesmo infoset; portanto, o oráculo respeita informação oculta e não faz maximização ilegal nó a nó.

Foram comparados EV do perfil, BR de ambos os jogadores, NashConv e exploitability nas cinco fixtures. Máximos deltas: EV `0`, BR `0`, NashConv `0`. Empates usam a primeira política na ordem canônica, sem afetar o valor.

Convenção: `NashConv=Σ_i(BR_i-u_i)` e `exploitability=NashConv/2`. O orçamento padrão é 100.000 políticas por jogador; excedê-lo falha explicitamente. Isso torna o oráculo auditável e seguro, mas inadequado para jogos grandes.
