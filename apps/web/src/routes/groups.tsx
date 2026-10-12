import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderPage } from '../components/placeholder-page';

export const Route = createFileRoute('/groups')({
  component: () => <PlaceholderPage page="groups" />,
});
