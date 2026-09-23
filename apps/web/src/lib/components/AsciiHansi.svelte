<script lang="ts">
	import { onMount } from 'svelte';
	import {
		canReach,
		cellToWorld,
		DEFAULT_LAYOUT,
		layoutFor,
		pawPosition,
		render,
		ROWS,
		type Layout,
		type Scene,
		type Vec
	} from '$lib/hansi/engine';

	// Hansi the cat, on a canvas as wide as its container. A fly follows the pointer across the
	// canvas; when it comes within reach, the cat stalks it and swipes.
	let { class: className = '' } = $props();

	/** How long the cat stalks a fly in reach before swiping (random in this range). */
	const STALK_SECONDS: [number, number] = [1.2, 2.2];
	/** A whole swipe: paw raised, strike, hold, and drawn back (see swipeReach). */
	const SWIPE_SECONDS = 1.4;
	const MISS_COOLDOWN_SECONDS = 1.6;
	const CELEBRATE_SECONDS = 1.8;
	const RESPAWN_SECONDS = 2.4;
	const CATCH_DISTANCE = 6;

	let pre: HTMLPreElement | undefined = $state();

	const idle = (time: number): Scene => ({
		time,
		target: null,
		fly: null,
		trail: [],
		swipe: 0,
		swipeTarget: null,
		crouch: 0,
		tailPhase: time * 1.6,
		tailEnergy: 0,
		blink: false,
		happy: false
	});

	// Server-rendered first frame at the default width; lines are right-aligned, so the cat sits
	// where the full-width canvas will draw the cat.
	const firstFrame = render(idle(0), DEFAULT_LAYOUT);

	onMount(() => {
		const element = pre!;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		const random = (range: [number, number]) => range[0] + Math.random() * (range[1] - range[0]);

		let pointer: Vec | null = null;
		/** Smoothed pointer velocity, so the fly can move with the pointer instead of trailing it. */
		let pointerVelocity: Vec = { x: 0, y: 0 };
		let previousPointer: Vec | null = null;
		let fly: { p: Vec; v: Vec; orbit: number } | null = null;
		let trail: Vec[] = [];
		let lastTrail = 0;
		let respawnAt = 0;
		let stalk = 0;
		let stalkNeeded = random(STALK_SECONDS);
		let swipeStart = -1;
		/** Where the paw aims: fixed when the swipe starts, so a fly that keeps moving can get away. */
		let swipeAim: Vec | null = null;
		let swipeChecked = false;
		let cooldownUntil = 0;
		let celebrateUntil = 0;
		let blinkUntil = 0;
		let nextBlink = 2 + Math.random() * 3;
		let crouch = 0;
		let tailPhase = 0;
		let tailEnergy = 0;
		let visible = true;
		let layout: Layout = DEFAULT_LAYOUT;
		let charWidth = 0;

		// Fit the canvas to the element: as many columns as fit at the current font size. The width
		// of a character is measured from real rendered text, so pointer positions map exactly.
		const measure = () => {
			const style = getComputedStyle(element);
			const sample = document.createElement('span');
			sample.textContent = 'M'.repeat(100);
			Object.assign(sample.style, {
				position: 'absolute',
				visibility: 'hidden',
				whiteSpace: 'pre',
				fontFamily: style.fontFamily,
				fontSize: style.fontSize,
				fontWeight: style.fontWeight,
				letterSpacing: style.letterSpacing
			});
			document.body.append(sample);
			charWidth = sample.getBoundingClientRect().width / 100 || 5.4;
			sample.remove();
			layout = layoutFor(
				Math.max(DEFAULT_LAYOUT.cols, Math.floor(element.clientWidth / charWidth))
			);
		};
		measure();
		// Web fonts may arrive after the first measurement and change the character width.
		void document.fonts.ready.then(measure);
		const resizeObserver = new ResizeObserver(measure);
		resizeObserver.observe(element);
		let frame = 0;
		let last = performance.now();
		const start = last;

		const onPointerMove = (event: PointerEvent) => {
			if (event.pointerType !== 'mouse') return;
			const box = element.getBoundingClientRect();
			const inside =
				event.clientX >= box.left &&
				event.clientX <= box.right &&
				event.clientY >= box.top &&
				event.clientY <= box.bottom;
			// Lines are right-aligned, so any leftover space sits at the left edge.
			const offset = box.width - layout.cols * charWidth;
			pointer = inside
				? cellToWorld(
						(event.clientX - box.left - offset) / charWidth,
						((event.clientY - box.top) / box.height) * ROWS,
						layout
					)
				: null;
		};
		const onPointerLeave = () => (pointer = null);

		/** The side edge closest to `p`, just outside the canvas. */
		const nearestEdge = (p: Vec): Vec => {
			const left = cellToWorld(-3, 0, layout).x;
			const right = cellToWorld(layout.cols + 3, 0, layout).x;
			return { x: p.x - left < right - p.x ? left : right, y: p.y };
		};

		/**
		 * The fly flies in from the nearest side, circles the pointer on a wobbly orbit (lagging
		 * behind like a real one), and flies out again when the pointer leaves.
		 */
		const moveFly = (time: number, dt: number) => {
			if (!fly) {
				if (!pointer || time < respawnAt) return;
				fly = { p: nearestEdge(pointer), v: { x: 0, y: 0 }, orbit: 0 };
			}
			let desired: Vec;
			if (pointer && previousPointer && dt > 0) {
				pointerVelocity = {
					x: pointerVelocity.x * 0.6 + ((pointer.x - previousPointer.x) / dt) * 0.4,
					y: pointerVelocity.y * 0.6 + ((pointer.y - previousPointer.y) / dt) * 0.4
				};
			} else {
				pointerVelocity = { x: 0, y: 0 };
			}
			previousPointer = pointer ? { ...pointer } : null;
			if (pointer) {
				// A tight, jittery orbit: the fly stays right at the pointer.
				fly.orbit += dt * (6 + 2 * Math.sin(time * 0.9));
				const radius = 2.6 + Math.sin(time * 1.7);
				desired = {
					x: pointer.x + Math.cos(fly.orbit) * radius + Math.sin(time * 5.3) * 0.6,
					y: pointer.y + Math.sin(fly.orbit) * radius * 0.8 + Math.cos(time * 4.1) * 0.5
				};
			} else {
				desired = nearestEdge(fly.p);
				desired.x += desired.x < 0 ? -20 : 20;
				const gone =
					cellToWorld(-2, 0, layout).x > fly.p.x ||
					cellToWorld(layout.cols + 2, 0, layout).x < fly.p.x;
				if (gone) {
					fly = null;
					trail = [];
					return;
				}
			}
			// A stiff spring damped relative to the pointer's velocity: the fly moves along with the
			// pointer (no constant trailing offset) and only wobbles around it.
			const carry = pointer ? pointerVelocity : { x: 0, y: 0 };
			fly.v.x += ((desired.x - fly.p.x) * 120 - (fly.v.x - carry.x) * 18) * dt;
			fly.v.y += ((desired.y - fly.p.y) * 120 - (fly.v.y - carry.y) * 18) * dt;
			fly.p = { x: fly.p.x + fly.v.x * dt, y: fly.p.y + fly.v.y * dt };
			if (time - lastTrail > 0.06) {
				trail = [...trail, fly.p].slice(-7);
				lastTrail = time;
			}
		};

		const tick = (now: number) => {
			frame = requestAnimationFrame(tick);
			const dt = Math.min((now - last) / 1000, 0.05);
			last = now;
			if (!visible) return;
			const time = (now - start) / 1000;

			moveFly(time, dt);
			const celebrating = time < celebrateUntil;
			const target = fly && !celebrating ? fly.p : null;

			// Stalk a fly in reach, crouching lower, then swipe.
			let swipe = 0;
			if (swipeStart >= 0) {
				swipe = (time - swipeStart) / SWIPE_SECONDS;
				if (swipe >= 1) {
					swipe = 0;
					swipeStart = -1;
					swipeAim = null;
					cooldownUntil = time + MISS_COOLDOWN_SECONDS;
				}
			} else if (target && time > cooldownUntil && canReach(target)) {
				stalk += dt;
				if (stalk >= stalkNeeded) {
					swipeStart = time;
					swipeAim = { ...target };
					swipeChecked = false;
					stalk = 0;
					stalkNeeded = random(STALK_SECONDS);
				}
			} else {
				stalk = Math.max(0, stalk - dt * 2);
			}
			// Ease crouch and tail excitement toward their targets so nothing ever pops.
			const approach = (value: number, goal: number, rate: number) =>
				value + (goal - value) * Math.min(1, dt * rate);
			const crouchGoal = swipeStart >= 0 ? 1 : Math.min(stalk / stalkNeeded, 1) ** 2;
			crouch = approach(crouch, crouchGoal, 6);
			tailEnergy = approach(tailEnergy, target ? 0.5 + crouch * 0.5 : 0, 2);
			// The phase advances by the current speed, so changing speed never makes the tail jump.
			tailPhase += dt * (1.6 + tailEnergy * 1.4);

			const scene: Scene = {
				time,
				target,
				fly: target,
				trail: target ? trail : [],
				swipe,
				swipeTarget: swipeAim,
				crouch,
				tailPhase,
				tailEnergy,
				blink: time < blinkUntil,
				happy: celebrating
			};

			// At the top of the swipe, see whether the paw landed on the fly.
			if (target && swipe >= 0.5 && !swipeChecked) {
				swipeChecked = true;
				const paw = pawPosition(scene);
				if (Math.hypot(paw.x - target.x, paw.y - target.y) < CATCH_DISTANCE) {
					celebrateUntil = time + CELEBRATE_SECONDS;
					respawnAt = time + RESPAWN_SECONDS;
					fly = null;
					trail = [];
					scene.fly = null;
					scene.trail = [];
				}
			}

			if (time > nextBlink) {
				blinkUntil = time + 0.14;
				nextBlink = time + 2.5 + Math.random() * 4;
			}

			element.textContent = render(scene, layout);
		};

		// Pause while scrolled out of view.
		const observer = new IntersectionObserver(([entry]) => (visible = !!entry?.isIntersecting));
		observer.observe(element);
		window.addEventListener('pointermove', onPointerMove);
		element.addEventListener('pointerleave', onPointerLeave);
		frame = requestAnimationFrame(tick);

		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			resizeObserver.disconnect();
			window.removeEventListener('pointermove', onPointerMove);
			element.removeEventListener('pointerleave', onPointerLeave);
		};
	});
</script>

<pre
	bind:this={pre}
	class="overflow-hidden text-right font-mono leading-none whitespace-pre text-stone-800 select-none [font-variant-ligatures:none] dark:text-stone-200 {className}"
	role="img"
	aria-label="Hansi the cat. Move your pointer nearby: a fly follows it, and Hansi tries to catch the fly.">{firstFrame}</pre>
