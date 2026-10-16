import { createFileRoute } from '@tanstack/react-router';
import { FilesPage } from '../features/files/files-page';
import { validateFocusSearch } from '../lib/focus-search';

export const Route = createFileRoute('/files')({
  validateSearch: validateFocusSearch,
  component: Page,
});

function Page() {
  const { focus } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <FilesPage
      focus={focus}
      onFocusChange={(path) =>
        void navigate({ search: path ? { focus: path } : {} })
      }
    />
  );
}
