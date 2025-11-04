import { Routes, Route, Navigate } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import BlueprintsPage from './pages/BlueprintsPage';
import ProjectsPage from './pages/ProjectsPage';
import NewProjectWizard from './pages/NewProjectWizard';
import ProjectDetailPage from './pages/ProjectDetailPage';
import PromptsPage from './pages/PromptsPage';
import SummariesPage from './pages/SummariesPage';
import AuditLogPage from './pages/AuditLogPage';
import ShellLayout from './components/ShellLayout';
import CodexPage from './pages/CodexPage';
import EnvironmentsPage from './pages/EnvironmentsPage';

function App() {
  return (
    <ShellLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/blueprints" element={<BlueprintsPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/new" element={<NewProjectWizard />} />
        <Route path="/projects/:owner/:repo" element={<ProjectDetailPage />} />
        <Route path="/prompts" element={<PromptsPage />} />
        <Route path="/environments" element={<EnvironmentsPage />} />
        <Route path="/codex" element={<CodexPage />} />
        <Route path="/summaries" element={<SummariesPage />} />
        <Route path="/audit" element={<AuditLogPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ShellLayout>
  );
}

export default App;
