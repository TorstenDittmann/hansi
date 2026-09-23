// Hansi, drawn in ASCII from signed distance fields so every part can move smoothly.
// World units: x right, y down. A character cell is 1.2 wide and 2 tall (monospace is ~0.6:1).

export const ROWS = 52;
const CELL_W = 1.2;
const CELL_H = 2;
const ORIGIN_ROW = 26;

/** The canvas: how many columns wide it is, and which column the cat sits on. */
export interface Layout {
	cols: number;
	catCol: number;
}

/** The standalone size: just the cat and some room around her. */
export const DEFAULT_LAYOUT: Layout = { cols: 88, catCol: 40 };

/** A canvas `cols` wide with the cat near the right edge, leaving room for her tail. */
export function layoutFor(cols: number): Layout {
	return { cols, catCol: Math.max(40, cols - 48) };
}

export type Vec = { x: number; y: number };

export interface Scene {
	/** Seconds since start. */
	time: number;
	/** Where the cat is looking, in world units; null to look around idly. */
	target: Vec | null;
	/** The fly, drawn where the pointer is; null when there is none. */
	fly: Vec | null;
	/** Recent fly positions, oldest first, for its dotted trail. */
	trail: Vec[];
	/** 0..1 while swiping at `swipeTarget`, else 0. */
	swipe: number;
	swipeTarget: Vec | null;
	/** 0..1 while stalking the fly just before a swipe: she crouches lower. */
	crouch: number;
	/** Phase of the tail's sway, advanced smoothly by the caller so speed changes never jump. */
	tailPhase: number;
	/** 0..1 how excited the tail is; the caller eases it in and out. */
	tailEnergy: number;
	blink: boolean;
	happy: boolean;
}

export function cellToWorld(col: number, row: number, layout: Layout = DEFAULT_LAYOUT): Vec {
	return { x: (col - layout.catCol) * CELL_W, y: (row - ORIGIN_ROW) * CELL_H };
}

function worldToCell(p: Vec, layout: Layout) {
	return {
		col: Math.round(p.x / CELL_W + layout.catCol),
		row: Math.round(p.y / CELL_H + ORIGIN_ROW)
	};
}

/* Distance functions (negative inside). */

function ellipse(p: Vec, c: Vec, rx: number, ry: number) {
	// Scaled circle: good enough as long as the ellipse is not too eccentric.
	const dx = (p.x - c.x) / rx;
	const dy = (p.y - c.y) / ry;
	return (Math.hypot(dx, dy) - 1) * Math.min(rx, ry);
}

function capsule(p: Vec, a: Vec, b: Vec, r: number) {
	const pax = p.x - a.x;
	const pay = p.y - a.y;
	const bax = b.x - a.x;
	const bay = b.y - a.y;
	const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay || 1)));
	return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

function triangle(p: Vec, a: Vec, b: Vec, c: Vec) {
	// Inigo Quilez's exact triangle distance.
	const e0 = { x: b.x - a.x, y: b.y - a.y };
	const e1 = { x: c.x - b.x, y: c.y - b.y };
	const e2 = { x: a.x - c.x, y: a.y - c.y };
	const v0 = { x: p.x - a.x, y: p.y - a.y };
	const v1 = { x: p.x - b.x, y: p.y - b.y };
	const v2 = { x: p.x - c.x, y: p.y - c.y };
	const clamp = (v: number) => Math.max(0, Math.min(1, v));
	const proj = (v: Vec, e: Vec) => {
		const h = clamp((v.x * e.x + v.y * e.y) / (e.x * e.x + e.y * e.y));
		return { x: v.x - e.x * h, y: v.y - e.y * h };
	};
	const pq0 = proj(v0, e0);
	const pq1 = proj(v1, e1);
	const pq2 = proj(v2, e2);
	const s = Math.sign(e0.x * e2.y - e0.y * e2.x);
	const d0 = { x: pq0.x ** 2 + pq0.y ** 2, y: s * (v0.x * e0.y - v0.y * e0.x) };
	const d1 = { x: pq1.x ** 2 + pq1.y ** 2, y: s * (v1.x * e1.y - v1.y * e1.x) };
	const d2 = { x: pq2.x ** 2 + pq2.y ** 2, y: s * (v2.x * e2.y - v2.y * e2.x) };
	const dist = Math.min(d0.x, d1.x, d2.x);
	const side = Math.min(d0.y, d1.y, d2.y);
	return -Math.sqrt(dist) * Math.sign(side);
}

function smoothUnion(a: number, b: number, k: number) {
	const h = Math.max(k - Math.abs(a - b), 0) / k;
	return Math.min(a, b) - (h * h * k) / 4;
}

/* The cat. */

interface Pose {
	head: Vec;
	breath: number;
	pawRest: Vec;
	paw: Vec;
	pawLifted: boolean;
	tail: Vec[];
	tailWidth: number[];
}

const SHOULDER: Vec = { x: 8, y: 16 };
const PAW_REST: Vec = { x: 7, y: 37 };

function pose(scene: Scene): Pose {
	const t = scene.time;
	const lookX = scene.target
		? Math.max(-1, Math.min(1, scene.target.x / 40))
		: Math.sin(t * 0.4) * 0.3;
	const breath = Math.sin(t * 1.6) * 0.5;
	const head = { x: lookX * 2.2, y: -17 + breath * 0.4 + scene.crouch * 2.5 };

	// Paw: raised slowly, a strike toward the aim, a short hold, then drawn back.
	let paw = PAW_REST;
	let pawLifted = false;
	if (scene.swipe > 0 && scene.swipeTarget) {
		const reach = swipeReach(scene.swipe);
		const target = clampToReach(scene.swipeTarget);
		paw = {
			x: PAW_REST.x + (target.x - PAW_REST.x) * reach,
			y: PAW_REST.y + (target.y - PAW_REST.y) * reach - Math.sin(reach * Math.PI) * 3
		};
		pawLifted = reach > 0.05;
	}

	// Tail: a chain of segments whose bend travels along it like a wave. Excitement adds a
	// twitch toward the tip only, so the base stays calm.
	const energy = scene.tailEnergy;
	const tail: Vec[] = [{ x: 17, y: 33 }];
	const tailWidth: number[] = [];
	let angle = -0.15;
	const segments = 16;
	for (let i = 0; i < segments; i++) {
		const tip = Math.max(0, (i - 8) / 8);
		angle -=
			0.09 +
			0.12 * Math.sin(scene.tailPhase - i * 0.45) +
			energy * tip * 0.12 * Math.sin(scene.tailPhase * 2.6 - i * 0.7) +
			(i > 11 ? 0.12 : 0);
		const last = tail[tail.length - 1]!;
		tail.push({ x: last.x + Math.cos(angle) * 2.6, y: last.y + Math.sin(angle) * 2.6 });
		tailWidth.push(1.8 - (i / segments) * 0.9);
	}

	return { head, breath, pawRest: PAW_REST, paw, pawLifted, tail, tailWidth };
}

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/**
 * How far the paw is extended (0..1) over the course of a swipe (0..1): raised slowly, a quick
 * strike, a short hold at full reach, then pulled back gently. Full reach starts at 0.5.
 */
export function swipeReach(progress: number) {
	if (progress < 0.3) return 0.15 * ease(progress / 0.3);
	if (progress < 0.5) return 0.15 + 0.85 * ease((progress - 0.3) / 0.2);
	if (progress < 0.65) return 1;
	return 1 - ease(Math.min((progress - 0.65) / 0.35, 1));
}

export function clampToReach(target: Vec): Vec {
	const dx = target.x - SHOULDER.x;
	const dy = target.y - SHOULDER.y;
	const d = Math.hypot(dx, dy);
	const reach = 26;
	return d <= reach
		? target
		: { x: SHOULDER.x + (dx / d) * reach, y: SHOULDER.y + (dy / d) * reach };
}

/** Where the swiping paw is right now, to test whether it caught the fly. */
export function pawPosition(scene: Scene): Vec {
	return pose(scene).paw;
}

export function canReach(p: Vec) {
	return Math.hypot(p.x - SHOULDER.x, p.y - SHOULDER.y) < 28 && p.y > -30;
}

function catDistance(p: Vec, q: Pose) {
	const head = ellipse(p, q.head, 13, 11);
	const earL = triangle(
		p,
		{ x: q.head.x - 12.5, y: q.head.y - 3 },
		{ x: q.head.x - 10.5, y: q.head.y - 18 },
		{ x: q.head.x - 3, y: q.head.y - 9 }
	);
	const earR = triangle(
		p,
		{ x: q.head.x + 12.5, y: q.head.y - 3 },
		{ x: q.head.x + 3, y: q.head.y - 9 },
		{ x: q.head.x + 10.5, y: q.head.y - 18 }
	);
	const chest = ellipse(p, { x: 0, y: 11 - q.breath * 0.3 }, 14.5 + q.breath * 0.3, 19);
	const haunch = ellipse(p, { x: 0, y: 27 }, 21, 11.5);
	let d = smoothUnion(chest, haunch, 6);
	d = smoothUnion(d, smoothUnion(head, Math.min(earL, earR), 2), 5);

	const pawL = ellipse(p, { x: -7, y: 37 }, 5.2, 3.2);
	d = Math.min(d, pawL);
	if (q.pawLifted) {
		d = Math.min(d, capsule(p, SHOULDER, q.paw, 3.1));
		d = Math.min(d, ellipse(p, q.paw, 4.2, 3.2));
	} else {
		d = Math.min(d, ellipse(p, q.paw, 5.2, 3.2));
	}

	for (let i = 0; i < q.tail.length - 1; i++) {
		d = Math.min(d, capsule(p, q.tail[i]!, q.tail[i + 1]!, q.tailWidth[i]!));
	}
	return d;
}

/** Outline character for an edge, from the on-screen direction of the surface normal. */
function edgeChar(sx: number, sy: number) {
	const ax = Math.abs(sx);
	const ay = Math.abs(sy);
	if (ax > ay * 2) return '|';
	if (ay > ax * 2) return sy < 0 ? '-' : '_';
	// The edge runs perpendicular to the normal: a normal pointing down-right means a '/' edge.
	return sx * sy > 0 ? '/' : '\\';
}

export function render(scene: Scene, layout: Layout = DEFAULT_LAYOUT): string {
	const COLS = layout.cols;
	const q = pose(scene);
	const grid: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
	const dist = new Float32Array(ROWS * COLS).fill(1);
	// Only cells near the cat can be part of her; the rest of a wide canvas is just for the fly.
	const reachX = [...q.tail, q.paw].map((p) => p.x);
	const minCol = Math.max(0, worldToCell({ x: Math.min(-30, ...reachX) - 4, y: 0 }, layout).col);
	const maxCol = Math.min(
		COLS - 1,
		worldToCell({ x: Math.max(30, ...reachX) + 4, y: 0 }, layout).col
	);
	for (let row = 0; row < ROWS; row++) {
		for (let col = minCol; col <= maxCol; col++) {
			dist[row * COLS + col] = catDistance(cellToWorld(col, row, layout), q);
		}
	}
	const at = (col: number, row: number) =>
		col < 0 || col >= COLS || row < 0 || row >= ROWS ? 1 : dist[row * COLS + col]!;

	for (let row = 0; row < ROWS; row++) {
		for (let col = 0; col < COLS; col++) {
			const d = at(col, row);
			const p = cellToWorld(col, row, layout);
			if (d >= 0) {
				// Ground shadow under the cat.
				const shadow = ellipse(p, { x: 6, y: 40.5 }, 30, 2.2);
				if (shadow < 0 && (col + row) % 2 === 0) grid[row]![col] = '.';
				continue;
			}
			// Outline: inside cells that touch the outside. One character thick.
			const outside =
				at(col - 1, row) >= 0 ||
				at(col + 1, row) >= 0 ||
				at(col, row - 1) >= 0 ||
				at(col, row + 1) >= 0;
			if (outside) {
				// Cells are ~0.6 as wide as tall on screen.
				const sx = (at(col + 1, row) - at(col - 1, row)) / 0.6;
				const sy = at(col, row + 1) - at(col, row - 1);
				grid[row]![col] = edgeChar(sx, sy);
				continue;
			}
			// Fur shading: denser away from the light (upper left) and toward the edges.
			const shade = (p.x * 0.55 + p.y * 0.45 + 12) / 30 + (d > -3 ? 0.2 : 0);
			const dither = ((col * 7 + row * 13) % 5) / 5;
			grid[row]![col] = shade > 1 + dither * 0.45 ? ':' : shade > 0.62 + dither * 0.55 ? '.' : ' ';
		}
	}

	const put = (p: Vec, text: string, center = true) => {
		const { col, row } = worldToCell(p, layout);
		const start = center ? col - Math.floor(text.length / 2) : col;
		if (row < 0 || row >= ROWS) return;
		for (let i = 0; i < text.length; i++) {
			const c = start + i;
			if (c >= 0 && c < COLS && text[i] !== '\u0000') grid[row]![c] = text[i]!;
		}
	};

	// Face.
	const h = q.head;
	const look = scene.target
		? {
				x: Math.max(-1, Math.min(1, (scene.target.x - h.x) / 30)),
				y: Math.max(-1, Math.min(1, (scene.target.y - h.y) / 30))
			}
		: { x: Math.sin(scene.time * 0.4) * 0.5, y: 0 };
	for (const side of [-1, 1]) {
		const eye = { x: h.x + side * 5.8, y: h.y };
		if (scene.happy) put(eye, ' ^ ^ ');
		else if (scene.blink) put(eye, '(---)');
		else {
			// Pupils widen while she stalks.
			const dot = scene.crouch > 0.4 ? 'O' : '@';
			const pupil = look.x < -0.3 ? `(${dot}  )` : look.x > 0.3 ? `(  ${dot})` : `( ${dot} )`;
			put({ x: eye.x, y: eye.y - 2 }, look.y < -0.45 ? ' .". ' : ' ___ ');
			put(eye, pupil);
		}
	}
	put({ x: h.x, y: h.y + 4.5 }, 'v');
	put({ x: h.x, y: h.y + 6.5 }, scene.happy ? '\\_/' : '-');
	for (const side of [-1, 1]) {
		put({ x: h.x + side * 18, y: h.y + 3 }, side < 0 ? '---' : '---');
		put({ x: h.x + side * 18, y: h.y + 6 }, side < 0 ? '-~-' : '-~-');
	}

	// Fly with a dotted trail and flapping wings.
	scene.trail.forEach((p, i) => {
		if (i % 2 === 0) put(p, '.');
	});
	if (scene.fly) put(scene.fly, Math.floor(scene.time * 24) % 2 === 0 ? '\\o/' : '-o-');

	return grid.map((line) => line.join('')).join('\n');
}
