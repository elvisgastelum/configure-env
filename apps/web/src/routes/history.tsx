import { createFileRoute } from '@tanstack/react-router';
import { HistoryPage } from '../features/history/history-page';
import { validateHistorySearch } from '../features/history/history-search';

export const Route = createFileRoute('/history')({
  validateSearch: validateHistorySearch,
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <HistoryPage
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
