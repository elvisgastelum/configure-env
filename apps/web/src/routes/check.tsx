import { createFileRoute } from '@tanstack/react-router';
import { CheckPage } from '../features/check/check-page';

export const Route = createFileRoute('/check')({
  component: CheckPage,
});
