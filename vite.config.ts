import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function serveMockHealthJson(): Plugin {
  return {
    name: "serve-mock-health-json",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestPath = req.url?.split("?", 1)[0];

        if (requestPath !== "/health.json") {
          next();
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(readFileSync(new URL("./public/health.json", import.meta.url), "utf8"));
      });
    }
  };
}

/**
 * EO-452: strip per-locale modulepreloads from the HTML entry.
 * Vite/Rolldown may still emit a preload for the first dynamic locale (e.g. am);
 * only English (static) and shared localization infrastructure may stay on the critical path.
 */
function stripLazyLocaleModulePreloads(): Plugin {
  const keepLocaleChunks = new Set(["en", "translations", "locales", "localizationservice"]);

  return {
    name: "strip-lazy-locale-modulepreloads",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html.replace(
          /<link rel="modulepreload"[^>]*href="(\/assets\/localization-[^"]+\.js)"[^>]*>\s*/g,
          (full, href: string) => {
            const match = href.match(/\/assets\/localization-([a-z0-9-]+)-[^/]+\.js$/i);
            if (!match) {
              return full;
            }

            const chunk = match[1].toLowerCase();
            return keepLocaleChunks.has(chunk) ? full : "";
          }
        );
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), serveMockHealthJson(), stripLazyLocaleModulePreloads()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");

          if (normalizedId.includes("/src/localization/")) {
            const localeMatch = normalizedId.match(/\/src\/localization\/([^/]+)\.ts$/);
            if (localeMatch) {
              return `localization-${localeMatch[1]}`;
            }

            return "localization";
          }

          if (normalizedId.includes("/src/data/")) {
            return "data";
          }

          if (normalizedId.includes("node_modules")) {
            if (normalizedId.includes("@fluentui")) {
              return "fluentui";
            }

            if (normalizedId.includes("@microsoft/teams-js")) {
              return "teams";
            }

            // Keep react, react-dom, scheduler and the rest of node_modules in one
            // "vendor" chunk. Splitting "react" alone created a circular chunk graph
            // (vendor → react → vendor) because scheduler lives outside react/*.
            return "vendor";
          }
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 4321,
    // Dev-only: same-origin proxy to the local RPP Web API (dotnet run, port 5004)
    // so browser tests need no CORS and work with apiBaseUrl http://127.0.0.1:4321.
    proxy: {
      "/api": { target: "http://localhost:5004", changeOrigin: true },
      "/health": { target: "http://localhost:5004", changeOrigin: true }
    }
  }
});
