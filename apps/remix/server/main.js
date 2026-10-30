/**
 * This is the main entry point for the server which will launch the RR7 application
 * and spin up auth, api, etc.
 *
 * Note:
 *  This file will be copied to the build folder during build time.
 *  Running this file will not work without a build.
 */
import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

import { createAdaptorServer, serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import handle from 'hono-react-router-adapter/node';

import { getLoadContext } from './hono/server/load-context.js';
import server from './hono/server/router.js';
import * as build from './index.js';

// Sub-path the app is served under (e.g. "/ESign"). Empty = root.
// Must match the basePath used by the Hono router and the Vite `base`/RR
// `basename` so that hashed asset URLs like `/ESign/assets/app-xxx.css`
// resolve to files on disk at `build/client/assets/app-xxx.css`.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');

server.use(
  serveStatic({
    root: 'build/client',
    rewriteRequestPath: (path) => {
      if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) {
        const stripped = path.slice(basePath.length);
        return stripped === '' ? '/' : stripped;
      }
      return path;
    },
    onFound: (path, c) => {
      if (path.startsWith('build/client/assets')) {
        // Hard cache assets with hashed file names.
        c.header('Cache-Control', 'public, immutable, max-age=31536000');
      } else {
        // Cache with revalidation for rest of static files.
        c.header('Cache-Control', 'public, max-age=0, stale-while-revalidate=86400');
      }
    },
  }),
);

const handler = handle(build, server, { getLoadContext });

// Listen on a Unix domain socket when NEXT_PRIVATE_LISTEN_SOCKET is set, so a
// reverse proxy on the same host (nginx `proxy_pass http://unix:/path:`) can
// reach the app without a TCP port. A loopback port is still opened when PORT
// is set explicitly, because the app calls itself over HTTP for background jobs
// and PDF rendering (NEXT_PRIVATE_INTERNAL_WEBAPP_URL) and `fetch` cannot
// target a socket path.
const socketPath = process.env.NEXT_PRIVATE_LISTEN_SOCKET?.trim();

if (socketPath) {
  const socketDir = dirname(socketPath);

  if (!existsSync(socketDir)) {
    mkdirSync(socketDir, { recursive: true, mode: 0o750 });
  }

  // A previous process that died without cleaning up leaves a stale socket
  // file; listening on it would fail with EADDRINUSE.
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  const socketServer = createAdaptorServer({ fetch: handler.fetch });

  socketServer.listen(socketPath, () => {
    // Owner and group (the proxy's user, via the directory's group) may connect.
    chmodSync(socketPath, 0o660);
    console.log(`Listening on unix socket ${socketPath}`);
  });

  const removeSocket = () => {
    try {
      unlinkSync(socketPath);
    } catch {
      // Already gone.
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      socketServer.close(() => {
        removeSocket();
        process.exit(0);
      });
    });
  }

  process.once('exit', removeSocket);

  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);

    serve({ fetch: handler.fetch, port, hostname: '127.0.0.1' }, () => {
      console.log(`Listening on 127.0.0.1:${port} for internal requests`);
    });
  }
} else {
  const port = parseInt(process.env.PORT || '3000', 10);

  serve({ fetch: handler.fetch, port });
}
