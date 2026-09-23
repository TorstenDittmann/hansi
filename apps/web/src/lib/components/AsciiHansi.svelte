<script lang="ts">
	import { onMount } from 'svelte';
	import {
		canReach,
		cellToWorld,
		DEFAULT_LAYOUT,
		idleScene,
		layoutFor,
		pawPosition,
		render,
		ROWS,
		type Layout,
		type Scene,
		type Vec
	} from '$lib/hansi/engine';

	// Hansi the cat, on a canvas as wide as its container. A fly follows the pointer across the
	// canvas; when it comes within reach, the cat stalks it and swipes. Left alone, the cat does
	// cat things: twitches an ear, blinks slowly, looks around, yawns, grooms a paw.
	let { class: className = '' } = $props();

	/** How long the cat stalks a fly in reach before swiping (random in this range). */
	const STALK_SECONDS: [number, number] = [1.2, 2.2];
	/** A whole swipe: paw raised, strike, hold, and drawn back (see swipeReach). */
	const SWIPE_SECONDS = 1.4;
	const MISS_COOLDOWN_SECONDS = 1.6;
	const CELEBRATE_SECONDS = 1.8;
	const RESPAWN_SECONDS = 2.4;
	const CATCH_DISTANCE = 6;
	/** Fly motion, in world units (a character cell is 1.2 wide): spring stiffness, damping, top speed. */
	const FLY_PULL = 45;
	const FLY_DAMPING = 9;
	const FLY_MAX_SPEED = 150;

	const MISS_PUZZLE_SECONDS = 1.3;
	/** Idle behaviors: how often each is picked, and how long it takes. */
	const IDLE_ACTIONS = [
		{ kind: 'twitch', weight: 0.35, seconds: 0.45 },
		{ kind: 'slowBlink', weight: 0.25, seconds: 1.4 },
		{ kind: 'lookAround', weight: 0.15, seconds: 2.2 },
		{ kind: 'yawn', weight: 0.12, seconds: 2.4 },
		{ kind: 'groom', weight: 0.13, seconds: 3.6 }
	] as const;
	type IdleAction = {
		kind: (typeof IDLE_ACTIONS)[number]['kind'];
		start: number;
		seconds: number;
		side: 0 | 1;
	};

	let ink: HTMLPreElement | undefined = $state();
	let fur: HTMLPreElement | undefined = $state();
	let flyPre: HTMLPreElement | undefined = $state();

	// Server-rendered first frame at the default width; lines are right-aligned, so the cat sits
	// where the full-width canvas will draw the cat.
	const firstFrame = render(idleScene(0), DEFAULT_LAYOUT);

	onMount(() => {
		const element = ink!;
		const furElement = fur!;
		const flyElement = flyPre!;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		const random = (range: [number, number]) => range[0] + Math.random() * (range[1] - range[0]);

		let pointer: Vec | null = null;
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
		let missedAt = -10;
		let action: IdleAction | null = null;
		let nextAction = 3 + Math.random() * 3;
		/** When the pointer last moved, to notice a fly holding still. */
		let pointerMovedAt = 0;
		let tilt = 0;
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
			pointerMovedAt = performance.now();
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
			if (pointer) {
				// A tight, jittery orbit around the pointer.
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
			// A soft, slightly underdamped spring: the fly trails a moving pointer, catches up when it
			// stops, and overshoots a little before settling into its orbit. It has a top speed, so a
			// fast pointer leaves it behind for a moment.
			fly.v.x += ((desired.x - fly.p.x) * FLY_PULL - fly.v.x * FLY_DAMPING) * dt;
			fly.v.y += ((desired.y - fly.p.y) * FLY_PULL - fly.v.y * FLY_DAMPING) * dt;
			const speed = Math.hypot(fly.v.x, fly.v.y);
			if (speed > FLY_MAX_SPEED) {
				fly.v.x *= FLY_MAX_SPEED / speed;
				fly.v.y *= FLY_MAX_SPEED / speed;
			}
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
					// Still a fly around after the swipe: it got away. Look at the paw, puzzled.
					if (fly) missedAt = time;
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

			// Idle behaviors, one at a time. A fly or a swipe interrupts the ones that need calm.
			const busy = !!target || swipeStart >= 0 || celebrating;
			if (action && (time > action.start + action.seconds || (busy && action.kind !== 'twitch'))) {
				action = null;
				nextAction = time + 2.5 + Math.random() * 3.5;
			}
			if (!action && time > nextAction) {
				const options = busy ? IDLE_ACTIONS.filter((a) => a.kind === 'twitch') : IDLE_ACTIONS;
				let pick = Math.random() * options.reduce((sum, a) => sum + a.weight, 0);
				const chosen = options.find((a) => (pick -= a.weight) <= 0) ?? options[0]!;
				action = {
					kind: chosen.kind,
					start: time,
					seconds: chosen.seconds,
					side: Math.random() < 0.5 ? 0 : 1
				};
			}
			const progress = action ? (time - action.start) / action.seconds : 0;
			const doing = (kind: IdleAction['kind']) => action?.kind === kind;
			// Up quickly, down slowly: a flick.
			const flick = progress < 0.3 ? progress / 0.3 : 1 - (progress - 0.3) / 0.7;
			const swell = Math.sin(Math.PI * Math.min(progress, 1));

			// Head tilt: while looking around, or at a fly that holds still out of reach.
			const flyStill = !!target && performance.now() - pointerMovedAt > 700 && stalk < 0.2;
			const tiltGoal = doing('lookAround')
				? swell * (action!.side ? 0.12 : -0.12)
				: flyStill
					? Math.sign(target!.x || 1) * 0.1
					: 0;
			tilt = approach(tilt, tiltGoal, 5);

			const puzzled = time < missedAt + MISS_PUZZLE_SECONDS && !celebrating;
			const ears: [number, number] = puzzled
				? [0.35, 0.35]
				: doing('twitch')
					? action!.side
						? [0, flick]
						: [flick, 0]
					: doing('yawn')
						? [0.4 * swell, 0.4 * swell]
						: [0, 0];
			const lickingLips = celebrating && time > celebrateUntil - CELEBRATE_SECONDS + 0.8;

			const scene: Scene = {
				...idleScene(time),
				target: puzzled ? { x: 8, y: 30 } : target,
				fly: target,
				trail: target ? trail : [],
				swipe,
				swipeTarget: swipeAim,
				crouch,
				tailPhase,
				tailEnergy,
				eyes: celebrating
					? 'happy'
					: doing('yawn') ||
						  doing('groom') ||
						  (doing('slowBlink') && progress > 0.2 && progress < 0.8)
						? 'closed'
						: time < blinkUntil
							? 'blink'
							: 'open',
				mouth: lickingLips
					? 'lick'
					: celebrating
						? 'happy'
						: doing('yawn') && progress > 0.15 && progress < 0.85
							? 'yawn'
							: 'rest',
				tilt,
				ears,
				// The wiggle before a pounce, once the crouch is deep.
				wiggle: stalk > 0 && crouch > 0.5 ? Math.sin(time * 16) * (crouch - 0.5) * 2 : 0,
				groom: doing('groom') ? Math.max(progress, 0.001) : 0,
				puzzled
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

			const frameText = render(scene, layout);
			element.textContent = frameText.ink;
			furElement.textContent = frameText.fur;
			flyElement.textContent = frameText.fly;
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

<!-- Three layers of the same size: orange fur shading, the cat's lines and face, and the fly. -->
<div
	class="relative font-mono leading-none whitespace-pre select-none [font-variant-ligatures:none] {className}"
	role="img"
	aria-label="Hansi the cat. Move your pointer nearby: a fly follows it, and Hansi tries to catch the fly."
>
	<pre
		bind:this={fur}
		class="absolute inset-0 overflow-hidden text-right text-orange-400 dark:text-orange-500/70"
		aria-hidden="true">{firstFrame.fur}</pre>
	<pre
		bind:this={ink}
		class="relative overflow-hidden text-right text-orange-800 dark:text-orange-300"
		aria-hidden="true">{firstFrame.ink}</pre>
	<pre
		bind:this={flyPre}
		class="absolute inset-0 overflow-hidden text-right text-stone-800 dark:text-stone-200"
		aria-hidden="true">{firstFrame.fly}</pre>
</div>
