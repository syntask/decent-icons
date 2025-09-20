// available icons loaded from icons.json
let availableIcons = [];
// observer for lazy-loading thumbnails
let lazyObserver = null;
// icon-loading state + promise cache
let iconsLoaded = false;
let iconsLoadPromise = null;

// Ensure icons.json is fetched once and the grid wired. Returns a Promise.
function ensureIconsLoaded() {
    if (iconsLoaded) return Promise.resolve();
    if (iconsLoadPromise) return iconsLoadPromise;
    const searchInput = document.getElementById('icon-search');
    iconsLoadPromise = fetch('assets/bootstrap-icons/icons.json')
        .then(res => res.ok ? res.json() : Promise.reject(new Error(`Failed to load icons.json: ${res.status}`)))
        .then(data => {
            availableIcons = Array.isArray(data.icons) ? data.icons : [];
            iconsLoaded = true;
            // initial render with current query (if any)
            renderIconGrid(searchInput?.value || '');
            // wire live filtering (debounced) now that icons are available
            if (searchInput) {
                let searchDebounce = null;
                searchInput.addEventListener('input', (e) => {
                    clearTimeout(searchDebounce);
                    searchDebounce = setTimeout(() => renderIconGrid(e.target.value), 120);
                });
            }
        })
        .catch(err => {
            console.error(err);
        })
        .finally(() => {
            iconsLoadPromise = null;
        });
    return iconsLoadPromise;
}

// load SVG into a thumbnail element (idempotent)
// throttled with a small concurrency queue to avoid spamming network on selector open
const MAX_CONCURRENT_ICON_LOADS = 6;
let activeIconLoads = 0;
const iconLoadQueue = [];

function processIconQueue() {
    if (activeIconLoads >= MAX_CONCURRENT_ICON_LOADS) return;
    const job = iconLoadQueue.shift();
    if (!job) return;
    activeIconLoads++;
    const { el, url } = job;
    fetch(url)
        .then(res => res.ok ? res.text() : Promise.reject(new Error('not found')))
        .then(svg => {
            const svgContainer = el.querySelector('.icon-svg') || el;
            svgContainer.innerHTML = svg;
            el.dataset.loaded = 'true';
        })
        .catch(() => {
            el.dataset.loaded = 'error';
            const svgContainer = el.querySelector('.icon-svg') || el;
            if (svgContainer) svgContainer.innerHTML = '';
        })
        .finally(() => {
            activeIconLoads--;
            // schedule next job without blocking
            setTimeout(processIconQueue, 0);
        });
}

function enqueueIconLoad(el, iconName) {
    if (!el) return;
    if (el.dataset.loaded === 'true' || el.dataset.loaded === 'loading') return;
    const url = `assets/bootstrap-icons/${iconName}.svg`;
    el.dataset.loaded = 'loading'; // reserve the slot
    iconLoadQueue.push({ el, url });
    // try to process immediately if under limit
    setTimeout(processIconQueue, 0);
}

// Backwards-compat wrapper kept name for other callers
function loadSvgIntoDiv(el, iconName) {
    enqueueIconLoad(el, iconName);
}


// Build the icon grid (filtered by `filter` substring) and observe thumbnails
function renderIconGrid(filter = '') {
    const iconList = document.getElementById('icon-list');
    // disconnect previous observer to avoid stale entries
    if (lazyObserver) {
        lazyObserver.disconnect();
        lazyObserver = null;
    }
    iconList.innerHTML = '';
    const q = (filter || '').toLowerCase();
    const filtered = availableIcons.filter(name => name.toLowerCase().includes(q));

    if (filtered.length === 0) {
        const hint = document.createElement('div');
        hint.style.padding = '12px';
        hint.style.gridColumn = '1 / -1';
        hint.style.color = 'var(--foreground-color)';
        hint.style.opacity = '0.6';
        hint.textContent = 'No matches';
        iconList.appendChild(hint);
        return;
    }

    // create a root-aware observer so we load thumbnails as they scroll into the icon-list viewport
    // tightened rootMargin so we don't pre-load many offscreen icons
    lazyObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const name = el.dataset.iconName;
                if (name) {
                    // enqueue load (throttled)
                    enqueueIconLoad(el, name);
                }
                lazyObserver.unobserve(el);
            }
        });
    }, { root: iconList, rootMargin: '100px', threshold: 0.01 });

    // Render items in small chunks to avoid blocking the main thread when there are thousands.
    const CHUNK_SIZE = 150;
    let index = 0;

    const renderChunk = (deadline) => {
        const start = performance.now();
        while (index < filtered.length) {
            const icon = filtered[index++];
            const iconDiv = document.createElement('div');
            iconDiv.className = 'icon-thumb';
            iconDiv.title = icon;
            iconDiv.dataset.iconName = icon;
            const svgWrap = document.createElement('div');
            svgWrap.className = 'icon-svg';
            svgWrap.innerHTML = '';
            const label = document.createElement('span');
            label.className = 'icon-label';
            label.textContent = icon;
            iconDiv.appendChild(svgWrap);
            iconDiv.appendChild(label);

            iconDiv.addEventListener('click', () => {
                currentIcon = icon;
                Array.from(iconList.children).forEach(c => c.classList.remove('selected'));
                iconDiv.classList.add('selected');
                // ensure thumbnail is queued/loaded so selection shows a glyph
                loadSvgIntoDiv(iconDiv, icon);
                // update preview on the selector button
                loadSvgPreview(selectIconBtn, currentIcon);
                // close the icon selector panel
                closePopup(iconSelector, selectIconBtn);
                renderIcon(currentIcon);
            });

            // mark initial selection if this matches currentIcon
            if (icon === currentIcon) {
                iconDiv.classList.add('selected');
                // queue immediate load for the selected thumbnail
                enqueueIconLoad(iconDiv, icon);
            }

            iconList.appendChild(iconDiv);
            lazyObserver.observe(iconDiv);

            // break out of the loop periodically to keep UI responsive
            if ((performance.now() - start) > 10) break;
            // also stop if we've added a chunk
            if ((index % CHUNK_SIZE) === 0) break;
        }

        if (index < filtered.length) {
            // schedule next chunk using requestIdleCallback when available, else setTimeout
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(renderChunk, { timeout: 200 });
            } else {
                setTimeout(() => renderChunk(), 16);
            }
        }
    };

    // start chunked rendering
    renderChunk();
}

// load icons once and wire search input
document.addEventListener('DOMContentLoaded', () => {
    // don't load icons.json on initial page load — defer until user opens the selector
    // search input and icon loading will be wired when ensureIconsLoaded() runs.

    // Now that the DOM is parsed, get the fullscreen popup and wire its close button
    iconSelector = document.getElementById('icon-selector');
    const iconSelectorClose = document.getElementById('icon-selector-close');
    if (iconSelectorClose) {
        iconSelectorClose.addEventListener('click', (ev) => {
            ev.stopPropagation();
            closePopup(iconSelector, selectIconBtn);
        });
    }
});

// Map 'bi-emoji-heart-eyes' -> 'emoji-heart-eyes.svg'
function iconClassToFilename(iconClass) {
    return (iconClass || '').trim() + '.svg';
}

// Fetch an SVG file as text from your assets dir
async function fetchIconSvg(iconClass) {
    const file = iconClassToFilename(iconClass);
    const url = `assets/bootstrap-icons/${file}`;
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.text();
}

// Parse the incoming SVG, extract drawable shapes (paths, polygons, etc.)
function extractShapes(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');

    // Use viewBox if present (Bootstrap Icons = "0 0 16 16")
    const srcSvg = doc.querySelector('svg');
    const srcViewBox = srcSvg?.getAttribute('viewBox') || '0 0 16 16';

    // Collect supported shape elements
    const shapeSelectors = ['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline'];
    const shapes = [];
    shapeSelectors.forEach(sel => {
        doc.querySelectorAll(sel).forEach(el => {
            // clone and strip authoring fills/strokes so our styling takes over
            const clone = el.cloneNode(true);
            clone.removeAttribute('fill');
            clone.removeAttribute('stroke');
            clone.removeAttribute('class');
            shapes.push(clone);
        });
    });

    return { shapes, srcViewBox };
}

// Color conversion utility functions
function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    const bigint = parseInt(hex, 16);
    return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255
    };
}

function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Adjust brightness of a color (positive = lighter, negative = darker)
function adjustBrightness(hex, percent) {
    const rgb = hexToRgb(hex);
    const factor = 1 + percent / 100;

    return rgbToHex(
        Math.min(255, Math.round(rgb.r * factor)),
        Math.min(255, Math.round(rgb.g * factor)),
        Math.min(255, Math.round(rgb.b * factor))
    );
}

// Build the styled, mask-based inside-stroke SVG using your gradients
// final parameter bgRadius expects a fraction (0..1), default 0.25 to keep previous behavior
function buildStyledSvg(shapes, srcViewBox = '0 0 16 16', backgroundColor = '#2196F3', glyphSize = 66, glyphAngle = 0, bgStyle = 'gradient', glyphStyle = 'glass', glyphColor = '#FFFFFF', bgRadius = 0.25) {
    // Calculate lighter and darker variants for gradient
    const lighterColor = adjustBrightness(backgroundColor, 15);
    const darkerColor = adjustBrightness(backgroundColor, -15);

    // Parse source viewBox (usually "0 0 16 16")
    const vbParts = srcViewBox.split(/\s+/).map(Number);
    const [minX, minY, vbW, vbH] = vbParts.length === 4 ? vbParts : [0, 0, 16, 16];
    const pad = 2;
    const paddedVB = `${minX - pad} ${minY - pad} ${vbW + pad * 2} ${vbH + pad * 2}`;

    // compute center and angle early so we can adjust gradient transforms
    const centerX = minX + (vbW / 2);
    const centerY = minY + (vbH / 2);
    const angle = (glyphAngle || 0) % 360;

    // Build <svg> root
    const svgNS = 'http://www.w3.org/2000/svg';
    const xlinkNS = 'http://www.w3.org/1999/xlink';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('id', 'icon-root');
    svg.setAttribute('xmlns', svgNS);
    svg.setAttribute('xmlns:xlink', xlinkNS);
    svg.setAttribute('viewBox', paddedVB);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // <defs> with gradients + mask
    const defs = document.createElementNS(svgNS, 'defs');
    svg.appendChild(defs);

    // Create gradients using DOM methods and userSpaceOnUse for consistent behaviour
    const createGradient = (id, x1, y1, x2, y2, stops) => {
        const gradient = document.createElementNS(svgNS, 'linearGradient');
        gradient.setAttribute('id', id);
        // use userSpaceOnUse so gradients line up in the same coordinate space as the viewBox
        gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
        gradient.setAttribute('x1', x1);
        gradient.setAttribute('y1', y1);
        gradient.setAttribute('x2', x2);
        gradient.setAttribute('y2', y2);

        stops.forEach(stop => {
            const stopEl = document.createElementNS(svgNS, 'stop');
            stopEl.setAttribute('offset', stop.offset);
            stopEl.setAttribute('stop-color', stop.color);
            if (stop.opacity !== undefined) {
                stopEl.setAttribute('stop-opacity', stop.opacity);
            }
            gradient.appendChild(stopEl);
        });

        return gradient;
    };

    // Background gradient (top -> bottom) in user space (padded box)
    const padX = minX - pad;
    const padY = minY - pad;
    const padW = vbW + pad * 2;
    const padH = vbH + pad * 2;

    // Create the standard gradient (used by 'gradient' style)
    defs.appendChild(createGradient(
        'backgroundGradient',
        padX, padY,
        padX, padY + padH,
        [
            { offset: '0%', color: lighterColor },
            { offset: '100%', color: darkerColor }
        ]
    ));

    // Glyph styling depends on glyphStyle
    // glass: subtle top->bottom fade using glyphColor + white diag outline (current behavior)
    // gradient: top->bottom gradient derived from glyphColor (lighter->darker); NO diagOutline
    // flat: solid glyphColor fill; NO diagOutline

    if (glyphStyle === 'glass') {
        const fade = createGradient(
            'fadeFill',
            padX, padY + padH, // bottom
            padX, padY,        // top
            [
                { offset: '0%', color: glyphColor, opacity: '0.75' },
                { offset: '100%', color: glyphColor, opacity: '0.95' }
            ]
        );
        fade.setAttribute('gradientTransform', `rotate(${-angle} ${centerX} ${centerY})`);
        defs.appendChild(fade);

        // diag outline (white) for glass
        const diag = createGradient(
            'diagOutline',
            padX, padY,
            padX + padW, padY + padH,
            [
                { offset: '0%', color: 'white', opacity: '0.95' },
                { offset: '20%', color: 'white', opacity: '0.95' },
                { offset: '40%', color: 'white', opacity: '0' },
                { offset: '60%', color: 'white', opacity: '0' },
                { offset: '80%', color: 'white', opacity: '0.65' },
                { offset: '100%', color: 'white', opacity: '0.65' }
            ]
        );
        diag.setAttribute('gradientTransform', `rotate(${-angle} ${centerX} ${centerY})`);
        defs.appendChild(diag);
    } else if (glyphStyle === 'gradient') {
        // create a glyphGradient top->bottom from lighter to darker of glyphColor
        const glyphLighter = adjustBrightness(glyphColor, 15);
        const glyphDarker = adjustBrightness(glyphColor, -15);
        const glyphGrad = createGradient(
            'glyphGradient',
            padX, padY,
            padX, padY + padH,
            [
                { offset: '0%', color: glyphLighter },
                { offset: '100%', color: glyphDarker }
            ]
        );
        // counter-rotate so gradient stays visually fixed when glyph rotates
        glyphGrad.setAttribute('gradientTransform', `rotate(${-angle} ${centerX} ${centerY})`);
        defs.appendChild(glyphGrad);
        // no diagOutline
    } else { // flat
        // flat: no fadeFill, no diagOutline — will apply solid color when rendering fillUse
    }

    // Create iconShape group with sizing transform
    const iconShapeId = 'iconShape';
    const iconShape = document.createElementNS(svgNS, 'g');
    iconShape.setAttribute('id', iconShapeId);

    // compute transform so 100% fills the padded viewBox (compensates for padding)
    const scale = (glyphSize / 100) * ((vbW + pad * 2) / vbW);
    // use the centerX/centerY/angle computed earlier (do not redeclare)
    const transform = `translate(${centerX} ${centerY}) rotate(${angle}) scale(${scale}) translate(${-centerX} ${-centerY})`;
    iconShape.setAttribute('transform', transform);

    shapes.forEach(s => iconShape.appendChild(s.cloneNode(true)));
    defs.appendChild(iconShape);

    // Create mask and ensure mask geometry receives same transform so alignment stays exact
    const mask = document.createElementNS(svgNS, 'mask');
    mask.setAttribute('id', 'innerStrokeMask');
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
    mask.setAttribute('x', `${padX}`);
    mask.setAttribute('y', `${padY}`);
    mask.setAttribute('width', `${padW}`);
    mask.setAttribute('height', `${padH}`);

    const maskShapes = document.createElementNS(svgNS, 'g');
    maskShapes.setAttribute('id', 'maskShapes');
    maskShapes.setAttribute('fill', 'white');
    // apply the same transform used for iconShape so mask aligns perfectly
    maskShapes.setAttribute('transform', transform);

    shapes.forEach(s => {
        const c = s.cloneNode(true);
        c.setAttribute('fill', 'white');
        c.removeAttribute('stroke');
        maskShapes.appendChild(c);
    });

    mask.appendChild(maskShapes);
    defs.appendChild(mask);

    // Background rounded rectangle: behavior depends on bgStyle
    if (bgStyle !== 'none') {
        const bgRect = document.createElementNS(svgNS, 'rect');
        bgRect.setAttribute('x', `${padX}`);
        bgRect.setAttribute('y', `${padY}`);
        bgRect.setAttribute('width', `${padW}`);
        bgRect.setAttribute('height', `${padH}`);
        // use bgRadius (fraction 0..1) so slider controls corner rounding
        bgRect.setAttribute('rx', `${padW * bgRadius}`);
        bgRect.setAttribute('ry', `${padH * bgRadius}`);

        if (bgStyle === 'flat') {
            // solid fill using the chosen color (no extra adjustments)
            bgRect.setAttribute('fill', backgroundColor);
        } else if (bgStyle === 'gradient') {
            bgRect.setAttribute('fill', 'url(#backgroundGradient)');
        } else {
            // fallback (covers unexpected values) -> gradient
            bgRect.setAttribute('fill', 'url(#backgroundGradient)');
        }

        svg.appendChild(bgRect);
    }

    // Inside-aligned stroke for all shapes (mask keeps inner half)
    const maskedGroup = document.createElementNS(svgNS, 'g');
    maskedGroup.setAttribute('mask', 'url(#innerStrokeMask)');

    const strokeUse = document.createElementNS(svgNS, 'use');
    strokeUse.setAttributeNS(xlinkNS, 'xlink:href', `#${iconShapeId}`);
    strokeUse.setAttribute('fill', 'none');
    strokeUse.setAttribute('stroke', 'url(#diagOutline)');
    // compute stroke width relative to padded viewBox so it looks consistent after scaling
    const strokeWidth = (padW / 16 * 0.6);
    strokeUse.setAttribute('stroke-width', strokeWidth.toString());
    strokeUse.setAttribute('stroke-linejoin', 'round');
    strokeUse.setAttribute('stroke-linecap', 'round');
    // remove vector-effect: allow stroke to scale with the glyph transform to avoid gradient artifacts
    // strokeUse.setAttribute('vector-effect', 'non-scaling-stroke');
    maskedGroup.appendChild(strokeUse);
    svg.appendChild(maskedGroup);

    // Original fill on top:
    const fillUse = document.createElementNS(svgNS, 'use');
    fillUse.setAttributeNS(xlinkNS, 'xlink:href', `#${iconShapeId}`);
    if (glyphStyle === 'flat') {
        // solid fill using glyphColor
        fillUse.setAttribute('fill', glyphColor);
    } else if (glyphStyle === 'gradient') {
        fillUse.setAttribute('fill', 'url(#glyphGradient)');
    } else { // glass
        fillUse.setAttribute('fill', 'url(#fadeFill)');
    }
    svg.appendChild(fillUse);

    return svg;
}

// Render helper
async function renderIcon(iconClass) {
    const canvas = document.getElementById('canvas');
    canvas.innerHTML = ''; // clear old

    try {
        const svgText = await fetchIconSvg(iconClass);
        const { shapes, srcViewBox } = extractShapes(svgText);
        if (!shapes.length) throw new Error('No drawable shapes found in SVG.');
        // pass currentRadius as fraction (0..1) as last arg
        const svg = buildStyledSvg(shapes, srcViewBox, currentBgColor, currentSize, currentAngle, currentBgStyle, currentGlyphStyle, currentGlyphColor, currentRadius / 100);
        canvas.appendChild(svg);
    } catch (err) {
        console.error(err);
    }
}

// Download SVG function
function downloadSvg() {
    const iconName = currentIcon || 'icon';
    const svg = document.getElementById('icon-root');

    if (!svg) {
        alert('No icon is currently loaded.');
        return;
    }

    // Create a new SVG document for export
    const svgNS = 'http://www.w3.org/2000/svg';
    const exportSvg = document.createElementNS(svgNS, 'svg');
    exportSvg.setAttribute('xmlns', svgNS);
    exportSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    exportSvg.setAttribute('viewBox', svg.getAttribute('viewBox'));
    exportSvg.setAttribute('width', '512');
    exportSvg.setAttribute('height', '512');

    // Clone all children from the original SVG
    const clone = svg.cloneNode(true);
    while (clone.firstChild) {
        exportSvg.appendChild(clone.firstChild);
    }

    // Serialize SVG to string with XML declaration
    const serializer = new XMLSerializer();
    let svgString = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n';
    svgString = serializer.serializeToString(exportSvg);

    // Clean up any namespace inconsistencies
    svgString = svgString.replace(/NS\d:href/g, 'xlink:href');

    // Create a Blob with the SVG data
    const blob = new Blob([svgString], { type: 'image/svgxml' });

    // Create a download link
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${iconName}-icon.svg`;
    document.body.appendChild(a);
    a.click();

    // Cleanup
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }, 100);
}

// Current state
// track selected icon via clicks (removed text input)
let currentIcon = 'palette-fill';
let currentBgColor = '#6155F5'; // Indigo (background)
let currentGlyphColor = '#FFFFFF'; // glyph color default (white)
let currentGlyphStyle = 'glass'; // glyph style: 'glass'|'gradient'|'flat'
let currentSize = 70; // Default size as percentage
let currentAngle = 0; // Default rotation in degrees
let currentBgStyle = 'gradient'; // Default background style
let currentRadius = 25; // corner radius in percent (default 25% to match previous behavior)

// UI wiring (selection happens via clicking thumbnails)

// Add download button event listener
document.getElementById('download-btn').addEventListener('click', downloadSvg);

// Color palette / grid handling
// background palette
const paletteBtn = document.getElementById('color-palette-btn');
paletteBtn.style.background = currentBgColor;
const colorGrid = document.getElementById('color-grid-popup');
const gridColors = Array.from(colorGrid.querySelectorAll('.grid-color'));
// mark matching grid cell as selected for background
(function markInitialBgGridSelection() {
    const match = gridColors.find(g => (g.dataset.color || '').toLowerCase() === currentBgColor.toLowerCase());
    if (match) {
        gridColors.forEach(g => g.classList.remove('selected'));
        match.classList.add('selected');
    }
})();
const customColorInput = document.getElementById('custom-color-input');
const bgStyleSelect = document.getElementById('bg-style');
const glyphStyleSelect = document.getElementById('glyph-style');
// glyph palette
const glyphPaletteBtn = document.getElementById('glyph-palette-btn');
glyphPaletteBtn.style.background = currentGlyphColor;
const glyphGrid = document.getElementById('glyph-grid-popup');
const glyphGridColors = Array.from(glyphGrid.querySelectorAll('.grid-color'));
// initial glyph selection
(function markInitialGlyphGridSelection() {
    const match = glyphGridColors.find(g => (g.dataset.color || '').toLowerCase() === currentGlyphColor.toLowerCase());
    if (match) {
        glyphGridColors.forEach(g => g.classList.remove('selected'));
        match.classList.add('selected');
    }
})();
const customGlyphColorInput = document.getElementById('custom-glyph-color-input');

// icon selector button + panel
const selectIconBtn = document.getElementById('select-icon-button');
// popup element lives after this script in the DOM; defer lookup until DOMContentLoaded
let iconSelector = null;

// preview loader for the small button (always replaces content)
function loadSvgPreview(buttonEl, iconName) {
    if (!buttonEl) return;
    const container = buttonEl.querySelector('.icon-svg');
    if (!container) return;
    const url = `assets/bootstrap-icons/${iconName}.svg`;
    fetch(url, { cache: 'force-cache' })
        .then(res => res.ok ? res.text() : Promise.reject(new Error('not found')))
        .then(svg => {
            container.innerHTML = svg;
        })
        .catch(() => {
            container.innerHTML = '';
        });
}

// Helpers to animate height-based open/close
function openPopup(popup, button) {
    if (popup.classList.contains('open')) return;
    // close other popup(s)
    if (popup !== colorGrid) closePopup(colorGrid, paletteBtn);
    if (popup !== glyphGrid) closePopup(glyphGrid, glyphPaletteBtn);
    if (popup !== iconSelector) closePopup(iconSelector, selectIconBtn);

    // if this is the icon selector (fullscreen fade), just toggle open/aria
    if (popup === iconSelector) {
        // defer loading of icons until selector is opened
        ensureIconsLoaded().catch(() => {/* errors already logged */ });
        popup.classList.add('open');
        popup.setAttribute('aria-hidden', 'false');
        if (button) button.classList.add('active');
        if (button) button.setAttribute('aria-expanded', 'true');
        return;
    }

    // legacy height animation for other popups (color grids)
    popup.style.height = 'auto';
    const target = popup.scrollHeight;
    popup.style.height = '0px';
    void popup.offsetHeight;
    popup.classList.add('open');
    popup.setAttribute('aria-hidden', 'false');
    if (button) button.classList.add('active');
    popup.style.height = target + 'px';

    const onEnd = (ev) => {
        if (ev.propertyName === 'height') {
            popup.style.height = 'auto';
            popup.removeEventListener('transitionend', onEnd);
        }
    };
    popup.addEventListener('transitionend', onEnd);
}

function closePopup(popup, button) {
    if (!popup || !popup.classList.contains('open')) return;
    // if this is the icon selector (fade), just toggle off
    if (popup === iconSelector) {
        popup.classList.remove('open');
        popup.setAttribute('aria-hidden', 'true');
        if (button) button.classList.remove('active');
        if (button) button.setAttribute('aria-expanded', 'false');
        return;
    }

    // legacy height animation for other popups
    const current = popup.scrollHeight;
    popup.style.height = current + 'px';
    void popup.offsetHeight;
    popup.style.height = '0px';
    popup.classList.remove('open');
    popup.setAttribute('aria-hidden', 'true');
    if (button) button.classList.remove('active');
    if (button) button.setAttribute('aria-expanded', 'false');

    const onEnd = (ev) => {
        if (ev.propertyName === 'height') {
            popup.style.height = '0px';
            popup.removeEventListener('transitionend', onEnd);
        }
    };
    popup.addEventListener('transitionend', onEnd);
}

function togglePopup(popup, button) {
    if (popup.classList.contains('open')) closePopup(popup, button);
    else openPopup(popup, button);
}

// Palette click toggles popup
paletteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopup(colorGrid, paletteBtn);
});
glyphPaletteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopup(glyphGrid, glyphPaletteBtn);
});

// Icon selector toggle + preview wiring
selectIconBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // reflect expanded state for accessibility
    const open = iconSelector.classList.contains('open');
    selectIconBtn.setAttribute('aria-expanded', String(!open));
    togglePopup(iconSelector, selectIconBtn);
});

// Close popup when clicking elsewhere
document.addEventListener('click', (e) => {
    const t = e.target;
    // if neither popup is open, nothing to do
    if (!colorGrid.classList.contains('open') && !glyphGrid.classList.contains('open') && !iconSelector.classList.contains('open')) return;
    // if click is on any control or inside any popup, keep open
    if (paletteBtn.contains(t) || colorGrid.contains(t) || glyphPaletteBtn.contains(t) || glyphGrid.contains(t) || selectIconBtn.contains(t) || iconSelector.contains(t)) return;
    // close all popups (idempotent)
    closePopup(colorGrid, paletteBtn);
    closePopup(glyphGrid, glyphPaletteBtn);
    closePopup(iconSelector, selectIconBtn);
});

// Grid color selection
// background grid selection
gridColors.forEach(cell => {
    cell.addEventListener('click', (ev) => {
        const el = ev.currentTarget;
        if (el.id === 'grid-color-custom') {
            customColorInput.click();
            return;
        }
        const color = el.dataset.color;
        if (!color) return;
        currentBgColor = color;
        gridColors.forEach(g => g.classList.remove('selected'));
        el.classList.add('selected');
        paletteBtn.style.background = currentBgColor;
        // close via helper so height animates
        closePopup(colorGrid, paletteBtn);
        renderIcon(currentIcon);
    });
});
// glyph grid selection
glyphGridColors.forEach(cell => {
    cell.addEventListener('click', (ev) => {
        const el = ev.currentTarget;
        if (el.id === 'glyph-grid-color-custom') {
            customGlyphColorInput.click();
            return;
        }
        const color = el.dataset.color;
        if (!color) return;
        currentGlyphColor = color;
        glyphGridColors.forEach(g => g.classList.remove('selected'));
        el.classList.add('selected');
        glyphPaletteBtn.style.background = currentGlyphColor;
        // close via helper so height animates
        closePopup(glyphGrid, glyphPaletteBtn);
        renderIcon(currentIcon);
    });
});

// ensure selecting an icon closes the selector and updates the small preview
// (modify thumbnail click handler earlier to also call this)
// ...existing code...

// initial preview load for the select button
loadSvgPreview(selectIconBtn, currentIcon);

// custom color input chosen
customColorInput.addEventListener('input', () => {
    currentBgColor = customColorInput.value;
    gridColors.forEach(g => g.classList.remove('selected'));
    const customCell = document.getElementById('grid-color-custom');
    customCell.classList.add('selected');
    paletteBtn.style.background = currentBgColor;
    closePopup(colorGrid, paletteBtn);
    renderIcon(currentIcon);
});
customGlyphColorInput.addEventListener('input', () => {
    currentGlyphColor = customGlyphColorInput.value;
    glyphGridColors.forEach(g => g.classList.remove('selected'));
    const customCell = document.getElementById('glyph-grid-color-custom');
    customCell.classList.add('selected');
    glyphPaletteBtn.style.background = currentGlyphColor;
    closePopup(glyphGrid, glyphPaletteBtn);
    renderIcon(currentIcon);
});

// Background style selector handling
bgStyleSelect.addEventListener('change', () => {
    currentBgStyle = bgStyleSelect.value;
    // when switching away from custom solid color, leave custom button visual as-is
    renderIcon(currentIcon);
});
// glyph style selector
glyphStyleSelect.addEventListener('change', () => {
    currentGlyphStyle = glyphStyleSelect.value;
    // when changing glyph style, re-render (glyph gradient/diag logic updates in builder)
    renderIcon(currentIcon);
});

// Size slider handling
const sizeSlider = document.getElementById('size-slider');
// find the label for this slider (keeps working if class names were renamed)
const sizeValue = (sizeSlider && sizeSlider.previousElementSibling)
    ? sizeSlider.previousElementSibling.querySelector('.slider-value')
    : document.querySelector('.slider-value');

sizeSlider.addEventListener('input', () => {
    currentSize = parseInt(sizeSlider.value);
    sizeValue.textContent = `${currentSize}%`;
    renderIcon(currentIcon);
});

// Angle slider handling
const angleSlider = document.getElementById('angle-slider');
// find the label for this slider (keeps working if class names were renamed)
const angleValue = (angleSlider && angleSlider.previousElementSibling)
    ? angleSlider.previousElementSibling.querySelector('.slider-value')
    : (document.querySelectorAll('.slider-value')[1] || document.querySelector('.slider-value'));

angleSlider.addEventListener('input', () => {
    currentAngle = parseInt(angleSlider.value);
    angleValue.textContent = `${currentAngle}°`;
    renderIcon(currentIcon);
});

// Radius slider handling
const radiusSlider = document.getElementById('radius-slider');
const radiusValue = document.getElementById('radius-value');
if (radiusSlider && radiusValue) {
    // ensure UI reflects initial state
    radiusSlider.value = String(currentRadius);
    radiusValue.textContent = `${currentRadius}%`;
    radiusSlider.addEventListener('input', () => {
        currentRadius = parseInt(radiusSlider.value, 10);
        radiusValue.textContent = `${currentRadius}%`;
        renderIcon(currentIcon);
    });
}

// Initial render
// ensure selectors match state visually
document.getElementById('bg-style').value = currentBgStyle;
document.getElementById('glyph-style').value = currentGlyphStyle;
// ensure radius UI matches the state (in case it's been changed above)
const rEl = document.getElementById('radius-slider');
const rLbl = document.getElementById('radius-value');
if (rEl) rEl.value = String(currentRadius);
if (rLbl) rLbl.textContent = `${currentRadius}%`;

renderIcon(currentIcon);

(function enableCanvasPanningAndZoom() {
    const container = document.getElementById('canvas-container');
    const canvasEl = document.getElementById('canvas');
    if (!container || !canvasEl) return;

    let isPanning = false;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startPanX = 0;
    let startPanY = 0;
    // accumulated pan offsets (in px)
    let panX = 0;
    let panY = 0;

    // track canvas pixel size used for zooming
    // initialize from computed size so we respect CSS min() etc.
    let canvasWidth = Math.max(1, Math.round(canvasEl.getBoundingClientRect().width));

    // helper to apply transform and size
    // keep centering translate(-50%,-50%) then apply pan translate(px,py)
    function applyPan() {
        canvasEl.style.transform = `translate(-50%, -50%) translate(${Math.round(panX)}px, ${Math.round(panY)}px)`;
    }
    function applySize(w) {
        canvasWidth = Math.round(w);
        canvasEl.style.width = `${canvasWidth}px`;
        canvasEl.style.height = `${canvasWidth}px`;
    }

    // compute a sensible base width (used for reset)
    function computeBaseWidth() {
        return Math.max(48, Math.round(Math.min(
            Math.min(300, (container.clientWidth - 64)),
            (window.innerHeight - 72 - 64)
        )));
    }

    // reset pan + zoom to defaults
    function resetView() {
        panX = 0;
        panY = 0;
        applySize(computeBaseWidth());
        applyPan();
    }

    // ensure inline size is set initially so wheel zoom works predictably
    applySize(canvasWidth);
    applyPan();

    container.addEventListener('pointerdown', (e) => {
        // only left button starts panning
        if (e.button !== 0) return;
        isPanning = true;
        pointerId = e.pointerId;
        try { container.setPointerCapture(pointerId); } catch (err) {/* ignore */ }
        startX = e.clientX;
        startY = e.clientY;
        startPanX = panX;
        startPanY = panY;
        canvasEl.classList.add('panning');
        e.preventDefault();
    });

    container.addEventListener('pointermove', (e) => {
        if (!isPanning || e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        panX = startPanX + dx;
        panY = startPanY + dy;
        applyPan();
    });

    function endPan(e) {
        if (!isPanning) return;
        if (e && e.pointerId && e.pointerId !== pointerId) return;
        isPanning = false;
        try { container.releasePointerCapture(pointerId); } catch (err) {/* ignore */ }
        pointerId = null;
        canvasEl.classList.remove('panning');
    }

    container.addEventListener('pointerup', endPan);
    container.addEventListener('pointercancel', endPan);

    // double-click resets pan and zoom (handy)
    container.addEventListener('dblclick', (e) => {
        resetView();
    });

    // wheel-to-zoom: zoom centered at mouse pointer
    container.addEventListener('wheel', (e) => {
        // prevent page scroll
        e.preventDefault();

        const rect = canvasEl.getBoundingClientRect();
        const oldW = rect.width || canvasWidth;
        // compute scale factor from wheel delta (smooth and reasonable)
        // negative deltaY -> zoom in; positive -> zoom out
        const ZOOM_BASE = 1.12; // step multiplier per "notch"
        const delta = e.deltaY;
        // convert delta to a factor: use exponential mapping for smoothness
        const factor = Math.pow(ZOOM_BASE, -Math.sign(delta) * Math.min(4, Math.abs(delta) / 100));

        // desired new width (clamped)
        const minW = 24; // don't collapse
        const maxW = Math.max(container.clientWidth, 300) * 6; // allow zoom up to 6x container
        let desiredW = oldW * factor;
        desiredW = Math.max(minW, Math.min(maxW, desiredW));
        // actual applied scale
        const sActual = desiredW / oldW;
        if (Math.abs(1 - sActual) < 0.0001) return; // nothing changed

        // pointer offset relative to canvas center (the SVG is centered inside the canvas)
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const pxCenter = e.clientX - cx;
        const pyCenter = e.clientY - cy;
        // when the element resizes the internal SVG scales about the element center,
        // so adjust pan by the center-offset to keep the point under cursor fixed:
        panX = panX - (sActual - 1) * pxCenter;
        panY = panY - (sActual - 1) * pyCenter;

        // apply size and pan
        applySize(desiredW);
        applyPan();
    }, { passive: false });

    // reset on "0" keypress (no modifier). keep this short and local.
    document.addEventListener('keydown', (ev) => {
        if (ev.key === '0' && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
            ev.preventDefault();
            resetView();
        }
    });

})();