import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3210);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
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
        },
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
    },
});
