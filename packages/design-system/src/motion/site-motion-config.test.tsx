import { render, screen } from '@testing-library/react';
import { MotionConfigContext } from 'motion/react';
import { useContext } from 'react';
import { describe, expect, it } from 'vite-plus/test';

import { SiteMotionConfig } from './site-motion-config';

function ReducedMotionSetting() {
  const { reducedMotion } = useContext(MotionConfigContext);
  return <p>{reducedMotion}</p>;
}

describe('SiteMotionConfig', () => {
  it("follows the visitor's reduced-motion preference", () => {
    render(
      <SiteMotionConfig>
        <ReducedMotionSetting />
      </SiteMotionConfig>,
    );

    expect(screen.getByText('user')).toBeInTheDocument();
  });
});
