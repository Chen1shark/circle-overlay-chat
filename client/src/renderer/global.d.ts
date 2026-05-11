export {};

declare global {
  type ScreenshotStartOptions = {
    hideWindow: boolean;
  };

  type ScreenshotInitPayload = {
    dataUrl: string;
    viewportWidth: number;
    viewportHeight: number;
  };

  type ScreenshotSelection = {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  type ScreenshotResult = {
    dataUrl: string;
    width: number;
    height: number;
  };

  interface ImportMetaEnv {
    readonly VITE_CIRCLE_SERVER_WS_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    talkOverlay: {
      minimize: () => Promise<void>;
      close: () => Promise<void>;
      flashAttention: () => Promise<boolean>;
      setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
      onAlwaysOnTopChanged: (callback: (enabled: boolean) => void) => () => void;
      captureScreenshot: (options: ScreenshotStartOptions) => Promise<ScreenshotResult | null>;
      readyScreenshot: () => Promise<boolean>;
      showScreenshot: () => Promise<boolean>;
      completeScreenshot: (selection: ScreenshotSelection | null) => Promise<ScreenshotResult | null>;
      onScreenshotInit: (callback: (payload: ScreenshotInitPayload) => void) => () => void;
    };
  }
}
