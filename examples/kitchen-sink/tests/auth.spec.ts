import { test, expect } from '@playwright/test';

test.describe('auth via a server action', () => {
    test('login page is server-rendered', async ({ request }) => {
        const res = await request.get('/login');
        expect(res.status()).toBe(200);
        const html = await res.text();
        expect(html).toContain('Login');
    });

    test('valid credentials run the action and set a session cookie', async ({
        page,
    }) => {
        await page.goto('/login');

        await page.getByTestId('username').fill('demo');
        await page.getByTestId('password').fill('demo');
        await page.getByTestId('submit').click();

        // The server action completed without the serverFunctionMeta crash.
        await expect(page.getByTestId('status')).toHaveText('Signed in');
        await expect(page.getByTestId('error')).toHaveCount(0);

        const cookies = await page.context().cookies();
        const session = cookies.find((c) => c.name === 'session');
        expect(session?.value).toBe('session-for-demo');
    });

    test('invalid credentials surface an error and set no cookie', async ({
        page,
    }) => {
        await page.goto('/login');

        await page.getByTestId('username').fill('demo');
        await page.getByTestId('password').fill('wrong');
        await page.getByTestId('submit').click();

        await expect(page.getByTestId('error')).toHaveText('Invalid credentials');
        await expect(page.getByTestId('status')).toHaveCount(0);

        const cookies = await page.context().cookies();
        expect(cookies.find((c) => c.name === 'session')).toBeUndefined();
    });
});
