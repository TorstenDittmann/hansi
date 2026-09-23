// Hansi, drawn in ASCII from signed distance fields so every part can move smoothly.
// World units: x right, y down. A character cell is 1.2 wide and 2 tall (monospace is ~0.6:1).
//
// A frame has three layers drawn on top of each other: `fur` (shading and the ground shadow),
// `ink` (outlines, face, whiskers), and `fly` (the fly and its trail), each in its own color.

export const ROWS = 52;
const CELL_W = 1.2;
const CELL_H = 2;
const ORIGIN_ROW = 26;

/** The canvas: how many columns wide it is, and which column the cat sits on. */
export interface Layout {
	cols: number;
	catCol: number;
}

/** The standalone size: just the cat and some room around it. */
export const DEFAULT_LAYOUT: Layout = { cols: 88, catCol: 44 };

/** A canvas `cols` wide with the cat near the right edge (centered when the canvas is narrow). */
export function layoutFor(cols: number): Layout {
	const width = Math.max(1, cols);
	// Wide canvases leave fly-room on the left; below the default width, keep the cat on screen.
	const catCol =
		width >= DEFAULT_LAYOUT.cols
			? Math.max(44, width - 44)
			: Math.max(1, Math.min(44, Math.round(width / 2)));
	return { cols: width, catCol };
}

export type Vec = { x: number; y: number };

export type Eyes = 'open' | 'blink' | 'closed' | 'happy';
export type Mouth = 'rest' | 'happy' | 'yawn' | 'lick';

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
	/** 0..1 while stalking the fly just before a swipe: the cat crouches lower. */
	crouch: number;
	/** Phase of the tail's sway, advanced smoothly by the caller so speed changes never jump. */
	tailPhase: number;
	/** 0..1 how excited the tail is; the caller eases it in and out. */
	tailEnergy: number;
	eyes: Eyes;
	mouth: Mouth;
	/** Head tilt in radians; positive tilts the top of the head to the right. */
	tilt: number;
	/** 0..1 per ear (left, right): how far it is flicked back. */
	ears: [number, number];
	/** -1..1 sideways shift of the hindquarters: the wiggle before a pounce. */
	wiggle: number;
	/** 0 when not grooming, else the phase of the licking motion (grows over time). */
	groom: number;
	/** Looking at its paw after a miss. */
	puzzled: boolean;
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

function rotate(p: Vec, around: Vec, angle: number): Vec {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const dx = p.x - around.x;
	const dy = p.y - around.y;
	return { x: around.x + dx * c - dy * s, y: around.y + dx * s + dy * c };
}

/* The cat. */

interface Pose {
	head: Vec;
	tilt: number;
	breath: number;
	ears: [Vec, Vec, Vec][];
	innerEars: [Vec, Vec, Vec][];
	haunch: Vec;
	/** Front legs: shoulder to paw, left then right. */
	legs: [Vec, Vec][];
	paws: Vec[];
	pawLifted: [boolean, boolean];
	tail: Vec[];
	tailWidth: number[];
}

const SHOULDER: Vec = { x: 6, y: 17 };
const PAW_REST: Vec = { x: 6.5, y: 37.5 };
const LEFT_PAW: Vec = { x: -6.5, y: 37.5 };

function pose(scene: Scene): Pose {
	const t = scene.time;
	const lookX = scene.target
		? Math.max(-1, Math.min(1, scene.target.x / 40))
		: Math.sin(t * 0.4) * 0.3;
	const breath = Math.sin(t * 1.6) * 0.5;
	const yawnLift = scene.mouth === 'yawn' ? -1.2 : 0;
	const groomDip = scene.groom ? 1.5 : 0;
	const head = {
		x: lookX * 2.2 - (scene.groom ? 1.5 : 0),
		y: -9 + breath * 0.4 + scene.crouch * 2.5 + yawnLift + groomDip
	};
	const tilt = scene.tilt + (scene.puzzled ? 0.1 : 0);

	// Ears: wide at the base, a little outward. A flick folds the tip back and down.
	const ears: [Vec, Vec, Vec][] = [];
	const innerEars: [Vec, Vec, Vec][] = [];
	for (const [index, side] of [-1, 1].entries()) {
		const flick = scene.ears[index]!;
		const outer = { x: head.x + side * 10.5, y: head.y - 5.5 };
		const tip = { x: head.x + side * (9.5 + flick * 2.5), y: head.y - 16.5 + flick * 4 };
		const inner = { x: head.x + side * 3, y: head.y - 9.2 };
		const ear = [outer, tip, inner].map((p) => rotate(p, head, tilt)) as [Vec, Vec, Vec];
		// Clockwise winding for the triangle distance.
		ears.push(side < 0 ? ear : [ear[0], ear[2], ear[1]]);
		const centre = {
			x: (ear[0].x + ear[1].x + ear[2].x) / 3,
			y: (ear[0].y + ear[1].y + ear[2].y) / 3 + 1
		};
		const shrink = (p: Vec) => ({
			x: centre.x + (p.x - centre.x) * 0.45,
			y: centre.y + (p.y - centre.y) * 0.45
		});
		const small = ear.map(shrink) as [Vec, Vec, Vec];
		innerEars.push(side < 0 ? small : [small[0], small[2], small[1]]);
	}

	// Paws: the right one swipes (raised slowly, a strike toward the aim, a short hold, then
	// drawn back); the left one comes up to the mouth while grooming.
	let right = PAW_REST;
	let rightLifted = false;
	if (scene.swipe > 0 && scene.swipeTarget) {
		const reach = swipeReach(scene.swipe);
		const target = clampToReach(scene.swipeTarget);
		right = {
			x: PAW_REST.x + (target.x - PAW_REST.x) * reach,
			y: PAW_REST.y + (target.y - PAW_REST.y) * reach - Math.sin(reach * Math.PI) * 3
		};
		rightLifted = reach > 0.05;
	}
	let left = LEFT_PAW;
	let leftLifted = false;
	if (scene.groom) {
		const lick = Math.sin(scene.groom * Math.PI * 2 * 2.2);
		left = { x: head.x - 4.5 + lick * 0.4, y: head.y + 8.5 + lick * 1.2 };
		leftLifted = true;
	}

	// Tail: sits on the ground and wraps around the front paws, tip curled up. The tip sways;
	// excitement makes it flick and lift.
	const energy = scene.tailEnergy;
	const tail: Vec[] = [{ x: 15 + scene.wiggle * 1.5, y: 32 }];
	const tailWidth: number[] = [];
	let angle = 0.1;
	const segments = 22;
	for (let i = 0; i < segments; i++) {
		const tip = Math.max(0, (i - 15) / 7);
		// Around the haunch, along the ground in front of the paws, then the tip curls up.
		const bend = i < 6 ? 0.49 : i < 17 ? 0.025 : 0.36 - energy * 0.3;
		angle +=
			bend +
			tip *
				(0.12 * Math.sin(scene.tailPhase - i * 0.5) +
					energy * 0.3 * Math.sin(scene.tailPhase * 2.6 - i * 0.8));
		const last = tail[tail.length - 1]!;
		tail.push({ x: last.x + Math.cos(angle) * 2.4, y: last.y + Math.sin(angle) * 2.4 });
		tailWidth.push(2.2 - (i / segments) * 1.1);
	}

	return {
		head,
		tilt,
		breath,
		ears,
		innerEars,
		haunch: { x: scene.wiggle * 1.5, y: 26.5 },
		legs: [
			[leftLifted ? { x: -5, y: 6 } : { x: -5.5, y: 20 }, left],
			[rightLifted ? SHOULDER : { x: 5.5, y: 20 }, right]
		],
		paws: [left, right],
		pawLifted: [leftLifted, rightLifted],
		tail,
		tailWidth
	};
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
	return pose(scene).paws[1]!;
}

export function canReach(p: Vec) {
	return Math.hypot(p.x - SHOULDER.x, p.y - SHOULDER.y) < 28 && p.y > -30;
}

function headDistance(p: Vec, q: Pose) {
	const skull = ellipse(p, q.head, 11, 9.5);
	const cheeks = Math.min(
		ellipse(p, { x: q.head.x - 7.5, y: q.head.y + 3.5 }, 7, 5.5),
		ellipse(p, { x: q.head.x + 7.5, y: q.head.y + 3.5 }, 7, 5.5)
	);
	const ears = Math.min(triangle(p, ...q.ears[0]!), triangle(p, ...q.ears[1]!));
	return smoothUnion(smoothUnion(skull, cheeks, 4), ears, 2);
}

function bodyDistance(p: Vec, q: Pose) {
	// A teardrop: narrow under the head, widest at the haunches.
	const chest = ellipse(p, { x: 0, y: 12 - q.breath * 0.3 }, 11.5 + q.breath * 0.3, 15);
	const haunch = ellipse(p, q.haunch, 21.5, 14);
	let d = smoothUnion(chest, haunch, 12);
	d = smoothUnion(d, headDistance(p, q), 8);
	for (let i = 0; i < 2; i++) {
		if (q.pawLifted[i]) continue;
		const [shoulder, paw] = q.legs[i]!;
		d = Math.min(d, capsule(p, shoulder, paw, 3));
		d = Math.min(d, ellipse(p, paw, 4.6, 3));
	}
	return d;
}

/** What is in front of the body: the tail, and a paw that is lifted (swiping or grooming). */
function frontDistance(p: Vec, q: Pose) {
	let d = Infinity;
	for (let i = 0; i < q.tail.length - 1; i++) {
		d = Math.min(d, capsule(p, q.tail[i]!, q.tail[i + 1]!, q.tailWidth[i]!));
	}
	for (let i = 0; i < 2; i++) {
		if (!q.pawLifted[i]) continue;
		const [shoulder, paw] = q.legs[i]!;
		d = Math.min(d, smoothUnion(capsule(p, shoulder, paw, 2.6), ellipse(p, paw, 3.8, 3), 2));
	}
	return d;
}

/**
 * Lines drawn inside the silhouette: the edges of the front legs where they cross the chest. Negative inside, like the others.
 */
function detailDistance(p: Vec, q: Pose) {
	let d = Infinity;
	for (let i = 0; i < 2; i++) {
		if (q.pawLifted[i]) continue;
		const [shoulder, paw] = q.legs[i]!;
		if (p.y > 24 && p.y < paw.y - 2) d = Math.min(d, capsule(p, shoulder, paw, 3));
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

/** 4x4 ordered dither, so shading reads as texture instead of bands. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const FUR = [' ', '.', ':', ';', '+', '*'];
/** Light comes from the upper left. */
const LIGHT = { x: -0.6, y: -0.8 };

export interface Frame {
	ink: string;
	fur: string;
	fly: string;
}

export function render(scene: Scene, layout: Layout = DEFAULT_LAYOUT): Frame {
	const COLS = layout.cols;
	const q = pose(scene);
	const ink: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
	const fur: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
	const flyLayer: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
	const body = new Float32Array(ROWS * COLS).fill(1);
	const tail = new Float32Array(ROWS * COLS).fill(1);
	const detail = new Float32Array(ROWS * COLS).fill(1);

	// Only cells near the cat can be part of it; the rest of a wide canvas is just for the fly.
	const reachX = [...q.tail, ...q.paws].map((p) => p.x);
	const minCol = Math.max(0, worldToCell({ x: Math.min(-30, ...reachX) - 4, y: 0 }, layout).col);
	const maxCol = Math.min(
		COLS - 1,
		worldToCell({ x: Math.max(30, ...reachX) + 4, y: 0 }, layout).col
	);
	for (let row = 0; row < ROWS; row++) {
		for (let col = minCol; col <= maxCol; col++) {
			const p = cellToWorld(col, row, layout);
			const i = row * COLS + col;
			body[i] = bodyDistance(p, q);
			tail[i] = frontDistance(p, q);
			detail[i] = detailDistance(p, q);
		}
	}
	const at = (field: Float32Array, col: number, row: number) =>
		col < 0 || col >= COLS || row < 0 || row >= ROWS ? 1 : field[row * COLS + col]!;
	const touchesOutside = (field: Float32Array, col: number, row: number) =>
		at(field, col - 1, row) >= 0 ||
		at(field, col + 1, row) >= 0 ||
		at(field, col, row - 1) >= 0 ||
		at(field, col, row + 1) >= 0;
	// Cells are ~0.6 as wide as tall on screen.
	const normal = (field: Float32Array, col: number, row: number) => ({
		x: (at(field, col + 1, row) - at(field, col - 1, row)) / 0.6,
		y: at(field, col, row + 1) - at(field, col, row - 1)
	});

	for (let row = 0; row < ROWS; row++) {
		for (let col = 0; col < COLS; col++) {
			const i = row * COLS + col;
			const p = cellToWorld(col, row, layout);
			// The tail and lifted paws are in front of the body; whichever is in front owns the cell.
			const field = tail[i]! < 0 ? tail : body[i]! < 0 ? body : null;
			if (!field) {
				const shadow = ellipse(p, { x: 1, y: 41.5 }, 27, 2.2);
				if (shadow < 0 && (col + row) % 2 === 0) fur[row]![col] = shadow < -1.2 ? ':' : '.';
				continue;
			}
			if (touchesOutside(field, col, row)) {
				const n = normal(field, col, row);
				ink[row]![col] = edgeChar(n.x, n.y);
				continue;
			}
			if (field === body && detail[i]! < 0 && touchesOutside(detail, col, row)) {
				// Only the sides of the legs: horizontal strokes would box them in.
				const n = normal(detail, col, row);
				const stroke = edgeChar(n.x, n.y);
				if (stroke !== '-' && stroke !== '_') {
					ink[row]![col] = stroke;
					continue;
				}
			}
			// Fur: darker where the surface turns away from the light, near the edges, and lower
			// down. The face stays light so it reads.
			const d = field[i]!;
			const n = normal(field, col, row);
			const length = Math.hypot(n.x, n.y) || 1;
			const lit = Math.max(0, (n.x * LIGHT.x + n.y * LIGHT.y) / length);
			const rim = Math.max(0, 1 - -d / 7);
			let shade = 0.1 + (1 - lit) * rim * 0.75 + Math.max(0, (p.y + 5) / 45) * 0.35;
			if (field === body && Math.hypot((p.x - q.head.x) / 11, (p.y - q.head.y - 2) / 9) < 1) {
				shade *= 0.35;
			}
			const level = Math.floor(shade * (FUR.length - 1) + BAYER[(row % 4) * 4 + (col % 4)]! - 0.5);
			fur[row]![col] = FUR[Math.max(0, Math.min(FUR.length - 1, level))]!;
		}
	}

	/** Writes text centered on `p`, on the ink layer or the fly layer, clearing what is below. */
	const put = (p: Vec, text: string, layer = ink) => {
		const { col, row } = worldToCell(p, layout);
		const start = col - Math.floor(text.length / 2);
		if (row < 0 || row >= ROWS) return;
		for (let i = 0; i < text.length; i++) {
			const c = start + i;
			if (c < 0 || c >= COLS || text[i] === '\u0000') continue;
			for (const below of [ink, fur, flyLayer]) below[row]![c] = ' ';
			layer[row]![c] = text[i]!;
		}
	};
	const onHead = (offset: Vec) =>
		rotate({ x: q.head.x + offset.x, y: q.head.y + offset.y }, q.head, q.tilt);

	// Face.
	const look = scene.puzzled
		? { x: 0.6, y: 1 }
		: scene.target
			? {
					x: Math.max(-1, Math.min(1, (scene.target.x - q.head.x) / 30)),
					y: Math.max(-1, Math.min(1, (scene.target.y - q.head.y) / 30))
				}
			: { x: Math.sin(scene.time * 0.4) * 0.5, y: 0 };
	for (const side of [-1, 1]) {
		const eye = onHead({ x: side * 5.8, y: 0 });
		if (scene.eyes === 'happy') put(eye, ' ^ ^ ');
		else if (scene.eyes === 'blink') put(eye, '(---)');
		else if (scene.eyes === 'closed') put(eye, ' --- ');
		else {
			// Pupils widen while stalking.
			const dot = scene.crouch > 0.4 ? 'O' : '@';
			const pupil = look.x < -0.3 ? `(${dot}  )` : look.x > 0.3 ? `(  ${dot})` : `( ${dot} )`;
			put({ x: eye.x, y: eye.y - 2 }, look.y < -0.45 ? ' .". ' : ' ___ ');
			put(eye, pupil);
		}
	}
	put(onHead({ x: 0, y: 4.5 }), 'v');
	if (scene.mouth === 'yawn') {
		put(onHead({ x: 0, y: 6.5 }), '/"\\');
		put(onHead({ x: 0, y: 8.5 }), '\\_/');
	} else if (scene.mouth === 'lick') {
		put(onHead({ x: 0, y: 6.5 }), Math.floor(scene.time * 6) % 2 ? '\\u/' : '\\_/');
	} else {
		put(onHead({ x: 0, y: 6.5 }), scene.mouth === 'happy' ? '\\_/' : 'w');
	}
	if (scene.groom) put(onHead({ x: -3.5, y: 8.5 }), Math.floor(scene.groom * 9) % 2 ? 'u' : ' ');
	for (const side of [-1, 1]) {
		put(onHead({ x: side * 16.5, y: 4 }), '---');
		put(onHead({ x: side * 16.5, y: 6.5 }), '-~-');
	}
	if (scene.puzzled) put(onHead({ x: 12, y: -16 }), '?');

	// Toes on paws that rest on the ground.
	for (let i = 0; i < 2; i++) {
		if (!q.pawLifted[i]) put({ x: q.paws[i]!.x, y: q.paws[i]!.y + 1 }, "'''");
	}

	// Fly with a dotted trail and flapping wings.
	scene.trail.forEach((p, i) => {
		if (i % 2 === 0) put(p, '.', flyLayer);
	});
	if (scene.fly) put(scene.fly, Math.floor(scene.time * 24) % 2 === 0 ? '\\o/' : '-o-', flyLayer);

	return {
		ink: ink.map((line) => line.join('')).join('\n'),
		fur: fur.map((line) => line.join('')).join('\n'),
		fly: flyLayer.map((line) => line.join('')).join('\n')
	};
}

/** A calm, idle scene: a starting point for callers. */
export function idleScene(time: number): Scene {
	return {
		time,
		target: null,
		fly: null,
		trail: [],
		swipe: 0,
		swipeTarget: null,
		crouch: 0,
		tailPhase: time * 1.6,
		tailEnergy: 0,
		eyes: 'open',
		mouth: 'rest',
		tilt: 0,
		ears: [0, 0],
		wiggle: 0,
		groom: 0,
		puzzled: false
	};
}
