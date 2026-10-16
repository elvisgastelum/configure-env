import { createFileRoute } from '@tanstack/react-router';
import { ValidatePage } from '../features/validate/validate-page';

export const Route = createFileRoute('/validate')({
  component: ValidatePage,
});
