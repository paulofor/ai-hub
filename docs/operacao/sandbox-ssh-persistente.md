# Acesso SSH persistente e protegido da sandbox

## Arquitetura

O acesso operacional usa uma identidade Ed25519 estável, mas a chave privada não
é montada no `sandbox-orchestrator`. O fluxo é:

1. o segredo `SANDBOX_OPS_SSH_PRIVATE_KEY` fica protegido no GitHub Actions;
2. o deploy confere se ele corresponde a
   `apps/sandbox-orchestrator/ssh/operator_key.pub`;
3. a conexão de provisionamento exige a host key fixada do servidor de deploy;
4. a chave é gravada fora do repositório, em
   `/root/infra/sandbox-ssh/id_ed25519`, com modo `0600`;
5. o sidecar `sandbox-ssh-agent`, sem rede, é o único container que monta o
   arquivo privado;
6. o `sandbox-orchestrator` monta somente o socket do agente como read-only;
7. `ssh-add` aplica restrições de destino vinculadas às host keys versionadas;
8. jobs usam `sandbox-ssh usuario@host comando`, que exige allowlist,
   `BatchMode=yes`, host key fixa e desabilita senha, PTY e encaminhamentos.
9. homologações Docker usam `sandbox-remote-docker`: a imagem construída pelos
   arquivos versionados é transmitida por stdin e executada somente no namespace
   temporário da sessão, com labels, limites e limpeza próprios.

Se o segredo não existir, o agente sobe vazio para não derrubar o Marketing Hub,
mas qualquer autenticação SSH falha fechada. Em produção, o workflow exige que o
fingerprint correto esteja carregado antes de considerar o deploy saudável.

## Chave pública operacional

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK+poajAToxY0q9h+YhYmnoF1QlUXIDneBD9QAJIURqA codex-ops-ai-hub-2026-09-06
```

Fingerprint SHA-256:

```text
SHA256:NJ2GkGnHsfNjeA9FDUoL+PQLHPCB9JNnysoonLtjvkc
```

Cadastre somente essa linha pública no `authorized_keys` dos hosts autorizados.
Nunca copie a chave privada para o workspace, `.env`, conversa, log ou arquivo
versionado.

Quando o OpenSSH do host aceitar a opção, prefira cadastrar a linha com o prefixo
`restrict`, que bloqueia forwarding, PTY e recursos auxiliares sem impedir os
comandos remotos necessários para streaming de imagens e operação de containers:

```text
restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK+poajAToxY0q9h+YhYmnoF1QlUXIDneBD9QAJIURqA codex-ops-ai-hub-2026-09-06
```

## Destinos atuais

- `root@163.245.203.201`
- `root@163.245.200.7`
- `root@191.252.181.168`
- `root@191.252.210.83`
- `root@163.245.202.80`

Adicionar ou trocar um destino exige fixar previamente sua host key em
`apps/sandbox-orchestrator/ssh/known_hosts` e atualizar
`SANDBOX_SSH_ALLOWED_DESTINATIONS`. Uma divergência de host key deve interromper o
acesso; não use `StrictHostKeyChecking=no` como correção.

## Homologação Docker remota

O helper operacional cobre o ciclo temporário completo:

```bash
sandbox-remote-docker push root@HOST sessao imagem-local:teste app:teste
sandbox-remote-docker run root@HOST sessao app app:teste
sandbox-remote-docker exec root@HOST sessao app comando argumento
sandbox-remote-docker logs root@HOST sessao app 200
sandbox-remote-docker inspect root@HOST sessao app
sandbox-remote-docker cleanup root@HOST sessao
```

No `push`, a validação compara um digest canônico calculado sobre plataforma,
configuração de execução e layers da imagem. Ela não compara o `.Id` textual do
Docker, que pode variar na representação entre versões mesmo após uma
transferência íntegra.

O `push` usa `docker image save | ssh docker image load`, compara esse digest nas
duas pontas e não grava tar no destino. `run` recusa colisões e aplica memória,
CPU, PIDs, `no-new-privileges`, `cap-drop=ALL`, restart `no` e rede `none` por
padrão. `cleanup` remove apenas containers com os dois labels de gerenciamento e
tags `aihubsbx/<sessao>/...`; recursos externos ou de outra sessão são
preservados.

O helper não aceita `privileged`, host network, mounts ou socket Docker. Para
integração temporária, uma rede Docker nominal pode ser informada por
`SANDBOX_REMOTE_DOCKER_NETWORK`; `host` permanece proibida. Produção continua
obrigatoriamente no fluxo versionado de Pull Request e pipeline.

## Rotação

1. Gere uma nova chave Ed25519 fora do repositório.
2. Troque somente a chave pública versionada e registre o novo fingerprint.
3. Atualize `SANDBOX_OPS_SSH_PRIVATE_KEY` sem imprimir seu conteúdo.
4. Cadastre a nova pública nos hosts antes do deploy.
5. Faça deploy e valide o fingerprint pelo socket.
6. Remova a chave pública antiga dos hosts.

O segredo anterior deve ser revogado imediatamente se houver indício de exposição.
