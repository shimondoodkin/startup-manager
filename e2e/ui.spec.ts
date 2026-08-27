/**
 * End-to-end UI test against a running startup-manager (default http://localhost:3000).
 *
 *   npx playwright test            # headless
 *   npx playwright test --headed   # watch it
 *
 * Env: SM_URL, ADMIN_USERNAME, ADMIN_PASSWORD (defaults: localhost:3000, demo/demo)
 * Screenshots land in e2e/screenshots/.
 */
import { test, expect, Page } from '@playwright/test';

const URL = process.env.SM_URL || 'http://localhost:3000';
const USER = process.env.ADMIN_USERNAME || 'demo';
const PASS = process.env.ADMIN_PASSWORD || 'demo';
const NAME = 'e2e-ping';
const SHOT = (n: string) => ({ path: `e2e/screenshots/${n}.png`, fullPage: true });

async function login(page: Page) {
  await page.goto(URL);
  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password').fill(PASS);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Add Program' })).toBeVisible({ timeout: 10000 });
}

function row(page: Page) {
  return page.locator('table tbody tr', { hasText: NAME });
}

/** Open the row's "..." menu (desktop table variant). */
async function openRowMenu(page: Page) {
  await row(page).locator('[id^="dropdown-anchor-"]').click();
}

/** Row menu -> Edit -> Delete -> confirm Delete */
async function deleteProgram(page: Page) {
  await openRowMenu(page);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await page.getByText('Are you sure you want to delete').waitFor();
  await page.getByRole('button', { name: 'Delete' }).last().click();
  await expect(row(page)).toHaveCount(0);
}

test.describe.serial('startup-manager UI', () => {
  test.beforeAll(() => {
    // Remove any leftover program from a previous run via the CLI (same RPC as the UI)
    const { spawnSync } = require('child_process');
    for (const cmd of ['kill', 'rm']) {
      spawnSync('npx', ['ts-node', '--project', 'tsconfig.server.json', 'scripts/smctl.ts', cmd, NAME], { shell: true, stdio: 'ignore' });
    }
  });

  test('login shows program list', async ({ page }) => {
    await login(page);
    await page.screenshot(SHOT('01-programs'));
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.waitForTimeout(1500);
    expect(errors, 'console errors after login').toEqual([]);
  });

  test('add a program', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Add Program' }).click();
    await page.getByPlaceholder('Program name').fill(NAME);
    await page.getByPlaceholder('Command and arguments to run').fill('ping -t 127.0.0.1');
    await page.getByPlaceholder('Screen session name').fill(NAME);
    await page.getByLabel('Stop Method').selectOption('CTRL_C');
    await page.screenshot(SHOT('02-add-form'));
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(row(page)).toBeVisible();
    await expect(row(page)).toContainText('stopped');
  });

  test('start -> running, terminal shows output', async ({ page }) => {
    await login(page);
    await row(page).getByRole('button', { name: 'Start' }).click();
    await expect(row(page)).toContainText('running', { timeout: 15000 });
    await page.screenshot(SHOT('03-running'));

    await row(page).getByRole('button', { name: 'Terminal' }).click();
    // xterm renders rows into the DOM; wait for ping output to appear
    await expect(page.locator('.xterm-rows')).toContainText('Reply from 127.0.0.1', { timeout: 15000 });
    await page.screenshot(SHOT('04-terminal'));

    // Closing the tab only detaches the viewer; the program keeps running
    await page.getByRole('button', { name: '×' }).click();
    await expect(page.locator('.xterm-rows')).toHaveCount(0);
    await expect(row(page)).toContainText('running');
  });

  test('stop -> stopped (session idle)', async ({ page }) => {
    await login(page);
    await row(page).getByRole('button', { name: 'Stop' }).click();
    // UI shows "screen only" when the program exited but its tmux session is still alive
    await expect(row(page)).toContainText('screen only', { timeout: 15000 });
    await expect(row(page)).toContainText('(active)');
    await page.screenshot(SHOT('05-stopped'));
  });

  test('kill -> session gone, then delete', async ({ page }) => {
    await login(page);
    await openRowMenu(page);
    await page.screenshot(SHOT('06-row-menu'));
    await page.getByRole('button', { name: 'Kill' }).click();
    await expect(row(page)).not.toContainText('(active)', { timeout: 15000 });

    await deleteProgram(page);
    await page.screenshot(SHOT('07-deleted'));
  });

  test('Open Terminal gives a shell', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Open Terminal' }).click();
    await page.waitForTimeout(3000);
    await page.screenshot(SHOT('08-open-terminal'));
    const text = await page.locator('.xterm-rows').innerText();
    expect(text.trim().length, 'terminal rendered something').toBeGreaterThan(0);
    // user shells have no close button (closing would kill the shell) - only Terminate
    await expect(page.getByRole('button', { name: '×' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Terminate' })).toBeVisible();
  });
});
