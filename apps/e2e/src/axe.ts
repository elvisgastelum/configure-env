// The axe scan the accessibility tests share: WCAG 2.x A and AA plus axe's
// best practices, reported as one readable line per violating node.

import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export const AXE_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
];

/** One line per violating node: rule id, target selector and message. */
export async function axeViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  return violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${violation.id} (${violation.impact ?? 'n/a'}) ${node.target.join(' ')}: ${node.failureSummary?.replace(/\s+/g, ' ') ?? violation.help}`,
    ),
  );
}
