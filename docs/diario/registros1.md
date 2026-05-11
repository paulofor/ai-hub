# Registros — AI HUB 6

> Orientação: todos os registros deste documento devem sempre incluir **data e hora no fuso UTC-3**.
> Neste documento segue política de **append-only** (não pode ter nenhuma linha apagada; apenas inserções).

> Regra obrigatória de timestamp:
> Antes de adicionar qualquer novo registro, execute obrigatoriamente:
>
> ```bash
> TZ=America/Sao_Paulo date '+%Y-%m-%d %H:%M:%S UTC-3'
> ```
>
> Use exatamente a saída desse comando no título do novo registro.
> É proibido inventar, estimar, inferir ou reaproveitar data/hora a partir de:
> - contexto da conversa;
> - data do commit;
> - data do CI/build;
> - metadados do arquivo;
> - relógio UTC sem conversão explícita;
> - registros anteriores deste documento.
>
> O formato obrigatório do título é:
>
> ```md
> ## YYYY-MM-DD HH:mm:ss UTC-3
> ```
>
> Cada novo registro deve ser adicionado no final do arquivo.
> Se for necessário registrar mais de uma entrada, execute novamente o comando de data/hora para cada entrada.
> Nunca crie registro com timestamp futuro em relação ao horário atual de `America/Sao_Paulo`.
> Em caso de timestamp incorreto já registrado, não apague nem edite o registro antigo; adicione um novo registro de correção explicando o erro.
> Neste documento segue política de **append-only** (não pode ter nenhuma linha apagada; apenas inserções).

## 2026-05-11 — Fase 1 do plano Codex ChatGPT managed
- Implementada rota frontend `/codex-chatgpt` com nova página `CodexChatgptPage`.
- Adicionado acesso no menu lateral e card no dashboard para abertura do novo módulo.
- MVP da autenticação conectado aos endpoints `POST /account/login/start`, `GET /account/read` e `POST /account/logout`.
- Bloqueio funcional do uso quando conta não está conectada, conforme fase 1 do plano.

## 2026-05-11 11:26:30 UTC-3
- Correção de registro: a entrada anterior usou título fora do padrão obrigatório de timestamp UTC-3.
- Execução da fase 1 do plano `docs/plano-codex-chatgpt-managed.md` no frontend com rota `/codex-chatgpt`, menu/dashboard atualizados e fluxo de autenticação MVP (`/account/login/start`, `/account/read`, `/account/logout`).
- Bloqueio explícito de uso da área quando a conta não estiver conectada.
