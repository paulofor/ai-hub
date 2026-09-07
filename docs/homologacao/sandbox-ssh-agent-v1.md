# Matriz de homologação — acesso SSH persistente da sandbox

Data: 2026-09-06

## Objetivo e decisão

Persistir uma identidade SSH operacional entre execuções sem montar, versionar,
registrar em logs ou entregar a chave privada à sandbox. O acesso deve permanecer
restrito aos hosts explicitamente autorizados e falhar fechado para qualquer outro
destino.

Pergunta de causa raiz: **por que o acesso anterior desapareceu?** A chave privada
foi criada dentro de uma sandbox efêmera. Apenas a chave pública continuou nos VPS;
nenhum componente persistente do orquestrador guardava ou carregava a identidade.

Alternativas consideradas:

| Alternativa | Benefício | Risco/custo | Decisão |
| --- | --- | --- | --- |
| Montar a chave privada no orquestrador | Implementação curta | O agente poderia ler e copiar o segredo | Rejeitada |
| Criar uma chave por execução | Boa segregação temporal | Exige novo cadastro a cada job e não resolve a permanência | Rejeitada |
| Chave fora do repositório + `ssh-agent` lateral | Persiste, permite rotação e expõe apenas operações de assinatura | Implementação e operação moderadas | Escolhida |

## Gargalo, métrica e critérios

- Gargalo real: zero identidades SSH reutilizáveis na sandbox atual.
- Evidência inicial: havia somente `known_hosts`; não existiam chave privada,
  socket de agente ou serviço de carregamento no Compose.
- Métrica esperada: 100% das novas execuções enxergam o mesmo fingerprint pelo
  socket e autenticam nos destinos cadastrados; 0 bytes da chave privada aparecem
  no workspace, imagem, ambiente, logs ou diff.
- Continuar: fingerprint estável, destinos permitidos autenticam e destinos não
  permitidos são negados antes da rede.
- Ajustar: socket indisponível, host key divergente, permissão do segredo inválida
  ou falha após reinício.
- Parar/revogar: fingerprint inesperado, acesso fora da allowlist ou qualquer
  evidência de exposição da chave privada.

## Matriz ponta a ponta local

| Área | Cenário | Resultado esperado |
| --- | --- | --- |
| Caminho feliz | Carregar uma chave Ed25519 válida no agente lateral | Um único fingerprint é listado; a chave privada não é montada no orquestrador |
| Persistência | Reiniciar o agente usando o mesmo segredo externo | O fingerprint permanece idêntico e o socket volta a responder |
| Validação | Chave ausente | Aplicação principal pode iniciar, mas o agente fica sem identidade e SSH falha fechado |
| Validação | Chave com permissão diferente de `0600` | O agente rejeita o segredo |
| Validação | Allowlist vazia ou destino malformado | O agente rejeita a carga da identidade |
| Falha | Destino fora da allowlist | O wrapper encerra antes de chamar a rede |
| Integração | `docker compose config` | Serviço lateral, volume somente-socket e dependência saudável são válidos |
| Integração | Imagem do orquestrador | Scripts, host keys fixadas e cliente OpenSSH estão presentes |
| Observabilidade | Inicialização e healthcheck | Logs mostram apenas estado/fingerprint público; healthcheck diferencia socket ausente de agente vazio |
| Segregação | Inspeção de mounts, ambiente, imagem e diff | Nenhum conteúdo de chave privada está presente fora do diretório temporário/segredo externo |
| Publicação | Workflow de deploy | Segredo é validado, transmitido por stdin, salvo fora do repositório com `0600` e conferido contra a chave pública versionada |
| Destinos reais | Autenticação `BatchMode=yes` nos quatro VPS | Pendente até cadastro da chave pública pelo proprietário e deploy pelo fluxo de PR |
| Navegadores/dispositivos | Desktop, iPhone e Android | Não se aplica: mudança exclusivamente de infraestrutura sem interface visual |

Se qualquer cenário local revelar defeito, após a última correção serão exigidas
duas rodadas completas e consecutivas sem falhas.

## Implementação realizada

- A identidade Ed25519 foi gerada localmente e a chave privada foi armazenada no
  segredo protegido `SANDBOX_OPS_SSH_PRIVATE_KEY` do GitHub Actions.
- O workflow valida a correspondência entre o segredo e a chave pública antes de
  gravar a identidade fora do repositório, em
  `/root/infra/sandbox-ssh/id_ed25519`, com modo `0600`.
- O sidecar `sandbox-ssh-agent` não possui rede e é o único serviço que monta a
  chave privada. O orquestrador recebe somente o socket Unix como read-only.
- O agente aplica restrições OpenSSH por destino e host key. O helper
  `sandbox-ssh` também exige allowlist, host key fixada, autenticação não
  interativa e bloqueia senha, PTY e encaminhamentos.
- A ausência do segredo mantém o agente vazio e saudável, mas qualquer tentativa
  de SSH falha fechada.

## Defeitos encontrados e correções causais

1. O primeiro processo `ssh-agent` se daemonizava; por isso o entrypoint tentava
   aguardar um PID que já não era seu filho. O agente passou a executar em
   foreground e a ser encerrado pelo trap do sidecar.
2. O socket podia existir antes de a identidade estar carregada. Foi criado um
   marcador de prontidão somente depois da carga bem-sucedida ou do estado vazio
   explícito.
3. O deploy ainda aceitava qualquer host key com
   `StrictHostKeyChecking=no`. As chaves dos quatro hosts foram fixadas e a conexão
   de provisionamento agora exige `StrictHostKeyChecking=yes`.
4. A chave derivada por `ssh-keygen -y` podia conter comentário, produzindo uma
   comparação textual falsa. A verificação passou a comparar apenas algoritmo e
   material público.
5. Dois comandos iniciais do harness interpretavam como erro o retorno esperado
   do agente vazio e a frase de detecção presente no próprio teste. A homologação
   passou a capturar o status esperado e procurar o marcador estrutural completo
   de uma chave privada.

## Resultado final

Duas rodadas locais completas e consecutivas terminaram sem falhas em
07/09/2026. Em cada rodada:

- `94/94` testes do `sandbox-orchestrator` passaram;
- ShellCheck, Actionlint, `docker compose config` e `git diff --check` passaram;
- a imagem real do orquestrador/sidecar foi construída pelo Dockerfile;
- o agente vazio permaneceu saudável e sem identidade;
- o segredo de teste foi carregado por volume segregado, sem rede nem bind mount;
- o orquestrador enxergou somente o socket e não encontrou o arquivo privado;
- destino fora da allowlist e assinatura genérica foram bloqueados;
- após reinício, o fingerprint permaneceu
  `SHA256:NJ2GkGnHsfNjeA9FDUoL+PQLHPCB9JNnysoonLtjvkc`;
- a chave pública derivada correspondeu ao arquivo versionado e o metadado do
  segredo protegido foi confirmado, sem leitura do valor.

Ao final, a cópia privada temporária foi destruída, a imagem de homologação foi
removida e restaram zero containers e volumes do projeto Compose exclusivo.

## Limitação externa preservada

A autenticação nos quatro VPS não pode ser concluída antes que o proprietário
cadastre a nova chave pública. O mecanismo permanece somente na worktree até PR,
merge e deploy; nenhum host, imagem de produção ou serviço publicado foi alterado
para testar.
