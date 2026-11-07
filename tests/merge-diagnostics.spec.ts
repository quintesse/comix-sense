import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

test('local diagnostic viewer filters, paginates, links sources, and safely renders private strings', async ({
	page
}) => {
	const directory = await mkdtemp(path.join(tmpdir(), 'merge-trace-'));
	const words = Array.from({ length: 18 }, (_, i) => ({
		id: `s${i}`,
		text: i === 0 ? '</script><img src=x onerror="window.injected=true">' : 'Invented',
		shape: {
			type: 'box',
			vs: [
				{ x: 0, y: i * 24 },
				{ x: 100, y: i * 24 + 20 }
			]
		}
	}));
	words[17].id = '</script><img src=x>';
	const input = { id: 'viewer', words };
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	try {
		const dataset = path.join(directory, 'dataset.json');
		await writeFile(dataset, JSON.stringify({ schemaVersion: 1, pages: [input] }));
		const output = path.join(directory, 'report');
		execFileSync(process.execPath, [
			'--import',
			'./tools/merge-eval/register.mjs',
			'tools/merge-eval/cli.mjs',
			'--trace',
			'--dataset',
			dataset,
			'--output',
			output
		]);
		const file = path.join(output, 'index.html');
		await page.goto(pathToFileURL(file).href);
		await page.getByText(/^Decision trace/).click();
		const panel = page.locator('.trace');
		await expect(panel.locator('tbody tr')).toHaveCount(100);
		await panel.getByRole('button', { name: 'Next', exact: true }).click();
		await expect(panel.locator('.count')).toContainText('101');
		await panel.getByLabel('Source ID').fill('s0');
		await panel.getByLabel('Stage').selectOption('grouping: continuation');
		await expect(panel.locator('tbody tr')).toHaveCount(17);
		await panel.getByRole('link', { name: 's0', exact: true }).first().click();
		await expect(page.locator('#source-0-0')).toBeVisible();
		expect(JSON.parse((await page.locator('#source-0-0 pre').textContent())!).text).toBe(
			words[0].text
		);
		expect(await page.evaluate(() => Object.hasOwn(window, 'injected'))).toBe(false);
		expect(
			await page
				.locator('#trace-data')
				.evaluate((element) => JSON.parse(element.textContent!).at(0).sources[0].text)
		).toBe(words[0].text);
		expect(errors).toEqual([]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
