import { Toaster as Sonner, type ToasterProps } from 'sonner';

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';

import { useThemePreference } from '../../theme/use-theme-preference';

const Toaster = ({ ...props }: ToasterProps) => {
  // Follows the design system's theme preference (system, light or dark).
  const theme = useThemePreference();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
          // Sonner's own description gray misses 4.5:1 when its theme and
          // the page's differ; the muted token always meets it.
          description: 'text-muted-foreground!',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
export { toast } from 'sonner';
