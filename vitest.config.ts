import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Import the package from its sources, through its own name and exports.
  resolve: { conditions: ['@mawaqit/source'] },
  ssr: { resolve: { conditions: ['@mawaqit/source'] } },
  test: {
    unstubEnvs: true,
    unstubGlobals: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { 100: true },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/live.test.ts'],
          setupFiles: ['tests/setup.ts'],
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
            tsconfig: './tsconfig.json',
          },
        },
      },
      {
        extends: true,
        test: { name: 'live', include: ['tests/live.test.ts'], testTimeout: 30_000 },
      },
    ],
  },
});
