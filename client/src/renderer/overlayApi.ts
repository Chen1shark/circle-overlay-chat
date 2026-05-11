type OverlayApi = Window['talkOverlay'];

const browserFallback: OverlayApi = {
  minimize: async () => undefined,
  close: async () => undefined,
  flashAttention: async () => false,
  setAlwaysOnTop: async (enabled: boolean) => enabled,
  onAlwaysOnTopChanged: () => () => undefined
};

export const overlayApi: OverlayApi = {
  ...browserFallback,
  ...(window.talkOverlay ?? {})
};
