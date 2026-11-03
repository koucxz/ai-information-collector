/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API 根地址，留空表示同源（走 Vercel rewrites 反代）。 */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
