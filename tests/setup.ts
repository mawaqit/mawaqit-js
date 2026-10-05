import { beforeEach, vi } from 'vitest';

// The tests never read the environment of the developer.
beforeEach(() => {
  for (const name of ['MAWAQIT_TOKEN', 'MAWAQIT_BASE_URL', 'MAWAQIT_LOG']) {
    vi.stubEnv(name, undefined);
  }
});
