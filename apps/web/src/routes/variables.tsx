import { createFileRoute } from '@tanstack/react-router';
import { VariablesPage } from '../features/variables/variables-page';
import { validateFocusSearch } from '../lib/focus-search';

export const Route = createFileRoute('/variables')({
  validateSearch: validateFocusSearch,
  component: Page,
});

function Page() {
  const { focus } = Route.useSearch();
  return <VariablesPage focus={focus} />;
}
