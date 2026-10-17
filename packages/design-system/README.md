# @configure-env/design-system

The design system for the configure-env web portal: theme CSS, tokens, class recipes, motion primitives and React 19 components for Tailwind CSS v4. It gives the portal the elvisgastelum.com look, so the two UIs match and components can move between the projects.

It is a source-only workspace package: there is no build, and the consuming app compiles it through Vite and `@tailwindcss/vite`.

## Source

Copied from `@portfolio/design-system` (`packages/design-system`) in [elvisgastelum.com](https://github.com/elvisgastelum/elvisgastelum.com) at commit `27b0e6abe0fd27c9f4bf8f946c99d0ffa9cc62ee` (`origin/dev`, which contains the design-system commits `59b7602`, `9518917` and `48106b6`).

Changes from upstream:

| Change | Why |
| --- | --- |
| Renamed to `@configure-env/design-system` | Workspace scope of this repo |
| Theme preference stored under `configure-env.theme` instead of `portfolio.theme` | Its own `localStorage` key |
| Dropped the molecules `Breadcrumbs`, `Faq`, `LandingSection`, `LanguageSwitcher`, `TechChips`, `ThemeToggle` | Portfolio sections and site chrome; the portal does not need them |
| Dropped the atoms `GitHubIcon`/`LinkedInIcon` (`brand-icons`) and `Wordmark` | Site branding |
| Dropped the `.faq-item` disclosure CSS, its motion token and its Motion docs demo | Only the `Faq` molecule used them |

> **Follow-up:** when this design system becomes a shared package (its own repository or npm package), replace this copy with that package. Import paths stay the same if it keeps the subpath exports below.

## Quick path

1. Add the dependency: `"@configure-env/design-system": "workspace:*"`.
2. Import the theme right after Tailwind in the app's stylesheet:

   ```css
   @import 'tailwindcss';
   @import '@configure-env/design-system/theme.css';
   ```

3. Import components by subpath:

   ```tsx
   import { Button } from '@configure-env/design-system/components/atoms/button';

   <Button>Apply</Button>;
   ```

## What is inside

| Area | Path in `src/` | What it holds |
| --- | --- | --- |
| Theme CSS | `theme.css` | Geist font, light/dark OKLCH colors (`@theme static` / `@theme inline`), radius, spacing, easing, keyframes, shadows, the `dark` variant, the base layer and view-transition CSS |
| Tokens | `tokens.ts` | Typed catalog of every token (colors, radius, spacing, shadows, type, motion) that the Foundations docs render |
| Recipes | `recipes.ts` | Shared class strings: `TYPE`, `CONTAINER`, `SECTION_RHYTHM`, `FOCUS_RING`, `ctaClassName()`, `INTERACTIVE_CARD`… |
| Motion | `motion/` | `SiteMotionConfig`, `Reveal`/`RevealGroup`/`RevealItem`, `SlideIn`, `MaskedWords`, `PageEntrance`, `ScrollProgress`, `ActiveIndicator`, `CardSpotlight`, `useScrolled`, motion tokens |
| Atoms | `components/atoms/` | `Button`, `Badge`, `Card`, `PageGlow` (from upstream) and the portal primitives below |
| Molecules | `components/molecules/` | Portal compositions built from the atoms (see below) |
| Theme preference | `theme/` | System/light/dark pick stored in `localStorage` (`configure-env.theme`), `applyThemePreference`, `useThemePreference` |
| Utilities | `lib/utils.ts` | `cn()` |

## Portal primitives

Added for the portal on top of the upstream copy. They come from the shadcn `base-nova` registry (built on `@base-ui/react`) and use the shared theme tokens, so they follow light and dark mode with the rest of the system. Each has stories, and the interactive ones have Vitest + Testing Library tests.

| Group | Subpath under `./components/atoms/` | Exports |
| --- | --- | --- |
| Form controls | `input`, `textarea`, `label`, `field`, `input-group`, `separator` | `Input`, `Textarea`, `Label`, `Field`/`FieldLabel`/`FieldDescription`/`FieldError`/`FieldSet`…, `InputGroup`/`InputGroupAddon`/`InputGroupInput`…, `Separator` |
| | `select`, `combobox` | `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`…, `Combobox`/`ComboboxInput`/`ComboboxContent`/`ComboboxList`/`ComboboxItem`… |
| | `switch`, `checkbox`, `number-input` | `Switch`, `Checkbox`, `NumberInput` (Base UI `NumberField`; the registry has no number input) |
| Overlays | `dialog`, `sheet`, `drawer` | `Dialog`/`DialogTrigger`/`DialogContent`/`DialogTitle`…, `Sheet`/`SheetContent` (`side`)…, `Drawer`/`DrawerContent`… (swipe to dismiss) |
| | `popover`, `tooltip`, `dropdown-menu` | `Popover`/`PopoverTrigger`/`PopoverContent`…, `Tooltip`/`TooltipProvider`/`TooltipTrigger`/`TooltipContent`, `DropdownMenu`/`DropdownMenuItem`/`DropdownMenuCheckboxItem`/`DropdownMenuSub`… |
| Navigation and data | `tabs`, `table`, `kbd` | `Tabs`/`TabsList` (`variant`)/`TabsTrigger`/`TabsContent`, `Table`/`TableHeader`/`TableRow`/`TableCell`…, `Kbd`/`KbdGroup` |
| | `empty`, `skeleton`, `spinner` | `Empty`/`EmptyHeader`/`EmptyMedia`/`EmptyTitle`/`EmptyDescription`/`EmptyContent` (the empty state), `Skeleton`, `Spinner` |
| | `../molecules/code-block` | `CodeBlock`: code with a copy button (`copyLabel`, `copiedLabel`, `onCopyError`) that announces the copy |
| Feedback | `sonner`, `command` | `Toaster` and `toast` (Sonner; follows the theme preference), `Command`/`CommandInput`/`CommandList`/`CommandGroup`/`CommandItem`/`CommandDialog`… (cmdk) |
| | `../molecules/command-palette` | `CommandPalette`: the `Command*` atoms in a dialog toggled with ⌘K / Ctrl+K (`shortcut`) |

Changes from the registry sources: imports are relative (`../../lib/utils`, `./button`), the registry's icon placeholders are `lucide-react` icons, `ComboboxInput` names its icon-only buttons (`triggerLabel`, `clearLabel`) so they pass axe, and the `Dialog` and `Sheet` close buttons take `closeLabel` instead of a hard-coded "Close". The toaster reads the theme from `useThemePreference` instead of `next-themes`, and gives toast descriptions the muted token so they keep 4.5:1. `CommandDialog` puts its hidden title inside the popup so the dialog is named, and `CommandSeparator` is `aria-hidden` (a listbox may not own a separator). Overlay stories include an `Open` story (hidden from the docs page) so the a11y checks cover the open popup, not just its trigger. Icon-only controls take their accessible names as props with English defaults; pass translated copy.

## Consume it in a Vite + Tailwind v4 app

- The app compiles the package: exports point at `.ts`/`.tsx`/`.css` sources, and Vite, Vitest and Storybook handle them through the pnpm symlink with no extra config. The app's tsconfig needs `"moduleResolution": "Bundler"` and `"jsx": "react-jsx"`.
- `theme.css` contains `@source './'`, so Tailwind scans the package's own class strings and generates their utilities in any app that imports the theme. The app does not need its own `@source` for the package.
- Use `@tailwindcss/vite` in the app's Vite config, as for any Tailwind v4 app.

### Exports

Every module has its own subpath (no barrel), so route chunks only pull in what they use.

| Subpath | Example |
| --- | --- |
| `./theme.css` | `@import '@configure-env/design-system/theme.css';` |
| `./tokens` | `import { COLOR_GROUPS } from '@configure-env/design-system/tokens';` |
| `./recipes` | `import { CONTAINER, ctaClassName } from '@configure-env/design-system/recipes';` |
| `./utils` | `import { cn } from '@configure-env/design-system/utils';` |
| `./theme` | `import { setThemePreference } from '@configure-env/design-system/theme';` |
| `./theme/use-theme-preference` | `import { useThemePreference } from '@configure-env/design-system/theme/use-theme-preference';` |
| `./motion/tokens` | `import { EASE_OUT } from '@configure-env/design-system/motion/tokens';` |
| `./motion/use-scrolled` | `import { useScrolled } from '@configure-env/design-system/motion/use-scrolled';` |
| `./motion/*` | `import { Reveal } from '@configure-env/design-system/motion/reveal';` |
| `./components/*` | `import { Badge } from '@configure-env/design-system/components/atoms/badge';` |
| `./storybook/docs.css` | Storybook docs chrome that follows the theme |

Wrap the app once in `SiteMotionConfig` (from `./motion/site-motion-config`) so every animation shares the easing and respects reduced motion.

### Dependencies

| Kind | Packages |
| --- | --- |
| Peer | `react` ^19.3, `react-dom` ^19.3, `tailwindcss` ^4.3 |
| Bundled | `motion`, `@base-ui/react`, `class-variance-authority`, `cn`, `lucide-react`, `sonner`, `cmdk`, `tw-animate-css`, `shadcn` (its Tailwind CSS), `@fontsource-variable/geist` |

Components render no copy of their own and import no router: the app passes text and links through props.

## Storybook

```sh
pnpm --filter @configure-env/design-system storybook        # http://localhost:6007
pnpm --filter @configure-env/design-system build-storybook  # static build to storybook-static/
```

It holds the Foundations docs (colors, typography, spacing, radius, borders, shadows, effects, motion), every component, a system/light/dark theme toolbar and the a11y panel. Its config lives in `.storybook/` (`preview.css` imports Tailwind, the theme and `docs.css`).

The root scripts `pnpm storybook`, `pnpm build-storybook` and `pnpm test:storybook` run the same commands from the repo root.

### Accessibility checks

`parameters.a11y.test` is `'error'`, so any axe violation fails a story's test. `pnpm test:storybook` runs every story through `@storybook/addon-vitest` in headless Chromium (Playwright) twice, as the `storybook-light` and `storybook-dark` Vitest projects, so each story is checked in both themes, color contrast included. CI builds Storybook and runs these checks in the `storybook` job. Install the browser once with `pnpm --filter @configure-env/design-system exec playwright install chromium`.

The only rule turned off is `color-contrast` on the `SlideIn: paired cards` motion demo, whose cards start faint by design until they scroll in. The light `--destructive` color is darker than upstream (`oklch(0.505 0.213 27.518)` instead of `oklch(0.577 0.245 27.325)`) so destructive text keeps 4.5:1 on its own tint.

## Tests

```sh
vp run @configure-env/design-system#test             # Vitest + Testing Library on jsdom, cached
pnpm --filter @configure-env/design-system test:storybook  # every story in Chromium, light and dark, with axe
pnpm --filter @configure-env/design-system typecheck
```

- `src/stories.test.tsx` renders every story with the real `.storybook/preview` annotations.
- `src/boundary.test.ts` enforces the boundary rules below.

## Boundary rules

- No imports from `apps/`, and no relative import that leaves the package.
- No `@/` alias: imports inside the package are relative.
- No `react-i18next`, `i18next` or `@tanstack/react-router`: copy, links and language changes are props.
