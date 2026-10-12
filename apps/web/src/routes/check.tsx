import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderPage } from '../components/placeholder-page';

export const Route = createFileRoute('/check')({
  component: () => <PlaceholderPage page="check" />,
});
