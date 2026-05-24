export default function PrivacyPage() {
  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Política de Privacidade</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Esta página descreve, de forma resumida, como dados são tratados no AI Hub durante o uso da aplicação.
      </p>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 space-y-4">
        <h3 className="text-lg font-semibold">1. Dados coletados</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Podemos processar dados de autenticação OAuth, metadados de execução, logs operacionais e informações
          necessárias para viabilizar os fluxos do produto.
        </p>

        <h3 className="text-lg font-semibold">2. Finalidade de uso</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Os dados são utilizados para autenticação, execução de funcionalidades, observabilidade, suporte e melhoria
          contínua da plataforma.
        </p>

        <h3 className="text-lg font-semibold">3. Compartilhamento e retenção</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Os dados não são compartilhados fora dos provedores e serviços necessários à operação. A retenção segue as
          políticas internas e exigências legais aplicáveis.
        </p>

        <h3 className="text-lg font-semibold">4. Segurança</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Aplicamos controles técnicos e operacionais para reduzir riscos de acesso indevido, alteração ou perda de
          dados.
        </p>

        <h3 className="text-lg font-semibold">5. Contato</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Para dúvidas sobre privacidade ou exercício de direitos do titular, entre em contato com o responsável pelo
          ambiente da sua organização.
        </p>
      </div>
    </section>
  );
}
