import {
  composeStories,
  type composeStory,
  setProjectAnnotations,
} from '@storybook/react-vite';
import { waitFor } from '@testing-library/react';
import { afterAll, describe, expect, it } from 'vitest';

import preview from '../.storybook/preview';

/*
 * Smoke test for Storybook: every story in every `*.stories.tsx` file is
 * composed with the package's Storybook preview (theme, motion defaults) through
 * Storybook's portable stories and rendered with `run()`, as Storybook
 * itself would, and must render something without throwing. It does not
 * check what a story shows; the components' own tests do that.
 */

setProjectAnnotations(preview);

type StoriesModule = Parameters<typeof composeStories>[0];
type ComposedStory = ReturnType<typeof composeStory>;

const modules = import.meta.glob<StoriesModule>('./**/*.stories.tsx', {
  eager: true,
});

const cases = Object.entries(modules).flatMap(([path, module]) =>
  Object.entries<ComposedStory>(composeStories(module)).map(
    ([name, story]) => [`${path} › ${name}`, story] as const,
  ),
);

// One canvas for the whole file: each `run()` unmounts the previous story
// before it renders the next one.
const canvasElement = document.createElement('div');

afterAll(() => {
  canvasElement.remove();
});

describe('stories', () => {
  it('finds the story files', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(1);
    expect(cases.length).toBeGreaterThan(1);
  });

  it.each(cases)('%s renders', async (_name, story) => {
    document.body.append(canvasElement);
    await story.run({ canvasElement });
    await waitFor(() => expect(canvasElement).not.toBeEmptyDOMElement());
    expect(
      canvasElement.textContent?.trim() || canvasElement.innerHTML,
    ).not.toBe('');
  });
});
