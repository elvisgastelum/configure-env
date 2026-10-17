import { createFileRoute } from '@tanstack/react-router';
import { VariablesPage } from '../features/variables/variables-page';
import { validateVariablesSearch } from '../lib/focus-search';

export const Route = createFileRoute('/variables')({
  validateSearch: validateVariablesSearch,
  component: Page,
});

function Page() {
  const { focus, group } = Route.useSearch();
  return <VariablesPage focus={focus} group={group} />;
}
