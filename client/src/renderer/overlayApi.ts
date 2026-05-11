type OverlayApi = Window['talkOverlay'];

const browserFallback: OverlayApi = {
  minimize: async () => undefined,
  close: async () => undefined,
  flashAttention: async () => false,
  setAlwaysOnTop: async (enabled: boolean) => enabled,
  onAlwaysOnTopChanged: () => () => undefined,
  captureScreenshot: async () => null,
  readyScreenshot: async () => false,
  showScreenshot: async () => false,
  completeScreenshot: async () => null,
  onScreenshotInit: () => () => undefined
};

export const overlayApi: OverlayApi = {
  ...browserFallback,
  ...(window.talkOverlay ?? {})
};
