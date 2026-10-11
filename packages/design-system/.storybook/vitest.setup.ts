import { MotionGlobalConfig } from 'motion/react';

// Motion's animations finish at once, so the a11y checks see every story in
// its final state, not mid-fade.
MotionGlobalConfig.skipAnimations = true;
