// test-setup.ts -- Global setup that runs before every test file
// ==============================================================
// Listed in vite.config.ts > test.setupFiles, so vitest loads it
// automatically before any test suite.
//
// @testing-library/react cleans up the DOM between tests automatically
// (via its own afterEach). No extra teardown needed here for most cases.

import "@testing-library/react";
