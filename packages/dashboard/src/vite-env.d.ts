/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute API base URL. Defaults to same-origin `/api`. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
