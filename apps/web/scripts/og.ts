/**
 * Builds the 1200×630 Open Graph image from the homepage ASCII cat.
 *
 *   bun apps/web/scripts/og.ts
 *
 * Writes `static/og.png`. Uses the same `render()` call as the hero. Needs
 * JetBrains Mono and `rsvg-convert`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { idleScene, render, type Layout, type Scene } from '../src/lib/hansi/engine.ts';

const WIDTH = 1200;
const HEIGHT = 630;

/** Dark homepage palette (stone-950 / stone-100 / stone-400) and hero ASCII colors. */
const COLOR = {
	bg: '#0c0a09',
	title: '#f5f5f4',
	tagline: '#a8a29e',
	fur: '#c2410c',
	ink: '#fdba74',
	fly: '#e7e5e4'
};

const TITLE = 'Hansi';
const TAGLINE = 'AI code review for GitHub.';

const here = dirname(fileURLToPath(import.meta.url));
const pngPath = join(here, '../static/og.png');
const svgPath = join(tmpdir(), 'hansi-og.svg');

const MONO =
	[
		'/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf',
		'/usr/share/fonts/truetype/macos/JetBrainsMono-Regular.ttf'
	].find((path) => Bun.file(path).size > 0) ?? 'ui-monospace';

const DISPLAY =
	[
		'/tmp/MartianMono.ttf',
		'/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf',
		'/usr/share/fonts/truetype/macos/JetBrainsMono-Bold.ttf'
	].find((path) => {
		try {
			return Bun.file(path).size > 0;
		} catch {
			return false;
		}
	}) ?? MONO;

/** A still hero frame: the cat looking left at a fly, like the interactive homepage. */
function heroScene(): Scene {
	const fly = { x: -26, y: -6 };
	return {
		...idleScene(0.9),
		fly,
		target: fly,
		trail: [{ x: -16, y: 4 }, { x: -20, y: 1 }, { x: -23, y: -3 }, fly]
	};
}

function crop(layers: string[], padCols = 1, padRows = 0): string[] {
	const grids = layers.map((layer) => layer.split('\n'));
	const rows = grids[0]!.length;
	const cols = grids[0]![0]!.length;
	let minR = rows;
	let maxR = -1;
	let minC = cols;
	let maxC = -1;
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			if (grids.some((grid) => grid[r]![c] !== ' ')) {
				minR = Math.min(minR, r);
				maxR = Math.max(maxR, r);
				minC = Math.min(minC, c);
				maxC = Math.max(maxC, c);
			}
		}
	}
	minR = Math.max(0, minR - padRows);
	maxR = Math.min(rows - 1, maxR + padRows);
	minC = Math.max(0, minC - padCols);
	maxC = Math.min(cols - 1, maxC + padCols);
	return grids.map((grid) =>
		grid
			.slice(minR, maxR + 1)
			.map((line) => line.slice(minC, maxC + 1))
			.join('\n')
	);
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function asciiText(content: string, fill: string, fontSize: number, opacity = 1): string {
	const tspans = content
		.split('\n')
		.map((line) => `\t\t<tspan x="0" dy="${fontSize}">${escapeXml(line)}</tspan>`)
		.join('\n');
	const extra = opacity < 1 ? ` fill-opacity="${opacity}"` : '';
	return `\t<text xml:space="preserve" font-family="JetBrains Mono, ui-monospace, monospace" font-size="${fontSize}" fill="${fill}"${extra}>\n${tspans}\n\t</text>`;
}

function fontFace(name: string, path: string, weight = 400): string {
	if (!path.startsWith('/')) return '';
	return `@font-face { font-family: '${name}'; font-weight: ${weight}; src: url('${path}'); }`;
}

function svg(fur: string, ink: string, fly: string): string {
	const lines = ink.split('\n').length;
	const cols = ink.split('\n')[0]!.length;
	const padX = 56;
	const titleSize = 84;
	const tagSize = 28;
	const fontSize = Math.max(12, Math.floor((HEIGHT - 20) / lines));
	const artW = cols * fontSize * 0.6;
	const artH = lines * fontSize;
	const artX = WIDTH - 28 - artW;
	const artY = (HEIGHT - artH) / 2 - fontSize * 0.1;
	const copyX = padX;
	const copyY = HEIGHT / 2;

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<defs>
		<style>
			${fontFace('Martian Mono', DISPLAY, 700)}
			${fontFace('JetBrains Mono', MONO, 400)}
		</style>
	</defs>
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${COLOR.bg}"/>
	<text x="${copyX}" y="${copyY - 4}" font-family="Martian Mono, JetBrains Mono, ui-monospace, monospace" font-weight="700" font-size="${titleSize}" letter-spacing="-3.2" fill="${COLOR.title}">${TITLE}</text>
	<text x="${copyX}" y="${copyY + 48}" font-family="Martian Mono, JetBrains Mono, ui-monospace, monospace" font-weight="500" font-size="${tagSize}" fill="${COLOR.tagline}">${escapeXml(TAGLINE)}</text>
	<g transform="translate(${artX.toFixed(1)} ${artY.toFixed(1)})">
${asciiText(fur, COLOR.fur, fontSize, 0.85)}
${asciiText(ink, COLOR.ink, fontSize)}
${asciiText(fly, COLOR.fly, fontSize)}
	</g>
</svg>
`;
}

function rasterize(markup: string, svg: string, dest: string) {
	writeFileSync(svg, markup);
	const result = spawnSync(
		'rsvg-convert',
		['-w', String(WIDTH), '-h', String(HEIGHT), svg, '-o', dest],
		{
			encoding: 'utf8'
		}
	);
	if (result.status !== 0) {
		throw new Error(`rsvg-convert failed: ${result.stderr || result.stdout || result.status}`);
	}
}

const layout: Layout = { cols: 64, catCol: 38 };
const frame = render(heroScene(), layout);
const [fur, ink, fly] = crop([frame.fur, frame.ink, frame.fly]);

mkdirSync(dirname(pngPath), { recursive: true });
rasterize(svg(fur!, ink!, fly!), svgPath, pngPath);
console.log(`wrote ${pngPath} (${(await Bun.file(pngPath).size).toLocaleString()} bytes)`);
