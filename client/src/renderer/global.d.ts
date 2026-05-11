export {};

declare global {
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
    };
  }
}
