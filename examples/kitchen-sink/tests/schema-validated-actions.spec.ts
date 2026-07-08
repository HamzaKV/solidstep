import { test, expect } from '@playwright/test';

test.describe('schema-validated actions (parseActionInput)', () => {
    test('valid input reaches the handler', async ({ page }) => {
        await page.goto('/signup');
        await page.getByTestId('signup-name').fill('Ada');
        await page.getByTestId('signup-email').fill('ada@example.com');
        await page.getByTestId('signup-submit').click();

        await expect(page.getByTestId('signup-success')).toHaveText(
            'Welcome, Ada!',
        );
    });

    test('invalid input surfaces ValidationError issues, not the handler result', async ({
        page,
    }) => {
        await page.goto('/signup');
        await page.getByTestId('signup-name').fill('');
        await page.getByTestId('signup-email').fill('not-an-email');
        await page.getByTestId('signup-submit').click();

        const errors = page.getByTestId('signup-errors');
        await expect(errors).toBeVisible();
        await expect(errors).toContainText('Name is required');
        await expect(errors).toContainText('Enter a valid email');
        await expect(page.getByTestId('signup-success')).toHaveCount(0);
    });

    test('a raw /_server replay with invalid data is rejected, proving validation is not client-only', async ({
        page,
        request,
    }) => {
        await page.goto('/signup');
        await page.getByTestId('signup-name').fill('Ada');
        await page.getByTestId('signup-email').fill('ada@example.com');
        const [serverReq] = await Promise.all([
            page.waitForRequest((req) => req.url().includes('/_server')),
            page.getByTestId('signup-submit').click(),
        ]);
        await expect(page.getByTestId('signup-success')).toBeVisible();

        // Replay the exact same endpoint (same functionId) with an invalid
        // payload, as an attacker hitting /_server directly would -- no
        // browser, no client JS, no form. parseActionInput runs inside the
        // action itself, so this must still fail.
        const original = serverReq.headers();
        const invalidFormData = new URLSearchParams({
            name: '',
            email: 'not-an-email',
        }).toString();
        const res = await request.post(serverReq.url(), {
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-server-id': original['x-server-id'],
                'x-server-instance': original['x-server-instance'],
            },
            data: invalidFormData,
        });
        expect(res.status()).toBe(500);
        expect(res.headers()['x-error']).toBeTruthy();
    });
});
