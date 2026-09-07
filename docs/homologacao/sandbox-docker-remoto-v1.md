# Matriz de homologação — Docker remoto protegido da sandbox

Data: 2026-09-07

## Objetivo e causa-raiz

Permitir que uma sandbox autenticada pela identidade SSH persistente envie uma
imagem construída a partir dos arquivos versionados do repositório e execute
containers temporários para teste e depuração, sem reutilizar esse caminho como
publicação de produção.

Pergunta explícita: **por que a chave permanente, sozinha, não conclui esse
fluxo?** A identidade libera um shell remoto, mas não havia contrato para
transferência sem arquivo intermediário, segregação dos artefatos, limites de
recursos, auditoria do ciclo de vida ou limpeza. Comandos Docker livres como
`root` poderiam colidir com serviços publicados.

## Alternativas avaliadas

| Alternativa | Benefícios | Riscos/custo | Decisão |
| --- | --- | --- | --- |
| Copiar um tar por `scp` e executar `docker load` | Implementação curta | Duplica uso de disco e pode deixar arquivos grandes no host | Rejeitada |
| Usar diretamente um contexto Docker remoto irrestrito | Flexibilidade máxima | Torna fácil atingir containers, redes e imagens de produção por engano | Rejeitada como caminho padrão |
| Helper sobre `sandbox-ssh`, com streaming e namespace temporário | Sem tar remoto, segregação, limites e limpeza explícita | Mais implementação e testes | Escolhida |

## Gargalo, métrica e critérios

- Gargalo real: a identidade existe, mas a sandbox ainda não possui um fluxo
  seguro e repetível para homologação Docker nos hosts autorizados.
- Evidência: existe somente o helper genérico `sandbox-ssh`; não existe comando
  versionado para enviar, instalar, inspecionar e remover uma imagem temporária.
- Métrica esperada: 100% dos ciclos válidos fazem `push`, `run`, `exec`,
  `logs`, `inspect` e `cleanup`; zero arquivos tar ficam no destino; zero
  containers ou tags do namespace da sessão permanecem após a limpeza; zero
  recursos fora da sessão são alterados.
- Continuar: hash da imagem igual nas duas pontas, container identificado e
  limpeza integral.
- Ajustar: falha de streaming, hash divergente, colisão, ausência do Docker ou
  recurso residual.
- Parar: tentativa de modo privilegiado, host network, mount, destino fora da
  allowlist, imagem fora do namespace temporário ou qualquer alteração em
  serviço de produção.

## Matriz ponta a ponta definida antes dos testes

| Área | Cenário | Resultado esperado |
| --- | --- | --- |
| Caminho feliz | Enviar imagem local versionada por stdin | A imagem chega sob `aihubsbx/<sessão>/...`, sem tar no host, e mantém o mesmo image ID |
| Caminho feliz | Criar e iniciar container temporário | Nome e labels identificam sessão; CPU, RAM, PIDs, capabilities, restart e rede recebem limites seguros |
| Depuração | Executar comando, consultar logs e inspecionar | Somente container gerenciado da sessão é aceito e a saída fica disponível ao operador |
| Validação | Sessão, artefato, tag, nome ou limite malformado | Rejeição local antes de abrir conexão SSH |
| Validação | Imagem local inexistente ou Docker remoto ausente | Falha clara, sem criar estado parcial |
| Falha | Image ID remoto diverge do local | Operação falha e não declara sucesso |
| Falha | Nome já ocupado ou recurso sem labels esperados | Rejeição sem sobrescrever/remover o recurso existente |
| Segurança | Destino fora da allowlist | `sandbox-ssh` nega antes da rede |
| Segurança | Tentativa de `privileged`, host network, mount ou socket | O helper não oferece essas opções; contrato estático impede sua inclusão |
| Integração | Socket do agente reinicia | A mesma chave pública continua assinando e o helper volta a funcionar |
| Observabilidade | Cada operação | Evento conciso informa destino, sessão, recurso e resultado, sem chave ou token |
| Métricas/segregação | Duas sessões e recurso externo | Filtros/labels isolam sessões; `cleanup` de uma não toca a outra nem o recurso externo |
| Limpeza | Container em execução e tag carregada | Remove apenas os recursos gerenciados da sessão e termina idempotente |
| Produção | Uso de imagem como serviço definitivo | Documentação e instrução operacional exigem PR/pipeline; helper é exclusivo para teste/depuração |
| Navegadores/dispositivos | Desktop, iPhone e Android | Não se aplica: fluxo de infraestrutura sem interface; UIs hospedadas pelo container devem ser homologadas separadamente |

Uma primeira rodada local completa será suficiente se não revelar defeito. Se
houver correção depois de falha, a contagem será reiniciada e serão exigidas duas
rodadas completas e consecutivas sem falhas.

## Resultado

O primeiro ensaio de validação estática encontrou uma expressão ambígua
`A && B || C` na cardinalidade de argumentos de `logs`. A causa foi a tentativa
de condensar uma ramificação de validação; ela foi substituída por um `if`
explícito. O preflight também foi ajustado para exportar as variáveis das
fixtures e executar Actionlint estrutural e ShellCheck separadamente, sem
misturar avisos antigos do workflow com os scripts deste fluxo.

Depois da correção, duas rodadas locais completas e consecutivas passaram em
07/09/2026. Em cada rodada:

- `96/96` testes do `sandbox-orchestrator` passaram;
- ShellCheck dos helpers e harnesses, Actionlint, três contratos Compose e
  `git diff --check` passaram;
- a imagem real do orquestrador foi construída pelo Dockerfile do repositório;
- uma imagem de fixture foi transmitida por stdin, carregada com o mesmo image
  ID e executada sem arquivo tar remoto;
- `run`, `exec`, `logs`, `inspect`, rejeição de hash divergente, host network,
  colisão e recurso sem labels passaram;
- duas sessões e um container externo foram criados; a limpeza de uma sessão
  preservou integralmente os outros recursos e a segunda limpeza foi
  idempotente;
- RAM de 1 GiB, uma CPU, 256 PIDs, restart `no`, rede `none`,
  `no-new-privileges` e `cap-drop=ALL` foram confirmados no container real;
- uma chave Ed25519 efêmera foi carregada no sidecar, permaneceu ausente do
  probe/orquestrador e conservou o fingerprint depois do reinício;
- o segredo protegido `SANDBOX_OPS_SSH_PRIVATE_KEY` foi confirmado por
  metadado no GitHub sem recuperar seu valor;
- nenhum conteúdo de chave privada foi encontrado nos arquivos versionados.

Toda a topologia usou o projeto Compose exclusivo
`aihub-727f9875-f044-41b5-8981-f44437fd42ca-4bf945b770`. Ao final das duas
rodadas restaram zero containers e zero volumes do projeto, além de zero
containers ou tags das sessões remotas simuladas.

Limitação externa: esta sandbox foi iniciada antes do deploy do sidecar e não
possui `SSH_AUTH_SOCK`. A autenticação nos VPS e o ensaio com seus daemons Docker
reais dependem do cadastro da chave pública e da publicação normal por PR; não
foram usados como mecanismo de teste local.
