function getNavigatorLocale() {
  return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
}

export async function getLogseqLocale() {
  const app = (globalThis as {
    logseq?: {
      App?: {
        getUserConfigs?: () => Promise<{ preferredLanguage?: string | null }>;
      };
    };
  }).logseq?.App;

  if (!app || typeof app.getUserConfigs !== 'function') {
    return getNavigatorLocale();
  }

  try {
    const userConfigs = await app.getUserConfigs();
    const preferredLanguage = userConfigs?.preferredLanguage?.trim();

    return preferredLanguage || getNavigatorLocale();
  } catch {
    return getNavigatorLocale();
  }
}
