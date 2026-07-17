import { Link } from 'react-router-dom';

const stages = [
  {
    title: '1. Construção',
    description: 'O modelo construtor implementa a solicitação em um sandbox com permissão de escrita.'
  },
  {
    title: '2. Avaliação',
    description: 'A persona avalia um snapshot imutável em sandbox somente leitura e devolve feedback estruturado.'
  },
  {
    title: '3. Evolução',
    description: 'Os pontos priorizados voltam ao construtor para uma nova iteração, até o limite definido.'
  }
];

export default function PersonaReviewPage() {
  return (
    <section className="space-y-6">
      <header className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-cyan-50 p-6 dark:border-indigo-900 dark:from-indigo-950/40 dark:to-cyan-950/30">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Nova modalidade de solicitação</p>
        <h2 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Construir e validar com persona</h2>
        <p className="mt-2 max-w-3xl text-slate-700 dark:text-slate-200">
          Um modelo constrói o produto e outro avalia a experiência como uma persona do público-alvo. O feedback vira insumo
          para a próxima iteração, preservando a versão avaliada e as evidências de teste.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {stages.map((stage) => (
          <article key={stage.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h3 className="font-semibold text-slate-900 dark:text-white">{stage.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{stage.description}</p>
          </article>
        ))}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <h3 className="font-semibold">Disponível como ponto de entrada do menu</h3>
        <p className="mt-1 text-sm leading-6">
          A execução automatizada ainda depende da implementação do novo perfil no backend e no Sandbox Orchestrator. Quando estiver pronta,
          esta página receberá o formulário para selecionar os dois modelos, definir a persona, critérios de aceite e máximo de iterações.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          to="/codex"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
        >
          Enviar solicitação Codex atual
        </Link>
      </div>
    </section>
  );
}
