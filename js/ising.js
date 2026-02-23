// ising.js
document.addEventListener("DOMContentLoaded", () => {
    const parent = document.getElementById('background-body');
    if (!parent) return;
    parent.innerHTML = '';

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '-3';
    canvas.style.imageRendering = 'pixelated'; // Prevent bilinear smoothing for sharp clusters
    parent.appendChild(canvas);

    const L_MAX = 220;
    let cols, rows;
    let grid;
    let imgData;

    // 32-bit color variables and precomputed probabilities
    let colorUp32, colorDown32;
    let prob4, prob8;
    let currentT = 2.22;
    let mx = -1, my = -1;

    function colorToRGBA(colorStr) {
        const cvs = document.createElement('canvas');
        cvs.width = 1;
        cvs.height = 1;
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = colorStr;
        ctx.fillRect(0, 0, 1, 1);
        return ctx.getImageData(0, 0, 1, 1).data;
    }

    function getCssVar(name, fallback) {
        const val = getComputedStyle(document.body).getPropertyValue(name).trim();
        return val || fallback;
    }

    // Helper to pack RGBA into a single 32-bit integer (Little-Endian ABGR)
    function packColor(r, g, b, a) {
        return (a << 24) | (b << 16) | (g << 8) | r;
    }

    function updateColors() {
        const fgArr = colorToRGBA(getCssVar('--fg', '#ffffff'));
        const acArr = colorToRGBA(getCssVar('--ac', '#888888'));

        // Pack colors into 32-bit integers for ultra-fast rendering
        colorDown32 = packColor(0, 0, 0, 0);

        const alpha = parseInt(getCssVar('--ising-op', '25').trim(), 10);

        colorUp32 = packColor(
            Math.floor(fgArr[0] * 0.5 + acArr[0] * 0.5),
            Math.floor(fgArr[1] * 0.5 + acArr[1] * 0.5),
            Math.floor(fgArr[2] * 0.5 + acArr[2] * 0.5),
            alpha // dynamic opacity for light/dark contrast
        );

        const rawT = parseFloat(getCssVar('--ising-temp', '0.90'));
        currentT = rawT * (2.269 / 0.9);

        // Precompute the only two possible Boltzmann weights for the bulk dynamics
        prob4 = Math.exp(-4.0 / currentT);
        prob8 = Math.exp(-8.0 / currentT);
    }

    function resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const aspect = w / h;
        if (aspect > 1) {
            cols = L_MAX;
            rows = Math.max(1, Math.floor(L_MAX / aspect));
        } else {
            rows = L_MAX;
            cols = Math.max(1, Math.floor(L_MAX * aspect));
        }
        canvas.width = cols;
        canvas.height = rows;

        const total = (cols + 2) * (rows + 2);
        grid = new Int8Array(total);
        for (let i = 0; i < total; i++) {
            grid[i] = Math.random() < 0.5 ? 1 : -1;
        }
        imgData = new ImageData(cols, rows);
        updateColors();
    }

    const ctx = canvas.getContext('2d');
    window.addEventListener('resize', resize);
    resize();

    const observer = new MutationObserver(() => updateColors());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });

    document.addEventListener('mousemove', (e) => {
        mx = Math.floor((e.clientX / window.innerWidth) * cols) + 1;
        my = Math.floor((e.clientY / window.innerHeight) * rows) + 1;
    });

    document.addEventListener('mouseleave', () => {
        mx = -1; my = -1;
    });

    let lastTime = 0;
    const fps = 30;

    function step(timestamp) {
        requestAnimationFrame(step);

        if (timestamp - lastTime < 1000 / fps) return;
        lastTime = timestamp;

        // Increased to a full Monte Carlo sweep per frame for better physical evolution
        const mcSteps = Math.floor(cols * rows);
        const rowL = rows + 2;
        const colL = cols + 2;

        // Pre-calculate mouse bounding box to avoid math in the tight loop
        let mMinX = -1, mMaxX = -1, mMinY = -1, mMaxY = -1;
        const rSq = 100; // radius squared
        const r = 10;
        if (mx > 0) {
            mMinX = mx - r; mMaxX = mx + r;
            mMinY = my - r; mMaxY = my + r;
        }

        for (let s = 0; s < mcSteps; s++) {
            const x = 1 + Math.floor(Math.random() * cols);
            const y = 1 + Math.floor(Math.random() * rows);
            const idx = y * colL + x;

            let S = grid[idx];
            const sumNeighbors = grid[idx - 1] + grid[idx + 1] + grid[idx - colL] + grid[idx + colL];

            let dE = 2 * S * sumNeighbors;
            let flip = false;

            // Check if inside mouse bounding box first (computationally cheap)
            if (mx > 0 && x >= mMinX && x <= mMaxX && y >= mMinY && y <= mMaxY) {
                // Then check exact radius (computationally expensive)
                const dx = x - mx;
                const dy = y - my;
                if (dx * dx + dy * dy < rSq) {
                    // Recompute dE with the local magnetic field H = 1.5
                    dE = 2 * S * (sumNeighbors + 1.5);
                    if (dE <= 0 || Math.random() < Math.exp(-dE / currentT)) {
                        flip = true;
                    }
                } else {
                    // Bulk dynamics for spins inside the box but outside the circle
                    if (dE <= 0) {
                        flip = true;
                    } else if (dE === 4) {
                        if (Math.random() < prob4) flip = true;
                    } else if (dE === 8) {
                        if (Math.random() < prob8) flip = true;
                    }
                }
            } else {
                // BULK DYNAMICS: H = 0. Use precomputed lookup tables.
                if (dE <= 0) {
                    flip = true;
                } else if (dE === 4) {
                    if (Math.random() < prob4) flip = true;
                } else if (dE === 8) {
                    if (Math.random() < prob8) flip = true;
                }
            }

            if (flip) grid[idx] = -S;
        }

        // Boundary condition enforcement
        for (let x = 1; x <= cols; x++) {
            grid[0 * colL + x] = grid[rows * colL + x];
            grid[(rows + 1) * colL + x] = grid[1 * colL + x];
        }
        for (let y = 1; y <= rows; y++) {
            grid[y * colL + 0] = grid[y * colL + cols];
            grid[y * colL + (cols + 1)] = grid[y * colL + 1];
        }

        // 32-BIT RENDERING OPTIMIZATION
        // Create a 32-bit view of the underlying memory buffer
        const buf32 = new Uint32Array(imgData.data.buffer);
        let d = 0;

        for (let y = 1; y <= rows; y++) {
            let offset = y * colL + 1;
            for (let x = 1; x <= cols; x++) {
                // Write the entire pixel color in one assignment
                buf32[d++] = grid[offset++] > 0 ? colorUp32 : colorDown32;
            }
        }

        ctx.putImageData(imgData, 0, 0);
    }

    setTimeout(() => {
        updateColors();
        requestAnimationFrame(step);
    }, 100);
});