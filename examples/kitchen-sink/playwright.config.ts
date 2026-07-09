import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3210);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // Playwright defaults local `workers` to the machine's CPU count, sending
    // that many concurrent browser sessions at the single-threaded `webServer`
    // instance below. On a high-core-count machine (e.g. 32 cores) that's
    // dozens of simultaneous requests against one Node process, which starves
    // the event loop and produces spurious timeouts on server-action/form
    // tests unrelated to any actual bug (verified: identical suite is 100%
    // stable at `--workers=1`, matching CI). Cap it instead of leaving it
    // unbounded, while still running faster than fully serial locally.
    workers: process.env.CI ? 1 : 4,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    // The production server must be built first (see the `pretest:e2e` script,
    // which builds the framework and the app). This just starts it.
    webServer: {
        command: 'node .output/server/index.mjs',
        env: {
            PORT: String(PORT),
            SOLIDSTEP_REVALIDATE_TOKEN: 'e2e-test-revalidate-token',
            SOLIDSTEP_PREVIEW_SECRET: 'e2e-test-preview-secret',
        },
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
    },
});
