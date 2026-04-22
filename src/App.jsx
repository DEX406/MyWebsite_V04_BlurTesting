import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { ZoomInIcon, ZoomOutIcon, GridIcon, HomeIcon, FloppyIcon, UndoIcon, RedoIcon, CopyIcon, PasteIcon, TrashIcon, GroupIcon, UngroupIcon, BringFrontIcon, SendBackIcon } from './icons.jsx';

import { FONT, FONTS, DEFAULT_BG_GRID } from './constants.js';
import { loadConfiguredFonts } from './fontLibrary.js';
import { uid, snap, isTyping, pasteItems, migrateItems, applyDragDelta, isGifSrc, isItemFlashEnabled, nextFlashTransitionMs, readLocal, writeLocal, maxZ, minZ } from './utils.js';
import { presetToScale } from './components/ResizePresetSelect.jsx';
import { decodeGifFrames, fitOntoCanvas, encodeAnimatedWebp } from './animatedWebp.js';
import { createBackupZip, restoreFromZip } from './backupRestore.js';
import { tbBtn, tbSurface, tbSep, togBtn, infoText, panelSurface, UI_BG, UI_BORDER, Z } from './styles.js';
import { CanvasItem } from './components/CanvasItem.jsx';
import { PropertiesPanel } from './components/PropertiesPanel.jsx';
import { Toolbar } from './components/Toolbar.jsx';
import { ColorPickerPopup } from './components/ColorPickerPopup.jsx';
import { LoginModal } from './components/LoginModal.jsx';
import { loadBoard, saveBoard, cleanupFiles, uploadImage, uploadVideo, login, logout, hasToken, getBackupManifest, restoreImageKey, downloadImageViaProxy, serverResize } from './api.js';
import { convertVideoToWebm, isVideoFile } from './videoUtils.js';
import { BlurFrameSync } from './blurFrameSync.js';
import { useViewport } from './hooks/useViewport.js';
import { useKeyboard } from './hooks/useKeyboard.js';
import { usePointerInput } from './hooks/usePointerInput.js';
import { useTouchInput } from './hooks/useTouchInput.js';
import { useUndo } from './hooks/useUndo.js';
import { useMipmap } from './hooks/useMipmap.js';
import { useWebGLCanvas } from './hooks/useWebGLCanvas.js';

const DEFAULT_PALETTE = ["#C2C0B6", "#30302E", "#262624", "#141413", "#FE8181", "#D97757", "#65BB30", "#2C84DB", "#9B87F5"];
const COLOR_PROPS = ["color", "bgColor", "borderColor", "lineColor", "dotColor"];
// ── App ──
export default function App() {
  const [items, setItems] = useState([]);
  const [isAdmin, setIsAdmin] = useState(() => hasToken());
  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [rateLimited, setRateLimited] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [snapOn, setSnapOn] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [globalShadow, setGlobalShadow] = useState(() => readLocal("lutz-shadow-settings", { enabled: true, size: 1.5, opacity: 0.1 }));
  const [selectedIds, setSelectedIds] = useState([]);
  const [clipboard, setClipboard] = useState([]);
  const [palette, setPalette] = useState(DEFAULT_PALETTE);
  const [bgGrid, setBgGrid] = useState(DEFAULT_BG_GRID);
  const [colorPicker, setColorPicker] = useState(null);
  const [settingTeleport, setSettingTeleport] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [rotating, setRotating] = useState(null);
  const [editingTextId, setEditingTextId] = useState(null);
  const [boxSelect, setBoxSelect] = useState(null);
  const [editingConnector, setEditingConnector] = useState(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(() => {
    try { return localStorage.getItem("lutz-properties-collapsed") === "1"; } catch { return false; }
  });

  const fileInputRef = useRef(null);
  const boardFileRef = useRef(null);
  const saveTimer = useRef(null);
  const itemsRef = useRef(items); itemsRef.current = items;
  const bgGridRef = useRef(bgGrid); bgGridRef.current = bgGrid;
  const paletteRef = useRef(palette); paletteRef.current = palette;
  const isAdminRef = useRef(isAdmin); isAdminRef.current = isAdmin;
  const selectedIdsRef = useRef(selectedIds); selectedIdsRef.current = selectedIds;
  const draggingRef = useRef(dragging); draggingRef.current = dragging;
  const dragDeltaRef = useRef(null);  // {dx, dy} in world coords, bypasses React during drag
  const itemOverrideRef = useRef(null);  // {id, props} for resize/rotate/connector, bypasses React
  const resizingRef = useRef(resizing); resizingRef.current = resizing;
  const rotatingRef = useRef(rotating); rotatingRef.current = rotating;
  const editingConnectorRef = useRef(editingConnector); editingConnectorRef.current = editingConnector;
  const multiSelectModeRef = useRef(multiSelectMode); multiSelectModeRef.current = multiSelectMode;
  const globalShadowRef = useRef(globalShadow); globalShadowRef.current = globalShadow;
  const editingTextIdRef = useRef(editingTextId); editingTextIdRef.current = editingTextId;

  const effectiveSnap = snapOn || shiftHeld;
  const effectiveSnapRef = useRef(effectiveSnap); effectiveSnapRef.current = effectiveSnap;

  // ── Viewport ──
  const vp = useViewport();
  const { canvasRef, canvasHandlesRef, drawBgRef, posDisplayRef, zoomDisplayRef, applyTransform, updateDisplays, viewCenter, zoomTo, animateTo, goHome, setHome } = vp;

  // ── WebGL renderer ──
  const webgl = useWebGLCanvas();

  // ── Media overlay (DOM elements behind canvas for videos/GIFs) ──
  const overlayRef = useRef(null);
  const overlayElsRef = useRef(new Map()); // id → DOM element
  // ── Blur overlay (single shared CSS backdrop-filter div behind canvas) ──
  const sharedBlurElRef = useRef(null); // one DOM div to avoid blur stacking
  const sharedBlurClipRef = useRef(null); // { svg, clipPath, id }
  const blurSyncRef = useRef(null); // BlurFrameSync — drives repaints from media frames
  const blurTickRef = useRef(false); // toggles opacity to force backdrop-filter recomposite

  const syncOverlays = useCallback((overlays, panX, panY, zoom) => {
    const container = overlayRef.current;
    if (!container) return;

    const mediaOverlays = overlays.filter(o => o.type !== 'blur-video');
    // Only visible blur items contribute to the shared backdrop clip mask.
    const blurVideoOverlays = overlays.filter(o => o.type === 'blur-video' && o.visible !== false);

    // ── Regular media overlays (videos/GIFs — behind canvas) ──
    // Elements stay mounted across flash on/off cycles; visibility is toggled
    // via CSS. Tearing down <video>/<img> nodes each cycle was the source of
    // the flash stutter (decoder restart, layout reflow, image redecode).
    const activeIds = new Set(mediaOverlays.map(o => o.id));
    const els = overlayElsRef.current;

    // Remove elements for items that are truly gone (deleted, type-changed)
    for (const [id, el] of els) {
      if (!activeIds.has(id)) {
        if (el.tagName === 'VIDEO') { el.pause(); el.src = ''; }
        el.remove();
        els.delete(id);
      }
    }

    // Create or update elements
    for (const o of mediaOverlays) {
      let el = els.get(o.id);
      if (!el) {
        if (o.type === 'video') {
          el = document.createElement('video');
          el.crossOrigin = 'anonymous';
          el.autoplay = true;
          el.loop = true;
          el.muted = true;
          el.playsInline = true;
          el.src = o.src;
          el.play().catch(() => {});
        } else {
          el = document.createElement('img');
          el.crossOrigin = 'anonymous';
          el.src = o.src;
        }
        el.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;object-fit:cover;transform-origin:center center;image-rendering:pixelated;';
        container.appendChild(el);
        els.set(o.id, el);
      }
      if (el.src !== o.src && o.src) {
        el.src = o.src;
        if (el.tagName === 'VIDEO') el.play().catch(() => {});
      }
      const screenX = o.x * zoom + panX;
      const screenY = o.y * zoom + panY;
      const screenW = o.w * zoom;
      const screenH = o.h * zoom;
      el.style.left = screenX + 'px';
      el.style.top = screenY + 'px';
      el.style.width = screenW + 'px';
      el.style.height = screenH + 'px';
      el.style.zIndex = o.z;
      el.style.borderRadius = (o.radius * zoom) + 'px';
      const rot = o.rotation ? ` rotate(${o.rotation}deg)` : '';
      el.style.transform = rot;
      el.style.transformOrigin = 'center center';
      // Flash visibility — keeps layout stable, no decoder teardown
      el.style.visibility = o.visible === false ? 'hidden' : 'visible';
    }

    // ── Shared blur backdrop overlay ──
    // We use one full-size backdrop-filter layer instead of one per blur item,
    // so overlapping blur windows do not stack additional blur strength.
    const blurCount = blurVideoOverlays.length;
    let sharedEl = sharedBlurElRef.current;

    if (!blurCount) {
      if (blurSyncRef.current) {
        blurSyncRef.current.destroy();
        blurSyncRef.current = null;
      }
      if (sharedEl) {
        sharedEl.remove();
        sharedBlurElRef.current = null;
      }
      const clip = sharedBlurClipRef.current;
      if (clip) {
        clip.svg.remove();
        sharedBlurClipRef.current = null;
      }
      return;
    }

    if (!sharedEl) {
      sharedEl = document.createElement('div');
      sharedEl.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;';
      container.appendChild(sharedEl);
      sharedBlurElRef.current = sharedEl;
    }
    if (!blurSyncRef.current) {
      // Toggle opacity by an imperceptible amount to force the browser to
      // re-composite the backdrop-filter. Driven only when underlying media
      // commits a new frame (rVFC for video, ImageDecoder timing for GIF).
      blurSyncRef.current = new BlurFrameSync(() => {
        const el = sharedBlurElRef.current;
        if (!el) return;
        blurTickRef.current = !blurTickRef.current;
        el.style.opacity = blurTickRef.current ? '1' : '0.999';
      });
    }

    // Collect distinct animated media currently under any visible blur, so the
    // sync only ticks for sources that actually need it.
    const blurMediaSources = [];
    const seenSrc = new Set();
    for (const blur of blurVideoOverlays) {
      const behind = blur.mediaBehind;
      if (!behind) continue;
      for (const m of behind) {
        if (!m.src || seenSrc.has(m.src)) continue;
        seenSrc.add(m.src);
        blurMediaSources.push({ src: m.src, type: m.type, el: els.get(m.id) });
      }
    }
    blurSyncRef.current.setSources(blurMediaSources);

    let clip = sharedBlurClipRef.current;
    if (!clip) {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.style.position = 'absolute';
      svg.style.pointerEvents = 'none';
      const defs = document.createElementNS(ns, 'defs');
      const clipPath = document.createElementNS(ns, 'clipPath');
      const clipId = 'shared-blur-clip-path';
      clipPath.setAttribute('id', clipId);
      clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
      defs.appendChild(clipPath);
      svg.appendChild(defs);
      container.appendChild(svg);
      clip = { svg, clipPath, id: clipId };
      sharedBlurClipRef.current = clip;
    }

    // Shared blur intensity for the single blur layer.
    // The canvas matte cutouts determine where this shared layer is visible.
    const blurRadius = blurVideoOverlays[0]?.blurRadius || 8;
    // Keep blur radius in canvas/world units so visual blur scales with zoom.
    const blurPx = blurRadius * zoom;
    const topZ = blurVideoOverlays.reduce((m, o) => Math.max(m, o.z || 0), 0);
    while (clip.clipPath.firstChild) clip.clipPath.removeChild(clip.clipPath.firstChild);
    for (const o of blurVideoOverlays) {
      const ns = 'http://www.w3.org/2000/svg';
      const rect = document.createElementNS(ns, 'rect');
      const x = o.x * zoom + panX;
      const y = o.y * zoom + panY;
      const w = o.w * zoom;
      const h = o.h * zoom;
      const cx = x + w * 0.5;
      const cy = y + h * 0.5;
      const r = Math.max(0, Math.min(o.radius * zoom, w * 0.5, h * 0.5));
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('rx', String(r));
      rect.setAttribute('ry', String(r));
      if (o.rotation) rect.setAttribute('transform', `rotate(${o.rotation} ${cx} ${cy})`);
      clip.clipPath.appendChild(rect);
    }

    sharedEl.style.zIndex = String(topZ);
    sharedEl.style.backdropFilter = `blur(${blurPx}px)`;
    sharedEl.style.webkitBackdropFilter = `blur(${blurPx}px)`;
    const clipUrl = `url(#${clip.id})`;
    sharedEl.style.clipPath = clipUrl;
    sharedEl.style.webkitClipPath = clipUrl;
    sharedEl.style.display = 'block';
  }, []);

  // Cleanup overlay elements on unmount
  useEffect(() => {
    return () => {
      for (const el of overlayElsRef.current.values()) {
        if (el.tagName === 'VIDEO') { el.pause(); el.src = ''; }
        el.remove();
      }
      overlayElsRef.current.clear();
      if (blurSyncRef.current) {
        blurSyncRef.current.destroy();
        blurSyncRef.current = null;
      }
      const sharedEl = sharedBlurElRef.current;
      if (sharedEl) {
        sharedEl.remove();
        sharedBlurElRef.current = null;
      }
      const clip = sharedBlurClipRef.current;
      if (clip) {
        clip.svg.remove();
        sharedBlurClipRef.current = null;
      }
    };
  }, []);

  // Wire up WebGL render trigger — called on every viewport change (pan/zoom/resize)
  useEffect(() => {
    drawBgRef.current = () => {
      let renderItems = itemsRef.current;
      // During active gestures, apply offsets directly to items for immediate GPU rendering
      // (bypasses React state for zero-latency touch response)
      const drag = draggingRef.current;
      const delta = dragDeltaRef.current;
      const override = itemOverrideRef.current;
      if (drag && delta) {
        renderItems = applyDragDelta(renderItems, drag.itemsStartMap, delta.dx, delta.dy, effectiveSnapRef.current);
      } else if (override) {
        renderItems = renderItems.map(i => i.id === override.id ? { ...i, ...override.props } : i);
      }
      const panX = vp.panRef.current.x;
      const panY = vp.panRef.current.y;
      const zoom = vp.zoomRef.current;
      const overlays = webgl.renderSync({
        items: renderItems,
        panX, panY, zoom,
        bgGrid: bgGridRef.current,
        globalShadow: globalShadowRef.current,
        selectedIds: selectedIdsRef.current,
        editingTextId: editingTextIdRef.current,
      });
      syncOverlays(overlays, panX, panY, zoom);
    };
    drawBgRef.current();
  }, []);

  // Re-render when state changes that affect WebGL output
  useEffect(() => {
    if (drawBgRef.current) drawBgRef.current();
  }, [bgGrid, items, selectedIds, globalShadow, editingTextId]);

  // Re-render only at each flash visibility transition. A fixed 30fps polling
  // loop triggered full redraws every frame even when no visibility actually
  // changed; now the next tick is scheduled at the exact next on/off flip.
  useEffect(() => {
    if (!items.some(isItemFlashEnabled)) return;
    let timeoutId;
    const schedule = () => {
      const delay = nextFlashTransitionMs(itemsRef.current);
      if (!Number.isFinite(delay)) return;
      timeoutId = setTimeout(() => {
        if (drawBgRef.current) drawBgRef.current();
        schedule();
      }, Math.max(1, delay));
    };
    schedule();
    return () => clearTimeout(timeoutId);
  }, [items]);

  // Re-render on viewport container resize
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (drawBgRef.current) drawBgRef.current(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Load board on mount ──
  // Wait for both board data AND web fonts before setting items so text is
  // never rasterized with a fallback font.
  useEffect(() => {
    Promise.all([loadBoard(), loadConfiguredFonts()]).then(([{ items: loaded, bgGrid: savedGrid, homeView: savedHome, palette: savedPalette }]) => {
      if (savedGrid) setBgGrid(savedGrid);
      if (savedPalette) setPalette(savedPalette);
      if (savedHome) vp.homeViewRef.current = savedHome;
      const migrated = migrateItems(loaded);
      // Set pan/zoom before setLoading so the first canvas render uses correct values
      const w = window.innerWidth, h = window.innerHeight;
      if (savedHome) {
        vp.panRef.current = { x: w / 2 - savedHome.x * savedHome.zoom, y: h / 2 - savedHome.y * savedHome.zoom };
        vp.zoomRef.current = savedHome.zoom;
      } else {
        vp.panRef.current = { x: w / 2, y: h / 2 };
        vp.zoomRef.current = 1;
      }
      setItems(migrated);
      webgl.rendererRef.current?.textRenderer.invalidateAll();
      setLoading(false);
    });
  }, []);

  // ── Persist settings ──
  useEffect(() => { writeLocal("lutz-shadow-settings", globalShadow); }, [globalShadow]);
  useEffect(() => { try { localStorage.setItem("lutz-properties-collapsed", propertiesCollapsed ? "1" : "0"); } catch {} }, [propertiesCollapsed]);
  // bgGrid and palette changes trigger a board save (defined after scheduleSave below)

  // Close color picker on outside click
  useEffect(() => {
    if (!colorPicker) return;
    const close = (ev) => { if (!ev?.target?.closest("[data-ui]")) setColorPicker(null); };
    const t = setTimeout(() => window.addEventListener("pointerdown", close), 0);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", close); };
  }, [colorPicker !== null]);

  // Sync handles transform on selection change
  useEffect(() => { applyTransform(); }, [selectedIds, applyTransform]);

  // Exit multi-select mode when nothing is selected
  useEffect(() => {
    if (multiSelectMode && selectedIds.length === 0) setMultiSelectMode(false);
  }, [selectedIds.length, multiSelectMode]);

  // ── Save helpers ──
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveStatus("saving");
      const ok = await saveBoard(itemsRef.current, bgGridRef.current, vp.homeViewRef.current, paletteRef.current);
      setSaveStatus(ok ? "saved" : "error");
      setTimeout(() => setSaveStatus(""), 2000);
    }, 2000);
  }, []);

  // Persist bgGrid and palette with board data when they change (skip during initial load)
  useEffect(() => {
    if (loading || !isAdmin) return;
    scheduleSave();
  }, [bgGrid]);

  useEffect(() => {
    if (loading || !isAdmin) return;
    scheduleSave();
  }, [palette]);


  const { setItemsWithUndo: setItemsAndSave, undo, redo, canUndo, canRedo, pushUndo } = useUndo(setItems, scheduleSave, isAdmin);

  // ── Item CRUD ──
  const updateItem = (id, updates) => setItemsAndSave(p => p.map(i => i.id === id ? { ...i, ...updates } : i));
  // Mipmap updater: displaySrc/placeholderSrc/targetSrc changes are silent (no save),
  // but srcQ50/srcQ25/srcQ12/srcQ6 trigger a save
  const updateItemMipmap = useCallback((id, updates) => {
    const hasMipmapUrls = updates.srcQ50 !== undefined || updates.srcQ25 !== undefined || updates.srcQ12 !== undefined || updates.srcQ6 !== undefined;
    if (hasMipmapUrls) {
      // Persist mipmap URLs to the board (but no undo entry)
      setItems(p => p.map(i => i.id === id ? { ...i, ...updates } : i));
      scheduleSave();
    } else {
      // displaySrc/placeholderSrc/targetSrc changes — ephemeral, no save needed
      setItems(p => p.map(i => i.id === id ? { ...i, ...updates } : i));
    }
  }, [scheduleSave]);

  // MIP mapping — lazy generation + tier selection
  useMipmap(items, updateItemMipmap, vp);

  const updateItems = (ids, updates) => setItemsAndSave(p => p.map(i => ids.includes(i.id) ? { ...i, ...updates } : i));
  const deleteItems = (ids) => { setItemsAndSave(p => p.filter(i => !ids.includes(i.id))); setSelectedIds(prev => prev.filter(id => !ids.includes(id))); };
  const groupSelected = () => { if (selectedIds.length < 2) return; const gid = uid(); setItemsAndSave(p => p.map(i => selectedIds.includes(i.id) ? { ...i, groupId: gid } : i)); };
  const ungroupSelected = () => setItemsAndSave(p => p.map(i => selectedIds.includes(i.id) ? { ...i, groupId: undefined } : i));
  // Partition into selected vs other in a single pass, find boundary Z, then reassign.
  const restack = (toFront) => setItemsAndSave(prev => {
    const selSet = new Set(selectedIds);
    const sel = [];
    let boundary = null;
    for (const i of prev) {
      if (selSet.has(i.id)) sel.push(i);
      else if (boundary === null) boundary = i.z;
      else if (toFront ? i.z > boundary : i.z < boundary) boundary = i.z;
    }
    if (!sel.length) return prev;
    sel.sort((a, b) => a.z - b.z);
    const base = boundary ?? 0;
    const zMap = new Map();
    sel.forEach((item, idx) => {
      zMap.set(item.id, toFront ? base + 1 + idx : base - sel.length + idx);
    });
    return prev.map(i => zMap.has(i.id) ? { ...i, z: zMap.get(i.id) } : i);
  });
  const bringToFront = () => restack(true);
  const sendToBack = () => restack(false);

  const handleCopySelected = useCallback(() => {
    const toCopy = items.filter(i => selectedIds.includes(i.id));
    if (!toCopy.length) return;
    setClipboard(toCopy.map(i => ({ ...i, id: uid() })));
  }, [items, selectedIds]);

  const handlePasteClipboard = useCallback(() => {
    if (!clipboard.length) return;
    const c = viewCenter();
    const mZ = maxZ(items);
    const pasted = pasteItems(clipboard, c, mZ);
    setItemsAndSave(p => [...p, ...pasted]);
    setSelectedIds(pasted.map(i => i.id));
  }, [clipboard, items, viewCenter, setItemsAndSave]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    deleteItems(selectedIds);
  }, [selectedIds]);

  const handleLogin = async () => {
    const result = await login(password);
    if (result === true) { setIsAdmin(true); setShowLogin(false); setPassword(""); setLoginError(false); setRateLimited(null); }
    else if (result && result.rateLimited) { setRateLimited(result.retryAfter); setLoginError(false); }
    else setLoginError(true);
  };

  // ── Input hooks ──
  const { handlePointerDown } = usePointerInput({
    vp, items, setItems, selectedIds, setSelectedIds, isAdmin,
    draggingRef, setDragging, resizingRef, setResizing,
    rotatingRef, setRotating, editingConnectorRef, setEditingConnector,
    setEditingTextId, effectiveSnapRef, scheduleSave, animateTo, pushUndo,
    doHitTest: webgl.doHitTest, setBoxSelect, dragDeltaRef, itemOverrideRef,
  });

  useTouchInput({
    vp, loading, itemsRef, isAdminRef, selectedIdsRef,
    setItems, setSelectedIds, setEditingTextId,
    setDragging, draggingRef, effectiveSnapRef,
    scheduleSave, animateTo, pushUndo,
    multiSelectModeRef, setMultiSelectMode,
    doHitTest: webgl.doHitTest, dragDeltaRef, itemOverrideRef,
  });

  useKeyboard({
    isAdmin, selectedIds, setSelectedIds, setClipboard,
    items, setItemsAndSave, editingTextId, setEditingTextId,
    setShiftHeld, undo, redo,
  });

  // ── Image upload (all conversion handled server-side) ──

  // Default canvas footprint for newly-placed media: natural/4 snapped to 16px.
  // This replaces the old "fit to 512px max" behaviour — the master still goes
  // to R2 at full (or user-chosen) resolution, we just display smaller. Users
  // who want the master itself smaller pick a preset in the upload dropdown.
  const fitForDisplay = (natW, natH) => {
    const w = snap(Math.max(1, Math.round(natW / 4)), true);
    const h = snap(Math.max(1, Math.round(natH / 4)), true);
    return { w, h };
  };

  // Load image dimensions and add to canvas at 1/4 natural size, 16-px snapped.
  const addImageToCanvas = (url, opts = {}) => {
    const { id: existingId, onError } = opts;
    const id = existingId || uid();
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const { w, h } = fitForDisplay(img.naturalWidth, img.naturalHeight);
        const c = viewCenter();
        if (existingId) {
          setItemsAndSave(p => p.map(i => i.id === id ? { ...i, w, h, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, x: snap(c.x - w / 2, true), y: snap(c.y - h / 2, true) } : i));
        } else {
          setItemsAndSave(p => [...p, { id, type: "image", src: url, x: snap(c.x - w / 2, true), y: snap(c.y - h / 2, true), w, h, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, z: maxZ(p) + 1, radius: 2, rotation: 0 }]);
        }
        resolve(id);
      };
      img.onerror = (e) => { if (onError) onError(); reject(e); };
      img.src = url;
    });
  };

  // Add a GIF with a 320×240 placeholder, then load real dimensions in background
  const addGifToCanvas = (url, opts = {}) => {
    const id = uid();
    const c = viewCenter();
    const defaultW = snap(320, true), defaultH = snap(240, true);
    setItemsAndSave(p => [...p, { id, type: "image", isGif: true, src: url, x: snap(c.x - defaultW / 2, true), y: snap(c.y - defaultH / 2, true), w: defaultW, h: defaultH, z: maxZ(p) + 1, radius: 2, rotation: 0 }]);
    addImageToCanvas(url, { id, ...opts });
  };

  // Client-side preprocessing: apply upload-preset resize to a still image and
  // re-encode as WebP lossless. Returns a new File ready for upload, or null
  // if no preprocessing is needed (caller should upload the original).
  const preprocessStillForUpload = async (file, preset) => {
    if (!preset || preset === 'orig') return null;
    const bmp = await createImageBitmap(file);
    const longEdge = Math.max(bmp.width, bmp.height);
    const scale = presetToScale(preset, longEdge);
    if (scale === null || scale >= 1) { bmp.close?.(); return null; }
    const targetW = Math.max(1, Math.round(bmp.width * scale));
    const targetH = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, targetW, targetH);
    bmp.close?.();
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/webp', 1));
    const filename = (file.name || 'image').replace(/\.[^.]+$/, '') + '.webp';
    return new File([blob], filename, { type: 'image/webp' });
  };

  // Client-side preprocessing for GIF uploads: decode frames via ImageDecoder,
  // optionally apply upload-preset resize, encode as animated WebP lossless.
  // Any failure here (unsupported decoder, malformed GIF, encode OOM) returns
  // null so the caller can fall back to uploading the original GIF.
  const preprocessGifForUpload = async (file, preset) => {
    try {
      const decoded = await decodeGifFrames(file);
      if (!decoded) return null;
      let canvasW = decoded.width, canvasH = decoded.height;
      const scale = presetToScale(preset, Math.max(canvasW, canvasH));
      if (scale !== null && scale > 0 && scale < 1) {
        canvasW = Math.max(1, Math.round(canvasW * scale));
        canvasH = Math.max(1, Math.round(canvasH * scale));
      }
      const frames = decoded.frames.map((f) => ({
        canvas: (f.canvas.width === canvasW && f.canvas.height === canvasH)
          ? f.canvas
          : fitOntoCanvas(f.canvas, f.canvas.width, f.canvas.height, canvasW, canvasH),
        durationMs: f.durationMs,
      }));
      const blob = await encodeAnimatedWebp(frames, { lossless: true, loopCount: 0 });
      const filename = (file.name || 'animation').replace(/\.[^.]+$/, '') + '.webp';
      return new File([blob], filename, { type: 'image/webp' });
    } catch (err) {
      console.warn('GIF→animated WebP conversion failed, falling back to GIF:', err);
      return null;
    }
  };

  const handleFilesRef = useRef(null);

  const handleFiles = async (files, uploadPreset = 'orig') => {
    files = Array.from(files);
    if (!files.length) return;
    const total = files.length;
    let done = 0;
    let hadError = false;
    setUploadStatus(`Uploading 0/${total}...`);

    const CONCURRENT_UPLOADS = 4;
    for (let i = 0; i < files.length; i += CONCURRENT_UPLOADS) {
      const batch = files.slice(i, i + CONCURRENT_UPLOADS);
      await Promise.all(batch.map(async (file) => {
        try {
          if (isVideoFile(file)) {
            setUploadStatus(`Converting video${total > 1 ? ` (${done + 1}/${total})` : ''}...`);
            const { blob, width, height } = await convertVideoToWebm(file, (progress) => {
              setUploadStatus(`Converting video ${Math.round(progress * 100)}%${total > 1 ? ` (${done + 1}/${total})` : ''}`);
            });
            setUploadStatus(`Uploading video${total > 1 ? ` (${done + 1}/${total})` : ''}...`);
            const webmFilename = file.name.replace(/\.[^.]+$/, '.webm');
            const { url } = await uploadVideo(blob, webmFilename);
            const { w, h } = fitForDisplay(width, height);
            const c = viewCenter();
            setItemsAndSave(p => [...p, {
              id: uid(), type: "video", src: url,
              x: snap(c.x - w / 2, true), y: snap(c.y - h / 2, true),
              w, h, naturalWidth: width, naturalHeight: height,
              z: maxZ(p) + 1, radius: 2, rotation: 0,
            }]);
          } else {
            const isGif = file.type === "image/gif";
            let toUpload = file;
            let uploadedAsAnimatedWebp = false;
            if (isGif) {
              setUploadStatus(`Converting GIF${total > 1 ? ` (${done + 1}/${total})` : ''}...`);
              const converted = await preprocessGifForUpload(file, uploadPreset);
              if (converted) { toUpload = converted; uploadedAsAnimatedWebp = true; }
              // If converted is null, browser can't decode — fall back to GIF.
            } else {
              const resized = await preprocessStillForUpload(file, uploadPreset);
              if (resized) toUpload = resized;
            }
            const { url } = await uploadImage(toUpload);
            if (isGif || uploadedAsAnimatedWebp) {
              // Use DOM overlay path so animation plays (img element, not GPU texture).
              addGifToCanvas(url);
            } else {
              await addImageToCanvas(url);
            }
          }
          done++;
          setUploadStatus(`Uploading ${done}/${total}...`);
        } catch (err) {
          hadError = true;
          done++;
          setUploadStatus(err.message || "Upload failed");
        }
      }));
    }

    if (!hadError) setUploadStatus("");
    else setTimeout(() => setUploadStatus(""), 4000);
  };

  handleFilesRef.current = handleFiles;

  const handleFileUpload = (filesOrEvent, uploadPreset) => {
    // Toolbar calls with (FileList, preset); drop/paste callers pass a FileList.
    const files = filesOrEvent?.target ? filesOrEvent.target.files : filesOrEvent;
    handleFiles(files, uploadPreset);
  };

  // Animated maker hand-off: takes an encoded animated WebP Blob, uploads it to
  // R2, and places it on the canvas at 1/4 natural size like any other image.
  const handleAnimatedEncoded = async (blob) => {
    setUploadStatus('Uploading animation...');
    try {
      const file = new File([blob], `animated-${Date.now()}.webp`, { type: 'image/webp' });
      const { url } = await uploadImage(file);
      addGifToCanvas(url);
      setUploadStatus('');
    } catch (err) {
      console.error('Animated upload failed:', err);
      setUploadStatus(err.message || 'Upload failed');
      setTimeout(() => setUploadStatus(''), 4000);
    }
  };

  // Clipboard paste (Ctrl-V) — images from system clipboard take priority, then board clipboard
  const clipboardRef = useRef(clipboard);
  useEffect(() => { clipboardRef.current = clipboard; }, [clipboard]);

  useEffect(() => {
    if (!isAdmin) return;
    const onPaste = (e) => {
      if (isTyping()) return;
      const imageFiles = Array.from(e.clipboardData?.items ?? [])
        .filter(item => item.kind === "file" && item.type.startsWith("image/"))
        .map(item => item.getAsFile())
        .filter(Boolean);
      if (imageFiles.length) {
        e.preventDefault();
        handleFilesRef.current(imageFiles);
        return;
      }
      // Fall back to pasting board-copied items
      const boardClip = clipboardRef.current;
      if (boardClip.length === 0) return;
      e.preventDefault();
      const c = viewCenter();
      const pasted = pasteItems(boardClip, c, maxZ(items));
      setItemsAndSave(p => [...p, ...pasted]);
      setSelectedIds(pasted.map(i => i.id));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [isAdmin, items, viewCenter, setItemsAndSave, setSelectedIds]);

  // ── Item creation ──
  const addText = () => {
    const c = viewCenter();
    const item = { id: uid(), type: "text", x: snap(c.x - 104, true), y: snap(c.y - 24, true), w: 208, h: 48, z: maxZ(items) + 1, rotation: 0,
      text: "Dolor ipsum per existentiam manet, sed creatio vulneribus insanabilibus medetur.", placeholder: true, fontSize: 24, fontFamily: FONTS[0].value,
      color: "#C2C0B6", bgColor: "transparent", radius: 0, bold: false, italic: false, align: "left", noiseEnabled: false, noiseOpacity: 0.2 };
    setItemsAndSave(p => [...p, item]); setSelectedIds([item.id]);
  };

  const addLink = () => {
    const c = viewCenter();
    const item = { id: uid(), type: "link", x: snap(c.x - 80, true), y: snap(c.y - 24, true), w: 160, h: 48, z: maxZ(items) + 1, rotation: 0,
      text: "Click me", url: "https://", fontSize: 15, fontFamily: FONTS[0].value,
      color: "#141413", bgColor: "#2C84DB", radius: 8, bold: true, italic: false, align: "center", noiseEnabled: false, noiseOpacity: 0.2 };
    setItemsAndSave(p => [...p, item]); setSelectedIds([item.id]);
  };

  const addShape = (preset) => {
    const c = viewCenter();
    const item = { id: uid(), type: "shape", x: snap(c.x - preset.w / 2, true), y: snap(c.y - preset.h / 2, true),
      w: preset.w, h: preset.h, z: maxZ(items) + 1, rotation: 0, bgColor: "#262624", radius: preset.radius ?? 4, borderColor: "transparent", borderWidth: 0, noiseEnabled: false, noiseOpacity: 0.2 };
    setItemsAndSave(p => [...p, item]); setSelectedIds([item.id]);
  };

  const addConnector = () => {
    const c = viewCenter();
    const item = { id: uid(), type: "connector", z: maxZ(items) + 1,
      x1: snap(c.x - 80, effectiveSnap), y1: snap(c.y - 40, effectiveSnap),
      x2: snap(c.x + 80, effectiveSnap), y2: snap(c.y + 40, effectiveSnap),
      elbowX: snap(c.x, effectiveSnap), elbowY: snap(c.y, effectiveSnap),
      orientation: "h", roundness: 20, lineWidth: 2, lineColor: "#C2C0B6",
      dot1: true, dot2: true, dotColor: "#C2C0B6", dotRadius: 5 };
    setItemsAndSave(p => [...p, item]); setSelectedIds([item.id]);
  };

  const handleAddImageUrl = () => {
    const url = prompt("Enter image URL:");
    if (url) {
      const isGif = isGifSrc(url);
      const onError = () => { setUploadStatus(`Failed to load ${isGif ? "GIF" : "image"} from URL`); setTimeout(() => setUploadStatus(""), 4000); };
      if (isGif) {
        addGifToCanvas(url, { onError });
      } else {
        addImageToCanvas(url, { onError });
      }
    }
  };

  // ── Board import/export/cleanup ──
  const handleFullBackup = useCallback(async () => {
    setUploadStatus("Preparing backup...");
    try {
      const { board, images } = await getBackupManifest();
      setUploadStatus(`Downloading ${images.length} image${images.length !== 1 ? 's' : ''}...`);
      const { zipBlob, downloaded, failed } = await createBackupZip(board, images, downloadImageViaProxy, (done, total) => {
        setUploadStatus(`Downloading images ${done}/${total}...`);
      });
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = `lutz-board-backup-${date}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setUploadStatus(failed > 0 ? `Backup done (${downloaded} images, ${failed} failed)` : `Backup done (${downloaded} images)`);
    } catch (err) {
      console.error("Backup failed:", err);
      setUploadStatus("Backup failed");
    }
    setTimeout(() => setUploadStatus(""), 4000);
  }, []);

  const importBoard = (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = "";

    if (file.name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
      if (!confirm("Restore from backup ZIP? This will replace the current board and re-upload all images to R2.")) return;
      setUploadStatus("Restoring backup...");
      restoreFromZip(file, restoreImageKey, (done, total) => {
        setUploadStatus(`Restoring images ${done}/${total}...`);
      }).then(({ board, restored, failed, total }) => {
        setItemsAndSave(migrateItems(board.items || []));
        if (board.palette && Array.isArray(board.palette)) setPalette(board.palette);
        if (board.bgGrid) setBgGrid(board.bgGrid);
        if (board.homeView) vp.homeViewRef.current = board.homeView;
        setTimeout(() => goHome(), 100);
        setUploadStatus(failed > 0 ? `Restored! ${restored}/${total} images (${failed} failed)` : `Restored! ${restored} images`);
        setTimeout(() => setUploadStatus(""), 5000);
      }).catch(err => {
        console.error("Restore failed:", err);
        setUploadStatus(`Restore failed: ${err.message}`);
        setTimeout(() => setUploadStatus(""), 5000);
      });
      return;
    }

    // Legacy JSON import
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target.result);
        const rawItems = Array.isArray(d) ? d : d?.items;
        if (!Array.isArray(rawItems)) { alert("Invalid board file"); return; }
        setItemsAndSave(migrateItems(rawItems));
        if (d?.palette && Array.isArray(d.palette)) setPalette(d.palette);
        setTimeout(() => goHome(), 100);
      } catch (err) { alert("Invalid board file"); }
    };
    reader.readAsText(file);
  };

  const handleCleanup = async () => {
    setUploadStatus("Cleaning up...");
    try {
      const result = await cleanupFiles(items);
      setUploadStatus(`Cleaned ${result.deleted || 0} files`);
    }
    catch { setUploadStatus("Cleanup failed"); }
    setTimeout(() => setUploadStatus(""), 3000);
  };

  const resizeImage = async (imageItems, scale) => {
    const list = Array.isArray(imageItems) ? imageItems : [imageItems];
    const total = list.length;
    let done = 0;
    setUploadStatus(`Resizing 0/${total}...`);
    let hadError = false;
    for (const item of list) {
      try {
        const { url } = await serverResize(item.src, scale);
        updateItem(item.id, {
          src: url,
          // Update natural dimensions to reflect the resized image
          naturalWidth: Math.round((item.naturalWidth || item.w) * scale),
          naturalHeight: Math.round((item.naturalHeight || item.h) * scale),
          // Clear mipmaps — new ones will auto-generate for resized src
          srcQ50: null, srcQ25: null, srcQ12: null, srcQ6: null,
          displaySrc: null, placeholderSrc: null, targetSrc: null,
        });
        done++;
        setUploadStatus(`Resizing ${done}/${total}...`);
      } catch (err) {
        console.error("Resize failed:", err);
        hadError = true;
        done++;
      }
    }
    setUploadStatus(hadError ? "Some resizes failed" : `Resized ${total} to ${Math.round(scale * 100)}%`);
    setTimeout(() => setUploadStatus(""), 3000);
  };

  const updatePaletteColor = (index, newColor) => {
    const oldColor = palette[index];
    setPalette(p => p.map((x, j) => j === index ? newColor : x));
    if (oldColor === newColor) return;
    setItemsAndSave(prev => prev.map(item => {
      const updates = {};
      for (const prop of COLOR_PROPS) { if (item[prop] === oldColor) updates[prop] = newColor; }
      return Object.keys(updates).length ? { ...item, ...updates } : item;
    }));
  };

  const openColorPicker = (e, value, onChange) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setColorPicker({ x: Math.min(rect.left, window.innerWidth - 190), bottomY: window.innerHeight - rect.top + 6, value, onChange });
  };

  const sortedItems = useMemo(() => [...items].sort((a, b) => a.z - b.z), [items]);

  // ── Loading screen ──
  if (loading) return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#141413", color: "rgba(194,192,182,0.3)", fontFamily: FONT, fontSize: 14 }}>Loading board...</div>
  );

  // ── Main render ──
  return (
    <div
      style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative", isolation: "isolate", background: bgGrid.bgColor, fontFamily: FONT, userSelect: "none" }}
      onDragOver={(e) => { if (isAdmin) e.preventDefault(); }}
      onDrop={(e) => {
        if (!isAdmin) return;
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
        if (files.length) handleFilesRef.current(files);
      }}
    >
      {/* Canvas */}
      <div ref={canvasRef} onPointerDown={handlePointerDown}
        style={{ width: "100%", height: "100%", cursor: dragging ? "move" : rotating ? "grabbing" : "grab", position: "relative", overflow: "hidden", touchAction: "none", zIndex: Z.CANVAS, isolation: "isolate" }}>

        {/* Media overlay — DOM video/img elements sit behind the WebGPU canvas.
            Transparent matte cutouts in the canvas let them show through. */}
        <div ref={overlayRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden", zIndex: 0 }} />

        {/* WebGPU canvas — renders grid + all content items + matte cutouts */}
        <canvas ref={webgl.setCanvasRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", imageRendering: "auto", zIndex: 1 }} />

        {isAdmin && (
          <div style={{ position: "absolute", top: 0, left: 0, zIndex: Z.HANDLES, pointerEvents: "none" }}>
            <div ref={canvasHandlesRef} style={{ transform: `translate(${vp.panRef.current.x}px,${vp.panRef.current.y}px) scale(${vp.zoomRef.current})`, transformOrigin: "0 0", '--inv-zoom': 1 / vp.zoomRef.current }}>
              {sortedItems.map(item => <CanvasItem key={item.id} item={item} selectedIds={selectedIds} isAdmin={isAdmin} editingTextId={editingTextId} updateItem={updateItem} setEditingTextId={setEditingTextId} />)}
            </div>
          </div>
        )}

        {items.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "rgba(194,192,182,0.15)", pointerEvents: "none" }}>
            <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.02em" }}>lutz.work</div>
            <div style={{ fontSize: 14 }}>{isAdmin ? "Upload images or add items" : "Nothing here yet"}</div>
          </div>
        )}

        {boxSelect && (() => {
          const x = Math.min(boxSelect.startX, boxSelect.currentX);
          const y = Math.min(boxSelect.startY, boxSelect.currentY);
          const w = Math.abs(boxSelect.currentX - boxSelect.startX);
          const h = Math.abs(boxSelect.currentY - boxSelect.startY);
          return (
            <div style={{ position: "absolute", left: x, top: y, width: w, height: h, border: "1px solid rgba(44,132,219,0.8)", background: "rgba(44,132,219,0.08)", borderRadius: 2, pointerEvents: "none", zIndex: Z.HANDLES + 2 }} />
          );
        })()}
      </div>

      {/* Zoom controls + Coordinates */}
      <div data-ui style={{ position: "absolute", bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", left: "calc(16px + env(safe-area-inset-left, 0px))", zIndex: Z.UI, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={tbSurface}>
          <button onClick={goHome} title="Home view" style={tbBtn}><HomeIcon /></button>
          <div ref={posDisplayRef} style={{ ...infoText, height: 32, padding: "0 10px", whiteSpace: "pre", lineHeight: 1.35, fontSize: 10, display: "flex", alignItems: "center" }}>X 0{"\n"}Y 0</div>
        </div>
        <div style={tbSurface}>
          <button onClick={() => zoomTo(vp.zoomRef.current * 1.3)} style={tbBtn}><ZoomInIcon /></button>
          <button onClick={() => zoomTo(vp.zoomRef.current / 1.3)} style={tbBtn}><ZoomOutIcon /></button>
          {isAdmin && <button onClick={() => setSnapOn(!snapOn)} title={snapOn ? "Grid snap ON" : "Grid snap OFF"} style={snapOn ? { ...tbBtn, background: "rgba(44,132,219,0.12)", color: "#2C84DB" } : tbBtn}><GridIcon /></button>}
          <div style={tbSep} />
          <button ref={zoomDisplayRef} onClick={() => {
            const rect = canvasRef.current.getBoundingClientRect();
            const cx = (rect.width / 2 - vp.panRef.current.x) / vp.zoomRef.current;
            const cy = (rect.height / 2 - vp.panRef.current.y) / vp.zoomRef.current;
            animateTo({ x: rect.width / 2 - cx, y: rect.height / 2 - cy }, 1, 500);
          }} style={{ padding: "0 9px", ...infoText, background: "none", border: "none", cursor: "pointer" }}>100%</button>
        </div>
      </div>

      {/* Left panel — Copy/Paste/Delete · Undo/Redo · Selection/Group, stacked */}
      {isAdmin && (() => {
        const selItems = items.filter(i => selectedIds.includes(i.id));
        const gid = selItems[0]?.groupId;
        const isGroup = !!(gid && selItems.every(i => i.groupId === gid));
        return (
          <div data-ui style={{ position: "absolute", top: "calc(16px + env(safe-area-inset-top, 0px))", left: "calc(16px + env(safe-area-inset-left, 0px))", zIndex: Z.UI }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={tbSurface}>
                <button onClick={handleCopySelected} title="Copy" style={{ ...tbBtn, color: selectedIds.length > 0 ? "#6e6e6e" : "#2a2a2a" }}><CopyIcon /></button>
                <button onClick={handlePasteClipboard} title="Paste" style={{ ...tbBtn, color: clipboard.length > 0 ? "#6e6e6e" : "#2a2a2a" }}><PasteIcon /></button>
                <button onClick={handleDeleteSelected} title="Delete" style={{ ...tbBtn, color: selectedIds.length > 0 ? "#FE8181" : "#262624" }}><TrashIcon /></button>
              </div>
              <div style={tbSurface}>
                <button onClick={undo} title="Undo (Ctrl+Z)" style={{ ...tbBtn, color: canUndo() ? "#6e6e6e" : "#2a2a2a", pointerEvents: canUndo() ? "auto" : "none" }}><UndoIcon /></button>
                <button onClick={redo} title="Redo (Ctrl+Shift+Z)" style={{ ...tbBtn, color: canRedo() ? "#6e6e6e" : "#2a2a2a", pointerEvents: canRedo() ? "auto" : "none" }}><RedoIcon /></button>
                <div style={{ ...tbBtn, position: "relative", pointerEvents: "none" }}>
                  <FloppyIcon style={{ color: "#262624" }} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: saveStatus === "saved" || saveStatus === "error" ? 1 : 0,
                    transition: saveStatus === "saved" || saveStatus === "error" ? "opacity 0.2s ease" : "opacity 0.6s ease 0.3s",
                    color: saveStatus === "error" ? "#FE8181" : "#65BB30" }}>
                    <FloppyIcon />
                  </div>
                </div>
              </div>
              {selectedIds.length > 0 && (
                <div style={{ ...tbSurface, display: "grid", gridTemplateColumns: "32px 32px", gap: 1, placeItems: "center" }}>
                  <span style={{ ...tbBtn, cursor: "default", pointerEvents: "none", fontSize: 12, fontWeight: 600 }}>{selectedIds.length}</span>
                  {selectedIds.length >= 2 && !isGroup
                    ? <button onClick={groupSelected} title="Group" style={{ ...tbBtn, color: "#6e6e6e" }}><GroupIcon size={16} /></button>
                    : isGroup
                      ? <button onClick={ungroupSelected} title="Ungroup" style={{ ...tbBtn, color: "#6e6e6e" }}><UngroupIcon size={16} /></button>
                      : <span />}
                  <button onClick={bringToFront} title="Bring to Front" style={{ ...tbBtn, color: "#6e6e6e" }}><BringFrontIcon /></button>
                  <button onClick={sendToBack} title="Send to Back" style={{ ...tbBtn, color: "#6e6e6e" }}><SendBackIcon /></button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Upload status pill */}
      {isAdmin && uploadStatus && (
        <div style={{ position: "absolute", bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", zIndex: Z.UI, background: UI_BG, border: UI_BORDER, borderRadius: 20, padding: "4px 14px", fontSize: 11, fontFamily: FONT, letterSpacing: "0.02em", color: "rgba(194,192,182,0.38)" }}>
          {uploadStatus}
        </div>
      )}

      <Toolbar
        isAdmin={isAdmin}
        onAddText={addText} onAddLink={addLink} onAddShape={addShape} onAddConnector={addConnector}
        onFileUpload={handleFileUpload} onAddImageUrl={handleAddImageUrl}
        onAnimatedEncoded={handleAnimatedEncoded}
        setUploadStatus={setUploadStatus}
        onExportBoard={handleFullBackup} onImportBoard={importBoard} onCleanup={handleCleanup}
        onLock={() => { logout(); setIsAdmin(false); setSelectedIds([]); setEditingTextId(null); }}
        onShowLogin={() => setShowLogin(true)}
        snapOn={snapOn} setSnapOn={setSnapOn}
        globalShadow={globalShadow} setGlobalShadow={setGlobalShadow}
        palette={palette} setPalette={setPalette} updatePaletteColor={updatePaletteColor}
        bgGrid={bgGrid} setBgGrid={setBgGrid}
        onSetHome={() => { setHome(); scheduleSave(); }}
        fileInputRef={fileInputRef} boardFileRef={boardFileRef}
      />

      {settingTeleport && (
        <div data-ui style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: Z.TELEPORT, ...tbSurface, padding: "6px 12px", gap: 8 }}>
          <span style={{ color: "rgba(194,192,182,0.45)", fontSize: 11, whiteSpace: "nowrap" }}>Pan to destination</span>
          <button data-ui onClick={() => { updateItem(settingTeleport, { teleportPan: { ...vp.panRef.current }, teleportZoom: vp.zoomRef.current }); setSettingTeleport(null); }}
            style={{ ...togBtn, width: "auto", padding: "3px 12px", fontSize: 11, background: "rgba(194,192,182,0.15)" }}>Apply</button>
          <button data-ui onClick={() => setSettingTeleport(null)}
            style={{ ...togBtn, width: "auto", padding: "3px 10px", fontSize: 11 }}>Cancel</button>
        </div>
      )}

      <PropertiesPanel
        isAdmin={isAdmin}
        selectedIds={selectedIds}
        items={items}
        openColorPicker={openColorPicker}
        updateItems={updateItems}
        updateItem={updateItem}
        ungroupSelected={ungroupSelected}
        resizeImage={resizeImage}
        setUploadStatus={setUploadStatus}
        setSettingTeleport={setSettingTeleport}
        collapsed={propertiesCollapsed}
        setCollapsed={setPropertiesCollapsed}
      />

      <ColorPickerPopup colorPicker={colorPicker} setColorPicker={setColorPicker} palette={palette} />
      <LoginModal showLogin={showLogin} setShowLogin={setShowLogin} password={password} setPassword={setPassword} loginError={loginError} setLoginError={setLoginError} handleLogin={handleLogin} rateLimited={rateLimited} setRateLimited={setRateLimited} />
    </div>
  );
}
