import { createFileRoute } from '@tanstack/react-router';
import { GroupsPage } from '../features/groups/groups-page';
import { validateFocusSearch } from '../lib/focus-search';

export const Route = createFileRoute('/groups')({
  validateSearch: validateFocusSearch,
  component: Page,
});

function Page() {
  const { focus } = Route.useSearch();
  return <GroupsPage focus={focus} />;
}
