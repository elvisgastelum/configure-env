import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderPage } from '../components/placeholder-page';
import { validateFocusSearch } from '../lib/focus-search';

export const Route = createFileRoute('/files')({
  validateSearch: validateFocusSearch,
  component: Page,
});

function Page() {
  const { focus } = Route.useSearch();
  return <PlaceholderPage page="files" focus={focus} />;
}
