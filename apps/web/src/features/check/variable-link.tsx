import { Link } from '@tanstack/react-router';

/** A variable's name, linking to it on the variables page. */
export function VariableLink({ name }: { name: string }) {
  return (
    <Link
      to="/variables"
      search={{ focus: name }}
      className="font-mono text-xs font-medium underline-offset-4 hover:underline"
    >
      {name}
    </Link>
  );
}
