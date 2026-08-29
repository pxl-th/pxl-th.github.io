// Copies the SuperSplat viewer's static app out of node_modules and into
// public/viewer/, so Astro serves it (dev and build) as a self-contained
// sub-app that pages embed via an iframe.
//
// The viewer is a standalone static app, not a component: index.html reads
// URL params into window.sse, then imports and calls main() from index.js.
// Copying at build time rather than committing keeps the ~3 MB out of git and
// keeps public/viewer/ in sync with whatever version package.json pins.
//
// It also applies the patches below. The viewer hardcodes its orbit limits and
// has no setting or URL param for them, and CameraManager keeps its controllers
// private, so there is no runtime path to reach them. The package ships the app
// unminified and documents these files as strings "for templating", so patching
// during the copy is the supported extension route. Every patch asserts it
// matched exactly once, so a package bump fails the build loudly instead of
// silently reverting to unconstrained camera movement.
//
// Runs automatically via the predev/prebuild npm scripts.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@playcanvas', 'supersplat-viewer', 'public');
const dest = join(root, 'public', 'viewer');

// index.js.map is deliberately not copied: it is 6.3 MB, and index.js keeps its
// sourceMappingURL comment, so the only cost is a devtools-only 404.
const patch = (source, label, find, replace) => {
    const count = source.split(find).length - 1;
    if (count !== 1) {
        throw new Error(
            `copy-viewer: patch "${label}" matched ${count} times, expected 1.\n` +
            'The upstream source changed - re-check the patch against ' +
            'node_modules/@playcanvas/supersplat-viewer/public/ before releasing.'
        );
    }
    return source.replace(find, replace);
};

// --- index.js ---------------------------------------------------------------

let js = await readFile(join(src, 'index.js'), 'utf8');

// Orbit limits are hardcoded in src/cameras/orbit-controller.ts. Read them from
// window.sse.limits instead so each embed can set its own; yawRange is left
// untouched upstream (defaults to +/-Infinity), so only apply it when given.
js = patch(js, 'orbit limits',
    `        this.controller.zoomRange = new Vec2(0.01, Infinity);
        this.controller.pitchRange = new Vec2(-90, 90);`,
    `        const __limits = globalThis.sse?.limits ?? {};
        this.controller.zoomRange = new Vec2(...(__limits.zoom ?? [0.01, Infinity]));
        this.controller.pitchRange = new Vec2(...(__limits.pitch ?? [-90, 90]));
        if (__limits.yaw) this.controller.yawRange = new Vec2(...__limits.yaw);`);

// getAnimTrack always synthesises a track when settings.animTracks is empty, so
// hasAnimation is always true and the viewer starts in 'anim' mode with a
// play/pause button. Returning null suppresses that whole path.
js = patch(js, 'suppress auto anim track',
    '        const animTrack = getAnimTrack(resetCamera, isObjectExperience);',
    '        const animTrack = globalThis.sse?.limits?.noIntro ? null : getAnimTrack(resetCamera, isObjectExperience);');

// Without an anim track the viewer picks orbit only when the camera starts
// outside the scene bbox. Ours starts inside (the bbox spans the far-field
// splats), so it would fall through to fly - or to walk once collision data
// exists. Force orbit up front so the scene always opens on the saved pose.
// walkAllowed is in scope here and is already settled, because CameraManager is
// constructed after the collision data resolves - so walkOnly degrades to orbit
// on its own if the voxel files fail to load.
js = patch(js, 'force initial camera mode',
    `        state.cameraMode = state.hasAnimation ? 'anim' : (isObjectExperience ? 'orbit' : (walkAllowed ? 'walk' : 'fly'));`,
    `        state.cameraMode = (globalThis.sse?.limits?.walkOnly && walkAllowed) ? 'walk' : (globalThis.sse?.limits?.noIntro ? 'orbit' : (state.hasAnimation ? 'anim' : (isObjectExperience ? 'orbit' : (walkAllowed ? 'walk' : 'fly'))));`);

// Right-drag (and two-finger touch drag) slides the orbit centre sideways, which
// walks a product off its pedestal with no way back. These are the two places a
// drag turns into a pan - the mouse/touch source and the trackpad source - and
// neither is reachable from outside, so both get gated here. Pinch-to-zoom is
// unaffected: MultiTouchSource emits it as its own `pinch` delta, not as a pan.
js = patch(js, 'suppress mouse pan',
    '        const pan = this._buttons[2] || +(button[2] === -1) || +(touchCount > 1);',
    `        const pan = globalThis.sse?.limits?.noPan ? 0 :
            (this._buttons[2] || +(button[2] === -1) || +(touchCount > 1));`);

js = patch(js, 'suppress trackpad pan',
    `        else {
            this._pan[0] += deltaX;
            this._pan[1] += deltaY;
        }`,
    `        else if (!globalThis.sse?.limits?.noPan) {
            this._pan[0] += deltaX;
            this._pan[1] += deltaY;
        }`);

// Hand the orbit controller to the idle-turntable loop in index.html, which has
// no other route to it - CameraManager keeps its controllers private. That loop
// drives _targetRootPose, the same pose a drag moves, so the damping and the
// pitch/yaw limits set above apply to the automatic motion too.
js = patch(js, 'expose orbit controller',
    `        this.controller.zoomDamping = DEFAULT_CONTROLLER_DAMPING;
    }
    onEnter(camera) {`,
    `        this.controller.zoomDamping = DEFAULT_CONTROLLER_DAMPING;
        if (globalThis.sse?.limits?.autoOrbit) {
            globalThis.__sseOrbitController = this.controller;
        }
    }
    onEnter(camera) {`);

// The viewer applies settings.json's fov to the *longer* viewport axis, so the
// shorter one is always tighter than the saved framing - a cover fit, which
// crops. That is fine for a full-bleed landscape band, but a viewer that is
// taller than it is wide (a phone, or the product column once it stacks) then
// crops sideways and cuts the subject off. fitFov flips it to a contain fit:
// the fov goes on the shorter axis instead, so the saved framing is the
// tightest the subject ever gets and it stays whole at any aspect. applyCamera
// runs every frame, so this tracks live resizes as well.
js = patch(js, 'fit fov to the shorter axis',
    '            cameraEntity.camera.horizontalFov = graphicsDevice.width > graphicsDevice.height;',
    `            cameraEntity.camera.horizontalFov = globalThis.sse?.limits?.fitFov ?
                graphicsDevice.width < graphicsDevice.height :
                graphicsDevice.width > graphicsDevice.height;`);

// The walk rig - eye height, capsule, speeds, gravity - is hardcoded in metres
// in src/cameras/walk-controller.ts, so a scene whose world unit is not a metre
// walks like a child (or a giant). Every field is public, and this is the only
// place the instance is reachable, so scale the whole rig here from a `walk`
// block in settings.json (which importSettings passes through untouched):
//
//   "walk": { "scale": 1.6 }              scale the rig to the scene's units
//   "walk": { "scale": 1.6, "eyeHeight": 2.8 }   ... and override one field
//
// `scale` multiplies every length and speed. Gravity scales with them so a jump
// keeps its arc and its airtime; the fields are read off the instance rather
// than restated here, so upstream stays the source of truth for the defaults.
// No `walk` block leaves the metric rig exactly as shipped.
js = patch(js, 'walk rig scale',
    `        controllers.walk.collision = collision;
        const walkSource = new WalkSource();`,
    `        controllers.walk.collision = collision;
        const walkSource = new WalkSource();
        const __walk = settings.walk;
        if (__walk) {
            const __scale = __walk.scale ?? 1;
            for (const __key of [
                'capsuleHeight', 'capsuleRadius', 'eyeHeight', 'hoverHeight',
                'groundProbeRange', 'gravity', 'jumpSpeed', 'moveGroundSpeed',
                'moveAirSpeed'
            ]) {
                controllers.walk[__key] = __walk[__key] ?? controllers.walk[__key] * __scale;
            }
            walkSource.walkSpeed = __walk.walkSpeed ?? walkSource.walkSpeed * __scale;
            controllers.walk.bounds = __walk.bounds ?? null;
        }`);

// Nothing bounds walk mode: _step moves _position freely, so an open scene like
// a square lets you walk out past the reconstruction into the far-field mush
// and never come back. Collision data is no answer - a tighter --filter-box
// just removes the floor, so you fall through the edge instead of stopping at
// it. So clamp the walker to a box from settings.json:
//
//   "walk": { "bounds": [minX, minZ, maxX, maxZ] }
//
// In world units and in viewer space, the same space as the voxel json's
// gridBounds, so those are the outer limit worth using. Only x and z: y belongs
// to gravity and the ground probe. Clamping inside the substep loop rather than
// after it keeps _prevPosition and the render-rate lerp below consistent, and
// zeroing the velocity component on contact stops momentum building against the
// wall and lurching when you turn away. No `bounds` leaves movement unbounded.
js = patch(js, 'walk bounds',
    `                this._prevPosition.copy(this._position);
                this._step(FIXED_DT, moveStep);
                this._accumulator -= FIXED_DT;`,
    `                this._prevPosition.copy(this._position);
                this._step(FIXED_DT, moveStep);
                const __bounds = this.bounds;
                if (__bounds) {
                    const __x = Math.min(Math.max(this._position.x, __bounds[0]), __bounds[2]);
                    const __z = Math.min(Math.max(this._position.z, __bounds[1]), __bounds[3]);
                    if (__x !== this._position.x) {
                        this._position.x = __x;
                        this._velocity.x = 0;
                    }
                    if (__z !== this._position.z) {
                        this._position.z = __z;
                        this._velocity.z = 0;
                    }
                }
                this._accumulator -= FIXED_DT;`);

// Clicking the scene refocuses the orbit centre on the picked surface, which
// moves the camera in and wrecks a fixed composition. This handler is the one
// choke point for both routes into it (single click and double click), so
// blocking it here keeps the orbit centre pinned to settings.json's target.
js = patch(js, 'suppress click-to-refocus',
    `        events.on('pick', (position) => {
            // switch to orbit camera on pick
            state.cameraMode = 'orbit';`,
    `        events.on('pick', (position) => {
            if (globalThis.sse?.limits?.pinMode) return;
            // switch to orbit camera on pick
            state.cameraMode = 'orbit';`);

// The viewer hardcodes the unified gsplat path, which re-encodes every splat
// into a shared work buffer and drives it through the LOD director. That
// re-encode quantises colour, rotation and scale, and the path culls every
// splat under a 2px screen radius before the rasterizer sees it, so a scene
// renders soft and z-fights along surfaces however good the source file is -
// feeding it a .ply rather than a .sog changes nothing, because the loss is
// downstream of the parser. The SuperSplat editor renders the same files
// through the classic path instead - a GSplatInstance with its own material and
// its own sorter, reading the resource textures directly - which is why a .sog
// that looks wrong here looks right there.
//
// The component supports both; only the viewer's choice is fixed. The classic
// path also sorts by planar depth unconditionally (its worker keys on
// x*dx + y*dy + z*dz), which is the order the scene was trained in.
js = patch(js, 'classic gsplat path',
    `            entity.addComponent('gsplat', {
                unified: true,
                asset
            });`,
    `            entity.addComponent('gsplat', {
                unified: !globalThis.sse?.limits?.classic,
                asset
            });`);

// Two things the classic path needs that only the unified path sets up.
//
// Culling: GSplatInstance draws the whole splat set as instances of one shared
// quad, so the mesh instance's own aabb is meaningless, and `set instance`
// hands setCustomAabb the raw _customAabb field - null unless a caller filled
// it in, which the viewer never does because the unified path takes its bounds
// from _placement.aabb instead. The mesh instance therefore fails _isVisible,
// which deadlocks it: cullComposition only pushes a camera onto
// gsplatInstance.cameras for draw calls that pass, and without a camera the
// sorter never runs, so instancingCount stays 0 and nothing is ever drawn.
// resource.aabb is what the component's own customAabb getter falls back to, so
// handing it to the mesh instance is the fix the accessor already implies. It
// is a loose bound - a handful of outlier gaussians put its centre 1.1M units
// out with 1.9M half-extents - which costs nothing here: the draw call is the
// whole scene and always in view, so it should never be culled anyway.
//
// The instance exists by now - addComponent runs _onGSplatAssetLoad
// synchronously when the asset already carries its resource, which it does.
js = patch(js, 'classic path instance fixups',
    `            app.root.addChild(entity);
            resolve(entity);`,
    `            if (globalThis.sse?.limits?.classic) {
                const __mi = entity.gsplat.instance?.meshInstance;
                if (__mi) {
                    __mi.setCustomAabb(entity.gsplat.resource?.aabb ?? null);
                }
            }
            app.root.addChild(entity);
            resolve(entity);`);

// frame:ready is fired by the unified director alone, and the viewer hangs its
// whole reveal on it: hiding the loading screen, dropping to on-demand
// rendering, and applying the perf settings. On the classic path it never
// fires, so the scene would load and then sit behind the loading bar forever.
//
// The reveal is reinstated directly instead. Everything else readyHandler does
// is unified-only and simply does not apply: applyPerfSettings writes to
// app.scene.gsplat (budget, LOD range, work-buffer culls) which the classic
// instance never reads, and gsplat.renderer selects between the unified GPU and
// CPU sorters where the classic path always uses its own. app.autoRender is
// left at the true it was given at startup, because frame:request is likewise
// a unified signal - the classic path just renders every frame.
js = patch(js, 'classic path reveal',
    `            eventHandler.on('frame:ready', readyHandler);`,
    `            if (globalThis.sse?.limits?.classic) {
                app.once('frameend', () => {
                    events.fire('firstFrame');
                    window.firstFrame?.();
                });
            } else {
                eventHandler.on('frame:ready', readyHandler);
            }`);

// --- index.html -------------------------------------------------------------

let html = await readFile(join(src, 'index.html'), 'utf8');

// Parse the limits out of the URL alongside the viewer's own params.
html = patch(html, 'parse limit params',
    `            window.sse = {
                config: sseConfig,
                settings: fetch(settingsUrl).then(response => response.json())
            };`,
    `            // Camera limits, read by the patched orbit controller.
            const parseRange = (name) => {
                const value = url.searchParams.get(name);
                if (!value) return undefined;
                const parts = value.split(',').map(Number);
                return parts.length === 2 && parts.every(n => !isNaN(n)) ? parts : undefined;
            };

            // orbitOnly / walkOnly pin the camera to one mode and hide the mode
            // switcher; noIntro only skips the generated fly-around and opens
            // on the saved pose, leaving every mode reachable. Both *Only
            // flags imply noIntro.
            const orbitOnly = url.searchParams.has('orbitOnly');
            const walkOnly = url.searchParams.has('walkOnly');
            const noPan = url.searchParams.has('noPan');
            const fitFov = url.searchParams.has('fitFov');
            const noControls = url.searchParams.has('noControls');
            // Undo the viewer's quality-for-speed trades: an exact work buffer
            // and no per-frame culling. Costs fill rate and bandwidth, so it is
            // opt-in per embed. See the two 'high quality' patches above.
            // Render through the classic per-splat path rather than the
            // unified work buffer - what the SuperSplat editor does.
            const classic = url.searchParams.has('classic');
            const autoOrbit = Number(url.searchParams.get('autoOrbit')) || 0;
            const autoOrbitDelay = Number(url.searchParams.get('autoOrbitDelay')) || 3000;
            const pinMode = orbitOnly ? 'orbit' : (walkOnly ? 'walk' : null);
            const noIntro = !!pinMode || url.searchParams.has('noIntro');
            if (pinMode) {
                document.documentElement.classList.add('mode-locked');
            }
            if (noControls) {
                document.documentElement.classList.add('no-controls');
            }

            window.sse = {
                config: sseConfig,
                settings: fetch(settingsUrl).then(response => response.json()),
                limits: {
                    pitch: parseRange('pitch'),
                    yaw: parseRange('yaw'),
                    zoom: parseRange('zoom'),
                    orbitOnly,
                    walkOnly,
                    noPan,
                    fitFov,
                    noControls,
                    classic,
                    autoOrbit,
                    autoOrbitDelay,
                    pinMode,
                    noIntro
                }
            };`);

// Idle turntable. Deliberately not the viewer's own rotate track: that is a
// camera *mode* ('anim'), so it fights the pinned mode above and a single touch
// ends it for good. Nudging the orbit target instead means the automatic motion
// and a drag are the same operation, so handing over in either direction needs
// no state - the drag simply outruns the nudge, and the nudge resumes when the
// drag stops. Must run before the 'pin camera mode' patch below, which rewrites
// the main() line this one anchors on.
html = patch(html, 'idle auto-orbit',
    `                const viewer = await main(canvas, settingsJson, config);
            });`,
    `                const viewer = await main(canvas, settingsJson, config);

                if (window.sse.limits.autoOrbit) {
                    const { autoOrbit, autoOrbitDelay } = window.sse.limits;
                    let last = performance.now();
                    let resumeAt = last + autoOrbitDelay;

                    // A bare pointermove is not interaction - without the
                    // buttons test, a cursor left resting over the canvas would
                    // stall the turntable for as long as it sat there.
                    const bump = (event) => {
                        if (event.type === 'pointermove' && !event.buttons) return;
                        resumeAt = performance.now() + autoOrbitDelay;
                    };
                    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'touchstart', 'touchmove', 'keydown']) {
                        window.addEventListener(type, bump, { passive: true, capture: true });
                    }

                    // requestAnimationFrame rather than a timer so the spin
                    // stops paying for itself while the tab is in the
                    // background, and stays smooth when it is not.
                    const spin = (now) => {
                        const dt = Math.min(0.1, (now - last) / 1000);
                        last = now;
                        const controller = globalThis.__sseOrbitController;
                        if (controller && now >= resumeAt) {
                            controller._targetRootPose.rotate({ x: 0, y: autoOrbit * dt, z: 0 });
                        }
                        requestAnimationFrame(spin);
                    };
                    requestAnimationFrame(spin);
                }
            });`);

// Mode can still be changed by keyboard shortcut and by picking in the scene.
// One guard on the state change catches every route, rather than patching each
// call site in camera-manager.
html = patch(html, 'pin camera mode',
    '                const viewer = await main(canvas, settingsJson, config);',
    `                const viewer = await main(canvas, settingsJson, config);

                if (window.sse.limits.pinMode) {
                    const { state, events } = viewer.global;
                    events.on('cameraMode:changed', (value) => {
                        // Resolved per event, not up front: walkAllowed is only
                        // known once the collision data has loaded.
                        const pinned = window.sse.limits.pinMode;
                        const target = (pinned === 'walk' && !state.walkAllowed) ? 'orbit' : pinned;
                        if (value !== target) {
                            state.cameraMode = target;
                        }
                    });
                }`);

// Hide the orbit/fly/walk switcher. The :has() rule drops the whole group so no
// empty flex gap is left behind; the id rules are the fallback without :has().
//
// no-controls goes further and drops the whole overlay: the button bar and both
// panels it opens. These are toggled by adding and removing a `hidden` class,
// never inline styles, so a plain display:none here always wins. The loading
// bar is left alone - it is progress, not a control.
html = patch(html, 'hide chrome',
    '        <link rel="stylesheet" href="./index.css">',
    `        <link rel="stylesheet" href="./index.css">
        <style>
            html.mode-locked #orbitCamera,
            html.mode-locked #flyCamera,
            html.mode-locked #fpsCamera { display: none; }
            html.mode-locked .buttonGroup:has(#orbitCamera) { display: none; }

            html.no-controls #controlsWrap,
            html.no-controls #infoPanel,
            html.no-controls #settingsPanel,
            html.no-controls #walkHint { display: none; }
        </style>`);

// --- write ------------------------------------------------------------------

await mkdir(dest, { recursive: true });
await Promise.all([
    writeFile(join(dest, 'index.js'), js),
    writeFile(join(dest, 'index.html'), html),
    writeFile(join(dest, 'index.css'), await readFile(join(src, 'index.css')))
]);

console.log('copied 3 viewer files to public/viewer/ (17 patches applied)');
