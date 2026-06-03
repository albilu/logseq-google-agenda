import { describe, expect, it } from 'vitest';

import packageJson from '../package.json';
import viteConfig from '../vite.config';

describe('plugin packaging', () => {
  it('points Logseq at the HTML entry file', () => {
    expect(packageJson.main).toBe('dist/index.html');
  });

  it('uses relative asset paths for embedded builds', () => {
    expect(viteConfig).toMatchObject({
      base: './',
    });
  });
});
