import path from 'node:path';

import macrosPlugin from 'vite-plugin-babel-macros';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Transform lingui macros (e.g. `msg`) used by the lib code under test.
  plugins: [macrosPlugin()],
  resolve: {
    alias: [
      // The agents transitively import the i18n loader, which eagerly loads
      // compiled translation catalogues. Stub it so the tests are hermetic.
      {
        find: /^(.*)\/client-only\/providers\/i18n-server$/,
        replacement: path.resolve(__dirname, 'test/i18n-server.stub.ts'),
      },
    ],
  },
  test: {
    include: ['**/*.test.ts'],
  },
});
