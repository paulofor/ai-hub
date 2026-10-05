export function isMarketingHubFlow(profile: string, environment: string): boolean {
  return profile === 'CHATGPT_CODEX_MKT'
    && environment.trim().split('@', 1)[0].replace(/\.git$/i, '').toLowerCase() === 'paulofor/marketing-hub';
}

// The full, versioned execution policy is injected by the orchestrator, including
// requests submitted without this UI. Keep this a short statement of context.
export const MARKETING_HUB_REQUEST_CONTEXT = 'Neste ambiente paulofor/marketing-hub, use a cadeia de valor indicada pelo usuário (referência inicial: http://191.252.181.168:5173/business-process-chains?chainId=26) e os agentes em http://191.252.181.168:5173/agents. Confirme o estado atual e o gargalo; nos pedidos de execução, avance até o aceite solicitado ou um bloqueio externo comprovado. Resolva o caso e melhore a causa compartilhada no processo ou agente para os próximos produtos, com evidência e teste de regressão. Informe avanço do produto, melhoria reutilizável e pendência real; preserve pedidos somente de análise e autorizações comerciais.';
