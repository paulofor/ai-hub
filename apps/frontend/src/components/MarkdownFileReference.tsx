const extensionFromPath = (path: string) => {
  const fileName = path.split('/').pop() ?? path;
  const extension = fileName.includes('.') ? fileName.split('.').pop() : '';
  return extension ? extension.slice(0, 6).toUpperCase() : 'FILE';
};

const stripLineNumber = (path: string) => {
  const match = path.match(/^(.*?)(?::(\d+))?$/);
  return {
    pathOnly: match?.[1] ?? path,
    lineNumber: match?.[2]
  };
};

const compactPathForDisplay = (path: string) => {
  const withoutWrapper = path.replace(/^<|>$/g, '');
  const repoMarkerIndex = withoutWrapper.lastIndexOf('/repo/');
  if (repoMarkerIndex >= 0) {
    return withoutWrapper.slice(repoMarkerIndex + '/repo/'.length);
  }
  return withoutWrapper.replace(/^\/root\/ai-hub\/src\/[^/]+\//, '');
};

const splitFilePath = (path: string, label: string) => {
  const { pathOnly, lineNumber } = stripLineNumber(compactPathForDisplay(path));
  const labelPath = label.trim();
  const fileName = (labelPath.includes('/') ? labelPath.split('/').pop() : labelPath) || pathOnly.split('/').pop() || pathOnly;
  const directory = pathOnly.includes('/') ? pathOnly.split('/').slice(0, -1).join('/') : '';

  return { directory, fileName, lineNumber };
};

export const isFileReferenceHref = (href: string) => {
  const normalized = href.replace(/^<|>$/g, '');
  return /^(?:\.{1,2}\/|\/|[A-Za-z0-9_.@+-]+\/).+\.[A-Za-z0-9]+(?::\d+)?$/.test(normalized);
};

interface MarkdownFileReferenceProps {
  href: string;
  label: string;
}

export default function MarkdownFileReference({ href, label }: MarkdownFileReferenceProps) {
  const normalizedHref = href.replace(/^<|>$/g, '');
  const { directory, fileName, lineNumber } = splitFilePath(normalizedHref, label);

  return (
    <span
      className="mx-0.5 inline-grid max-w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 rounded-md border border-slate-200 bg-white px-2 py-1 align-middle text-left shadow-sm ring-1 ring-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:ring-slate-800"
      title={normalizedHref}
    >
      <span className="row-span-2 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold leading-none text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        {extensionFromPath(fileName)}
      </span>
      <span className="min-w-0 truncate font-mono text-[0.95em] font-semibold leading-tight text-slate-950 dark:text-slate-50">
        {fileName}
        {lineNumber ? <span className="ml-1 font-normal text-slate-500 dark:text-slate-400">:{lineNumber}</span> : null}
      </span>
      {directory ? (
        <span className="min-w-0 truncate font-mono text-[0.72em] leading-tight text-slate-500 dark:text-slate-400">
          {directory}
        </span>
      ) : null}
    </span>
  );
}
