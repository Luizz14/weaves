import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import reactPlugin from "@vitejs/plugin-react";
import { config } from "dotenv";
import {
  defineConfig,
  type Plugin,
  type PluginOption,
  type UserConfig,
} from "vite";
import injectProcessEnvPlugin from "rollup-plugin-inject-process-env";
import tsconfigPathsPlugin from "vite-tsconfig-paths";
import { dependencies, resources, version } from "./package.json";
import { mainExternalizedDependencies } from "./runtime-dependencies";
import {
  copyResourcesPlugin,
  defineEnv,
  devPath,
  htmlEnvTransformPlugin,
  linguiMacroPlugin,
} from "./vite/helpers";

// Explicit build inputs take precedence over the workspace defaults.
config({
  path: resolve(__dirname, "../../.env"),
  override: false,
  quiet: true,
});

const PERSONAL_INSTALL_BUILD = process.env.TAURI_PERSONAL_INSTALL === "1";
if (PERSONAL_INSTALL_BUILD) {
  Object.assign(process.env, {
    NEXT_PUBLIC_API_URL: "https://api.superset.sh",
    NEXT_PUBLIC_STREAMS_URL: "https://streams.superset.sh",
    NEXT_PUBLIC_WEB_URL: "https://app.superset.sh",
    NEXT_PUBLIC_MARKETING_URL: "https://superset.sh",
    NEXT_PUBLIC_DOCS_URL: "https://docs.superset.sh",
    NEXT_PUBLIC_ROOT_DOMAIN: "superset.sh",
    RELAY_URL: "https://relay.superset.sh",
    REALTIME_URL: "https://realtime.superset.sh",
    SANDBOX_GATE_ORIGIN: "https://*.sandbox.supersetusercontent.com",
    STREAMS_URL: "https://superset-stream.fly.dev",
  });
}
const DEV_SERVER_PORT = Number(
  PERSONAL_INSTALL_BUILD ? undefined : process.env.DESKTOP_VITE_PORT,
);
const workspaceDependencies = Object.keys(dependencies).filter((dependency) =>
  dependency.startsWith("@superset/"),
);
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules
    .filter((specifier) => !specifier.startsWith("node:"))
    .map((specifier) => `node:${specifier}`),
];

function tsconfigPaths(): Plugin {
  return tsconfigPathsPlugin({
    projects: [resolve("tsconfig.json")],
  });
}

function sentryPlugin(project: string, assets?: string[]): PluginOption | null {
  if (PERSONAL_INSTALL_BUILD || !process.env.SENTRY_AUTH_TOKEN) return null;
  return sentryVitePlugin({
    org: "superset-sh",
    project,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    release: { name: version },
    ...(assets ? { sourcemaps: { assets } } : {}),
  });
}

const mainSentryPlugin = sentryPlugin("desktop");
const hostServiceSentryPlugin = sentryPlugin("host-service", [
	"**/host-service.cjs*",
	"**/host-worker.cjs*",
]);

const mainConfig: UserConfig = {
  plugins: [tsconfigPaths(), linguiMacroPlugin(), copyResourcesPlugin()].filter(
    Boolean,
  ),

  define: {
    "process.env.NODE_ENV": defineEnv(process.env.NODE_ENV, "production"),
    "process.env.TAURI_PERSONAL_INSTALL": defineEnv(
      process.env.TAURI_PERSONAL_INSTALL === "1" ? "1" : undefined,
      "0",
    ),
    "process.env.SKIP_ENV_VALIDATION": defineEnv(
      process.env.SKIP_ENV_VALIDATION,
      "",
    ),
    "process.env.NEXT_PUBLIC_API_URL": defineEnv(
      process.env.NEXT_PUBLIC_API_URL,
      "https://api.superset.sh",
    ),
    "process.env.NEXT_PUBLIC_STREAMS_URL": defineEnv(
      process.env.NEXT_PUBLIC_STREAMS_URL,
      "https://streams.superset.sh",
    ),
    "process.env.NEXT_PUBLIC_WEB_URL": defineEnv(
      process.env.NEXT_PUBLIC_WEB_URL,
      "https://app.superset.sh",
    ),
    "process.env.NEXT_PUBLIC_MARKETING_URL": defineEnv(
      process.env.NEXT_PUBLIC_MARKETING_URL,
      "https://superset.sh",
    ),
    "process.env.NEXT_PUBLIC_DOCS_URL": defineEnv(
      process.env.NEXT_PUBLIC_DOCS_URL,
      "https://docs.superset.sh",
    ),
    "process.env.NEXT_PUBLIC_ROOT_DOMAIN": defineEnv(
      process.env.NEXT_PUBLIC_ROOT_DOMAIN,
      "superset.sh",
    ),
    "process.env.SENTRY_DSN_DESKTOP": defineEnv(process.env.SENTRY_DSN_DESKTOP),
    "process.env.SENTRY_DSN_HOST_SERVICE": defineEnv(
      process.env.SENTRY_DSN_HOST_SERVICE,
    ),
    "process.env.RELAY_URL": defineEnv(process.env.RELAY_URL),
    "process.env.REALTIME_URL": defineEnv(process.env.REALTIME_URL),
    "process.env.NEXT_PUBLIC_POSTHOG_KEY": defineEnv(
      process.env.NEXT_PUBLIC_POSTHOG_KEY,
    ),
    "process.env.NEXT_PUBLIC_POSTHOG_HOST": defineEnv(
      process.env.NEXT_PUBLIC_POSTHOG_HOST,
    ),
    "process.env.STREAMS_URL": defineEnv(
      process.env.STREAMS_URL,
      "https://superset-stream.fly.dev",
    ),
    "process.env.DESKTOP_VITE_PORT": defineEnv(
      PERSONAL_INSTALL_BUILD ? undefined : process.env.DESKTOP_VITE_PORT,
    ),
    "process.env.DESKTOP_NOTIFICATIONS_PORT": defineEnv(
      process.env.DESKTOP_NOTIFICATIONS_PORT,
    ),
    "process.env.SUPERSET_WORKSPACE_NAME": defineEnv(
      PERSONAL_INSTALL_BUILD ? undefined : process.env.SUPERSET_WORKSPACE_NAME,
    ),
  },

  build: {
    // The host service is a Node sidecar. Using Vite's SSR build environment
    // selects Node package conditions and keeps process.env dynamic at runtime.
    ssr: true,
    sourcemap: true,
    outDir: resolve(devPath, "main"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Native Tauri owns the window lifecycle. The Node service is the
        // only application entry and communicates over the stdio sidecar.
        "desktop-service": resolve("src/main/desktop-service.ts"),
        // Retain every long-lived child/worker entry used by the host and PTY
        // services. They are launched by the Node host, never by Electron.
        "terminal-host": resolve("src/main/terminal-host/index.ts"),
        "pty-subprocess": resolve("src/main/terminal-host/pty-subprocess.ts"),
        "git-task-worker": resolve("src/main/git-task-worker.ts"),
        "host-service": resolve("src/main/host-service/index.ts"),
        "pty-daemon": resolve("src/main/pty-daemon/index.ts"),
        "host-worker": resolve("src/main/host-worker/index.ts"),
      },
      output: {
        format: "cjs",
        entryFileNames: "[name].cjs",
        chunkFileNames: "chunks/[name]-[hash].cjs",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
      external: [...nodeBuiltins, ...mainExternalizedDependencies],
      plugins: [mainSentryPlugin, hostServiceSentryPlugin].filter(Boolean),
    },
  },
  resolve: {
    alias: {
      // @xterm/headless 6.0.0 has a packaging bug: `module` points to a
      // missing `lib/xterm.mjs`; use its CJS entry instead.
      "@xterm/headless": "@xterm/headless/lib-headless/xterm-headless.js",
    },
  },
  ssr: {
    target: "node",
    // Preserve the existing explicit external boundary below; all other
    // dependencies stay bundled into the sidecar.
    noExternal: true,
  },
};

const rendererConfig: UserConfig = {
  root: resolve("src/renderer"),
  define: {
    "process.env.NODE_ENV": defineEnv(process.env.NODE_ENV),
    "process.env.TAURI_PERSONAL_INSTALL": defineEnv(
      PERSONAL_INSTALL_BUILD ? "1" : undefined,
      "0",
    ),
    "process.env.SKIP_ENV_VALIDATION": defineEnv(
      process.env.SKIP_ENV_VALIDATION,
      "",
    ),
    "process.platform": defineEnv(process.platform),
    "process.env.NEXT_PUBLIC_API_URL": defineEnv(
      process.env.NEXT_PUBLIC_API_URL,
      "https://api.superset.sh",
    ),
    "process.env.NEXT_PUBLIC_WEB_URL": defineEnv(
      process.env.NEXT_PUBLIC_WEB_URL,
      "https://app.superset.sh",
    ),
    "process.env.NEXT_PUBLIC_MARKETING_URL": defineEnv(
      process.env.NEXT_PUBLIC_MARKETING_URL,
      "https://superset.sh",
    ),
    "process.env.NEXT_PUBLIC_DOCS_URL": defineEnv(
      process.env.NEXT_PUBLIC_DOCS_URL,
      "https://docs.superset.sh",
    ),
    "process.env.NEXT_PUBLIC_ROOT_DOMAIN": defineEnv(
      process.env.NEXT_PUBLIC_ROOT_DOMAIN,
      "superset.sh",
    ),
    "import.meta.env.DEV_SERVER_PORT": defineEnv(String(DEV_SERVER_PORT)),
    "import.meta.env.NEXT_PUBLIC_POSTHOG_KEY": defineEnv(
      process.env.NEXT_PUBLIC_POSTHOG_KEY,
    ),
    "import.meta.env.NEXT_PUBLIC_POSTHOG_HOST": defineEnv(
      process.env.NEXT_PUBLIC_POSTHOG_HOST,
    ),
    "import.meta.env.SENTRY_DSN_DESKTOP": defineEnv(
      process.env.SENTRY_DSN_DESKTOP,
    ),
    "process.env.RELAY_URL": defineEnv(process.env.RELAY_URL),
    "process.env.REALTIME_URL": defineEnv(process.env.REALTIME_URL),
    "process.env.STREAMS_URL": defineEnv(
      process.env.STREAMS_URL,
      "https://superset-stream.fly.dev",
    ),
    "process.env.DESKTOP_VITE_PORT": defineEnv(
      PERSONAL_INSTALL_BUILD ? undefined : process.env.DESKTOP_VITE_PORT,
    ),
    "process.env.DESKTOP_NOTIFICATIONS_PORT": defineEnv(
      process.env.DESKTOP_NOTIFICATIONS_PORT,
    ),
    "process.env.SUPERSET_WORKSPACE_NAME": defineEnv(
      PERSONAL_INSTALL_BUILD ? undefined : process.env.SUPERSET_WORKSPACE_NAME,
    ),
  },
  server: {
    port: DEV_SERVER_PORT,
    strictPort: false,
  },
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: resolve("src/renderer/routes"),
      generatedRouteTree: resolve("src/renderer/routeTree.gen.ts"),
      indexToken: "page",
      routeToken: "layout",
      autoCodeSplitting: true,
      routeFileIgnorePattern:
        "^(?!(__root|page|layout)\\.tsx$).*\\.(tsx?|jsx?)$",
    }),
    tsconfigPaths(),
    tailwindcss(),
    reactPlugin({
      // Compiles @lingui/react/macro (Trans, useLingui) at build time.
      babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] },
    }),
    htmlEnvTransformPlugin(),
  ],
  worker: {
    format: "es",
  },
  publicDir: resolve(resources, "public"),
  build: {
    sourcemap: Boolean(process.env.SENTRY_AUTH_TOKEN),
    outDir: resolve(devPath, "renderer"),
    emptyOutDir: true,
    rollupOptions: {
      plugins: [
        injectProcessEnvPlugin({
          NODE_ENV: "production",
          platform: process.platform,
        }),
        mainSentryPlugin,
      ].filter(Boolean),
      input: {
        index: resolve("src/renderer/index.html"),
      },
    },
  },
};

export { mainConfig, rendererConfig };
export default defineConfig(async () => {
  await import("./src/main/env.main");
  return mainConfig;
});
