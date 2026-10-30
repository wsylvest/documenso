import macrosPlugin from 'vite-plugin-babel-macros';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Transform lingui macros (e.g. `msg`) used by lib code imported by the server.
  plugins: [macrosPlugin()],
  test: {
    include: ['**/*.test.ts'],
  },
});
