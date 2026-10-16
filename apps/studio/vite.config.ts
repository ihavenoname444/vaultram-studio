import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { existsSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
const uiRoot = fileURLToPath(new URL(".", import.meta.url));
const allowedFiles = [".", "../../packages/core", "../../node_modules"].map(
  (p) => realpathSync(fileURLToPath(new URL(p, import.meta.url))),
);
export default defineConfig({
  root: uiRoot,
  plugins: [
    react(),
    {
      name: "private-file-boundary",
      configureServer(server) {
        // Vite's static/public serving can follow symlinks. Check canonical paths
        // before those handlers, including public files that bypass fs.deny.
        server.middlewares.use((req, res, next) => {
          try {
            const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
            const candidates = path.startsWith("/@fs/")
              ? [path.slice(5)]
              : [
                  resolve(uiRoot, "." + path),
                  resolve(uiRoot, "public", "." + path),
                ];
            for (const candidate of candidates) {
              if (!existsSync(candidate)) continue;
              const actual = realpathSync(candidate);
              if (
                !allowedFiles.some(
                  (root) =>
                    actual === root ||
                    actual.startsWith(root.replace(/\/$/, "") + sep),
                ) ||
                /(?:^|\/)(?:\.data|\.git|\.env(?:\.[^/]*)?|\.npmrc|\.yarnrc\.yml)(?:\/|$)/.test(
                  actual,
                ) ||
                /\.(?:key|pem|p12|pfx|sqlite(?:-wal|-shm)?)$/i.test(actual)
              )
                throw Error("Private path");
            }
            next();
          } catch {
            res.statusCode = 403;
            res.end("File access denied");
          }
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.VAULTRAM_UI_PORT ?? 5173),
    strictPort: true,
    cors: false,
    headers: {
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
    fs: {
      strict: true,
      allow: allowedFiles,
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key,p12,pfx,cer,der}",
        ".npmrc",
        ".yarnrc.yml",
        "**/.git/**",
        "**/.data/**",
        "**/*.sqlite*",
      ],
    },
    proxy: { "/api": `http://127.0.0.1:${process.env.VAULTRAM_PORT ?? 8787}` },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
