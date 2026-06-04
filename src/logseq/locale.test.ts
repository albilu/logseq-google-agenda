import { afterEach, describe, expect, it } from 'vitest';

import { getLogseqLocale } from './locale';

const originalLogseqDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'logseq');
const originalNavigatorLanguageDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'language');

function restoreLogseqDescriptor() {
  if (originalLogseqDescriptor) {
    Object.defineProperty(globalThis, 'logseq', originalLogseqDescriptor);
    return;
  }

  delete (globalThis as { logseq?: unknown }).logseq;
}

function restoreNavigatorLanguageDescriptor() {
  if (originalNavigatorLanguageDescriptor) {
    Object.defineProperty(window.navigator, 'language', originalNavigatorLanguageDescriptor);
  }
}

afterEach(() => {
  restoreLogseqDescriptor();
  restoreNavigatorLanguageDescriptor();
});

describe('getLogseqLocale', () => {
  it('falls back to navigator.language when reading globalThis.logseq throws SecurityError', async () => {
    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      value: 'fr-FR',
    });

    Object.defineProperty(globalThis, 'logseq', {
      configurable: true,
      get() {
        throw new DOMException(
          "Failed to read a named property 'logseq' from 'Window': Blocked a frame with origin.",
          'SecurityError',
        );
      },
    });

    await expect(getLogseqLocale()).resolves.toBe('fr-FR');
  });
});
