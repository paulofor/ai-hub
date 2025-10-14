import { Link } from 'react-router-dom';
import { useFetch } from '../hooks/useFetch';
import client from '../api/client';

interface Project {
  id: number;
  repo: string;
  repoUrl: string;
}

interface Prompt {
  id: number;
  repo: string;
  createdAt: string;
  prompt: string;
}

export default function DashboardPage() {
  const { data: projects } = useFetch<Project[]>(
    () => client.get('/projects').then((res) => res.data),
    []
  );
  const { data: prompts } = useFetch<Prompt[]>(
    () => client.get('/prompts').then((res) => res.data),
    []
  );

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Visão geral</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DashboardCard title="Criar Sistema" description="Inicie um novo projeto a partir de um blueprint">
          <Link to="/projects/new" className="text-sm font-semibold text-emerald-600">
            Abrir wizard →
          </Link>
        </DashboardCard>
        <DashboardCard title="Blueprints" description="Gerencie templates para stacks completas">
          <Link to="/blueprints" className="text-sm font-semibold text-emerald-600">
            Ver blueprints →
          </Link>
        </DashboardCard>
        <DashboardCard
          title="Projetos"
          description={`${projects?.length ?? 0} projetos registrados`}
        >
          <Link to="/projects" className="text-sm font-semibold text-emerald-600">
            Catálogo →
          </Link>
        </DashboardCard>
        <DashboardCard title="Falhas recentes" description="Acompanhe execuções com erro">
          <Link to="/prompts" className="text-sm font-semibold text-emerald-600">
            Abrir análises →
          </Link>
        </DashboardCard>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4">
          <h3 className="text-lg font-semibold mb-4">Projetos recentes</h3>
          <ul className="space-y-3">
            {projects?.slice(0, 5).map((project) => {
              const [owner, repo] = project.repo.split('/');
              return (
                <li key={project.id} className="flex items-center justify-between text-sm">
                  <span>{project.repo}</span>
                  <Link to={`/projects/${owner}/${repo}`} className="text-emerald-600">
                    Abrir
                  </Link>
                </li>
              );
            }) ?? <li className="text-sm text-slate-500">Nenhum projeto cadastrado</li>}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4">
          <h3 className="text-lg font-semibold mb-4">Falhas recentes</h3>
          <ul className="space-y-3 text-sm">
            {prompts?.slice(-5).reverse().map((prompt) => (
              <li key={prompt.id} className="border-b border-slate-100 dark:border-slate-800 pb-2">
                <div className="flex justify-between">
                  <span className="font-medium">{prompt.repo}</span>
                  <span className="text-xs text-slate-500">
                    {new Date(prompt.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-slate-600 dark:text-slate-300 overflow-hidden text-ellipsis whitespace-nowrap">
                  {prompt.prompt}
                </p>
              </li>
            )) ?? <li className="text-sm text-slate-500">Sem análises registradas</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}

function DashboardCard({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{description}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}
