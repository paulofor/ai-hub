import { Link } from 'react-router-dom';
import { useFetch } from '../hooks/useFetch';
import client from '../api/client';

interface Project {
  id: number;
  org: string;
  repo: string;
  repoUrl: string;
  createdAt: string;
}

export default function ProjectsPage() {
  const { data, loading, error } = useFetch<Project[]>(
    () => client.get('/projects').then((res) => res.data),
    []
  );

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Projetos</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Catálogo de sistemas criados via AI Hub. Acesse repositórios e workflows rapidamente.
          </p>
        </div>
        <Link
          to="/projects/new"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
        >
          Novo projeto
        </Link>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Repositório</th>
              <th className="px-4 py-3 text-left font-semibold">Org</th>
              <th className="px-4 py-3 text-left font-semibold">Criado em</th>
              <th className="px-4 py-3 text-left font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {loading && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-center text-slate-500">
                  Carregando...
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-center text-red-500">
                  {error}
                </td>
              </tr>
            )}
            {data?.map((project) => {
              const [owner, repo] = project.repo.split('/');
              return (
                <tr key={project.id}>
                  <td className="px-4 py-3">
                    <a href={project.repoUrl} target="_blank" rel="noreferrer" className="font-medium text-emerald-600">
                      {project.repo}
                    </a>
                  </td>
                  <td className="px-4 py-3">{project.org}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(project.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/projects/${owner}/${repo}`} className="text-emerald-600">
                      Ver detalhes →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {data && data.length === 0 && !loading && !error && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-center text-slate-500">
                  Nenhum projeto cadastrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
