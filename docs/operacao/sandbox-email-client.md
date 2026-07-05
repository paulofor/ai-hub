# Cliente de e-mail para testes na sandbox

## Pergunta de causa raiz

Por que hoje o modelo não consegue testar fluxos de e-mail de ponta a ponta?

A sandbox já permite executar comandos, rodar navegador headless e consultar HTTP, mas não oferece um serviço SMTP/IMAP/Webmail descartável e previsível dentro do ambiente de teste. Sem uma caixa postal efêmera, o agente consegue no máximo inspecionar código ou simular chamadas, mas não validar envio, renderização e leitura real de mensagens transacionais.

## Implementação

A stack agora oferece um serviço local de captura de e-mail baseado em **Mailpit**, porque ele expõe SMTP, UI web e API HTTP simples no mesmo serviço. O serviço é interno ao compose e não publica portas diretamente na internet.

## Arquitetura

1. O `docker-compose.yml` define o container `sandbox-mail`, sem publicação de portas no host.
2. O `sandbox-mail` fica somente na rede interna do compose, com alias estável.
3. O `sandbox-orchestrator` recebe variáveis padrão de teste:
   - `SANDBOX_SMTP_HOST=sandbox-mail`
   - `SANDBOX_SMTP_PORT=1025`
   - `SANDBOX_MAIL_WEB_URL=http://sandbox-mail:8025`
   - `SANDBOX_MAIL_API_URL=http://sandbox-mail:8025/api/v1`
4. O perfil `CHATGPT_CODEX_MKT` comunica ao modelo que há SMTP local e API/UI de inspeção de mensagens.
5. Opcionalmente, uma próxima etapa pode criar uma tool dedicada `mail_search`/`mail_read`; por enquanto, o agente consegue usar `run_shell` com `curl` contra a API HTTP interna.

## Compose implementado

```yaml
sandbox-mail:
  image: axllent/mailpit:latest
  restart: unless-stopped
  networks:
    default:
      aliases:
        - sandbox-mail
```

## Como o agente usaria

- Configuraria a aplicação sob teste para SMTP host `sandbox-mail` e porta `1025`.
- Executaria o fluxo funcional ou teste automatizado que dispara e-mail.
- Consultaria as mensagens por HTTP, por exemplo: `curl http://sandbox-mail:8025/api/v1/messages`.
- Abriria detalhes da mensagem para validar destinatário, assunto, corpo HTML/texto, links e anexos.

## Segurança e isolamento

- Não usar credenciais reais de SMTP em testes da sandbox.
- Não expor a UI do Mailpit publicamente; acesso somente pela rede interna ou por proxy autenticado se houver necessidade humana.
- Limpar mensagens entre jobs quando o isolamento por job for importante.
- Preferir nomes de destinatário descartáveis, como `teste+<jobId>@sandbox.local`.

## Evolução recomendada

A evolução mais robusta é criar uma instância por job ou namespacear destinatários por `jobId`. Isso evita que testes simultâneos leiam mensagens uns dos outros e torna as validações reproduzíveis.
