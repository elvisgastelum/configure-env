import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderPage } from '../components/placeholder-page';
import { validateFocusSearch } from '../lib/focus-search';

export const Route = createFileRoute('/variables')({
  validateSearch: validateFocusSearch,
  component: Page,
});

function Page() {
  const { focus } = Route.useSearch();
  return <PlaceholderPage page="variables" focus={focus} />;
}
