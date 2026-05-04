import React from 'react';
import { Link } from 'react-router-dom';

/**
 * BIBI CARS logo — original brand PNG (integrated speed-streaks + "CARS" tag).
 * Uses image-rendering hints so browsers keep it crisp at common display sizes.
 */
export const BibiLogo = ({ height = 48, className = '', to = '/' }) => {
  const Wrapper = to ? Link : 'div';
  const props = to ? { to } : {};
  return (
    <Wrapper
      {...props}
      className={`inline-flex items-center ${className}`}
      data-testid="site-logo"
      aria-label="BIBI CARS"
    >
      <img
        src="/bibi-logo.png"
        alt="BIBI CARS"
        style={{
          height,
          width: 'auto',
          display: 'block',
          imageRendering: 'auto',
        }}
        draggable={false}
      />
    </Wrapper>
  );
};

export default BibiLogo;
