import React from 'react';
import { Composition } from 'remotion';
import { TOTAL_FRAMES } from './data';
import { FPS, H, W } from './theme';
import { Tutorial } from './Tutorial';

export const RemotionRoot: React.FC = () => (
  <Composition id="Tutorial" component={Tutorial} durationInFrames={TOTAL_FRAMES} fps={FPS} width={W} height={H} />
);
