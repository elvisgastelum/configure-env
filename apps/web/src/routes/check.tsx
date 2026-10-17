import { createFileRoute } from '@tanstack/react-router';
import { CheckPage } from '../features/check/check-page';
import { validateCheckSearch } from '../features/check/problems';

export const Route = createFileRoute('/check')({
  validateSearch: validateCheckSearch,
  component: Page,
});

function Page() {
  const { severity } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CheckPage
      severity={severity}
      onSeverityChange={(next) =>
        void navigate({ search: next ? { severity: next } : {}, replace: true })
      }
    />
  );
}
