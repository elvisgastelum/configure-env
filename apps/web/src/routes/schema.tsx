import { createFileRoute } from '@tanstack/react-router';
import { SchemaPage } from '../features/schema/schema-page';

export const Route = createFileRoute('/schema')({
  component: SchemaPage,
});
