declare global {
  interface ImportMeta {
    env: {
      NODE_ENV: "production" | "development";
      PROD: boolean;
      DEV: boolean;
    };
  }
  // biome-ignore lint/style/noNamespace: TypeScript ambient ProcessEnv augmentation uses the NodeJS namespace.
  namespace NodeJS {
    interface ProcessEnv {
      DEV: boolean;
      NODE_ENV: "production" | "development";
      PROD: boolean;
    }
  }
}

export {};
