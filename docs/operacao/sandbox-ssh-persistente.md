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

## Destinos atuais

- `root@163.245.203.201`
- `root@163.245.200.7`
- `root@191.252.181.168`
- `root@191.252.210.83`

Adicionar ou trocar um destino exige fixar previamente sua host key em
`apps/sandbox-orchestrator/ssh/known_hosts` e atualizar
`SANDBOX_SSH_ALLOWED_DESTINATIONS`. Uma divergência de host key deve interromper o
acesso; não use `StrictHostKeyChecking=no` como correção.

## Rotação

1. Gere uma nova chave Ed25519 fora do repositório.
2. Troque somente a chave pública versionada e registre o novo fingerprint.
3. Atualize `SANDBOX_OPS_SSH_PRIVATE_KEY` sem imprimir seu conteúdo.
4. Cadastre a nova pública nos hosts antes do deploy.
5. Faça deploy e valide o fingerprint pelo socket.
6. Remova a chave pública antiga dos hosts.

O segredo anterior deve ser revogado imediatamente se houver indício de exposição.
