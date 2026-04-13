import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { ZoomInIcon, ZoomOutIcon, GridIcon, HomeIcon, FloppyIcon, UndoIcon, RedoIcon, CopyIcon, PasteIcon, TrashIcon, GroupIcon, UngroupIcon, BringFrontIcon, SendBackIcon } from './icons.jsx';

import { FONT, FONTS, DEFAULT_BG_GRID } from './constants.js';
import { loadConfiguredFonts } from './fontLibrary.js';
import { uid, snap, isTyping, pasteItems, migrateItems, applyDragDelta, isGifSrc } from './utils.js';
import { createBackupZip, restoreFromZip } from './backupRestore.js';
import { tbBtn, tbSurface, tbSep, togBtn, infoText, panelSurface, UI_BG, UI_BORDER, Z } from './styles.js';
import { CanvasItem } from './components/CanvasItem.jsx';
import { PropertiesPanel } from './components/PropertiesPanel.jsx';
import { Toolbar } from './components/Toolbar.jsx';
import { ColorPickerPopup } from './components/ColorPickerPopup.jsx';
import { LoginModal } from './components/LoginModal.jsx';
import { loadBoard, saveBoard, cleanupFiles, uploadImage, uploadVideo, login, logout, hasToken, getBackupManifest, restoreImageKey, downloadImageViaProxy, serverResize } from './api.js';
import { convertVideoToWebm, isVideoFile } from './videoUtils.js';
import { SUPERSAMPLE } from './webgpu/GPURenderer.js';
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
  const [globalShadow, setGlobalShadow] = useState(() => {
    try { const s = localStorage.getItem("lutz-shadow-settings"); return s ? JSON.parse(s) : { enabled: true, size: 1.5, opacity: 0.1 }; }
    catch { return { enabled: true, size: 1.5, opacity: 0.1 }; }
  });
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
    try { return localStorage.getItem("lutz-properties-collapsed") === "1"; }
    catch { return false; }
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
  // ── Blur video overlay (blurred video/GIF copies behind canvas, clipped to blur element bounds) ──
  const blurElsRef = useRef(new Map()); // blurId → { container, children: Map<mediaId, el> }

  const syncOverlays = useCallback((overlays, panX, panY, zoom) => {
    const container = overlayRef.current;
    if (!container) return;

    const mediaOverlays = overlays.filter(o => o.type !== 'blur-video');
    const blurVideoOverlays = overlays.filter(o => o.type === 'blur-video');

    // ── Regular media overlays (videos/GIFs — behind canvas) ──
    const activeIds = new Set(mediaOverlays.map(o => o.id));
    const els = overlayElsRef.current;

    // Remove stale elements
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
      const ss = SUPERSAMPLE;
      const invSS = 1 / ss;
      el.style.left = (screenX - screenW * (ss - 1) * 0.5) + 'px';
      el.style.top = (screenY - screenH * (ss - 1) * 0.5) + 'px';
      el.style.width = (screenW * ss) + 'px';
      el.style.height = (screenH * ss) + 'px';
      el.style.zIndex = o.z;
      el.style.borderRadius = (o.radius * zoom * ss) + 'px';
      const rot = o.rotation ? ` rotate(${o.rotation}deg)` : '';
      el.style.transform = `scale(${invSS})${rot}`;
      el.style.transformOrigin = 'center center';
    }

    // ── Blur video overlays: blurred video/GIF copies BEHIND canvas at 1/20th res ──
    // The blur texture has matte holes where videos intersect (at 1/20th res, so
    // the matte edges are naturally blurred). Behind the canvas, blurred video copies
    // sit in the same DOM layer as original videos but at higher z-index (blur
    // element's z > video's z). The container clips to the blur element's shape.
    // Result: outside blur bounds → sharp original video; inside → blurred copy.
    const activeBlurIds = new Set(blurVideoOverlays.map(o => o.id));
    const blurEls = blurElsRef.current;

    for (const [id, entry] of blurEls) {
      if (!activeBlurIds.has(id)) {
        for (const child of entry.children.values()) {
          if (child._blurRaf) cancelAnimationFrame(child._blurRaf);
        }
        entry.container.remove();
        blurEls.delete(id);
      }
    }

    const bss = SUPERSAMPLE;
    const bInvSS = 1 / bss;

    for (const o of blurVideoOverlays) {
      let entry = blurEls.get(o.id);
      if (!entry) {
        const div = document.createElement('div');
        div.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;transform-origin:center center;';
        container.appendChild(div);
        entry = { container: div, children: new Map() };
        blurEls.set(o.id, entry);
      }

      // Position behind-canvas blur container with SUPERSAMPLE math
      // (same technique as regular video overlays: ss× size + scale(invSS))
      const bScreenX = o.x * zoom + panX;
      const bScreenY = o.y * zoom + panY;
      const bScreenW = o.w * zoom;
      const bScreenH = o.h * zoom;
      const bDiv = entry.container;
      bDiv.style.left = (bScreenX - bScreenW * (bss - 1) * 0.5) + 'px';
      bDiv.style.top = (bScreenY - bScreenH * (bss - 1) * 0.5) + 'px';
      bDiv.style.width = (bScreenW * bss) + 'px';
      bDiv.style.height = (bScreenH * bss) + 'px';
      bDiv.style.zIndex = o.z;
      bDiv.style.borderRadius = (o.radius * zoom * bss) + 'px';
      const bRot = o.rotation ? ` rotate(${o.rotation}deg)` : '';
      bDiv.style.transform = `scale(${bInvSS})${bRot}`;

      // Remove stale child media
      const activeMediaIds = new Set((o.mediaBehind || []).map(m => m.id));
      for (const [mid, child] of entry.children) {
        if (!activeMediaIds.has(mid)) {
          if (child._blurRaf) cancelAnimationFrame(child._blurRaf);
          child.remove();
          entry.children.delete(mid);
        }
      }

      // Create or update blurred media copies inside the container.
      // Both videos and GIFs use <canvas> at 1/20th pixel resolution, drawing
      // from the original DOM elements (already playing in overlayElsRef).
      // Canvas pixel dimensions control rasterization → guaranteed low-res blur.
      for (const m of (o.mediaBehind || [])) {
        let mel = entry.children.get(m.id);
        if (!mel) {
          mel = document.createElement('canvas');
          mel.width = Math.max(2, Math.ceil(m.w / 20));
          mel.height = Math.max(2, Math.ceil(m.h / 20));
          mel.style.cssText = 'position:absolute;pointer-events:none;';
          const ctx = mel.getContext('2d');
          mel._blurMediaId = m.id;
          const drawFrame = () => {
            const src = overlayElsRef.current.get(mel._blurMediaId);
            if (src) {
              try { ctx.drawImage(src, 0, 0, mel.width, mel.height); } catch(e) {}
            }
            mel._blurRaf = requestAnimationFrame(drawFrame);
          };
          mel._blurRaf = requestAnimationFrame(drawFrame);
          bDiv.appendChild(mel);
          entry.children.set(m.id, mel);
        }

        // Position canvas in ss× local space (container is SUPERSAMPLE-scaled).
        // Full CSS size, low pixel resolution → bilinear upscale = blur.
        const dx = (m.x - o.x) * zoom * bss;
        const dy = (m.y - o.y) * zoom * bss;
        const mw = m.w * zoom * bss;
        const mh = m.h * zoom * bss;
        mel.style.left = dx + 'px';
        mel.style.top = dy + 'px';
        mel.style.width = mw + 'px';
        mel.style.height = mh + 'px';
        // Update pixel dimensions if element was resized
        const pw = Math.max(2, Math.ceil(m.w / 20));
        const ph = Math.max(2, Math.ceil(m.h / 20));
        if (mel.width !== pw || mel.height !== ph) { mel.width = pw; mel.height = ph; }
        const mRot = m.rotation ? `rotate(${m.rotation}deg)` : '';
        mel.style.transform = mRot || 'none';
        mel.style.borderRadius = (m.radius * zoom * bss) + 'px';
      }
    }
  }, []);

  // Cleanup overlay elements on unmount
  useEffect(() => {
    return () => {
      for (const el of overlayElsRef.current.values()) {
        if (el.tagName === 'VIDEO') { el.pause(); el.src = ''; }
        el.remove();
      }
      overlayElsRef.current.clear();
      for (const entry of blurElsRef.current.values()) {
        for (const child of entry.children.values()) {
          if (child._blurRaf) cancelAnimationFrame(child._blurRaf);
        }
        entry.container.remove();
      }
      blurElsRef.current.clear();
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
  useEffect(() => { try { localStorage.setItem("lutz-shadow-settings", JSON.stringify(globalShadow)); } catch {} }, [globalShadow]);
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
  const maxZ = (arr) => arr.length ? Math.max(...arr.map(i => i.z)) : 0;
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
  const bringToFront = () => setItemsAndSave(prev => {
    const others = prev.filter(i => !selectedIds.includes(i.id));
    const mZ = others.length ? Math.max(...others.map(i => i.z)) : 0;
    const sel = prev.filter(i => selectedIds.includes(i.id)).sort((a, b) => a.z - b.z);
    const zMap = Object.fromEntries(sel.map((item, idx) => [item.id, mZ + 1 + idx]));
    return prev.map(i => selectedIds.includes(i.id) ? { ...i, z: zMap[i.id] } : i);
  });
  const sendToBack = () => setItemsAndSave(prev => {
    const others = prev.filter(i => !selectedIds.includes(i.id));
    const mZ = others.length ? Math.min(...others.map(i => i.z)) : 0;
    const sel = prev.filter(i => selectedIds.includes(i.id)).sort((a, b) => a.z - b.z);
    const zMap = Object.fromEntries(sel.map((item, idx) => [item.id, mZ - sel.length + idx]));
    return prev.map(i => selectedIds.includes(i.id) ? { ...i, z: zMap[i.id] } : i);
  });

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
    isAdmin, selectedIds, setSelectedIds, clipboard, setClipboard,
    items, setItemsAndSave, editingTextId, setEditingTextId,
    viewCenter, setShiftHeld, undo, redo,
  });

  // ── Image upload (all conversion handled server-side) ──

  const fitTo512 = (natW, natH) => {
    const MAX = 512;
    if (natW <= MAX && natH <= MAX) return { w: natW, h: natH };
    const scale = Math.min(MAX / natW, MAX / natH);
    return { w: Math.round(natW * scale), h: Math.round(natH * scale) };
  };

  // Load image dimensions and add to canvas, fitting to 512px max
  const addImageToCanvas = (url, opts = {}) => {
    const { id: existingId, onError } = opts;
    const id = existingId || uid();
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const fit = fitTo512(img.width, img.height);
        const w = snap(fit.w, true), h = snap(fit.h, true);
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

  const handleFilesRef = useRef(null);

  const handleFiles = async (files) => {
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
            const fit = fitTo512(width, height);
            const w = snap(fit.w, true), h = snap(fit.h, true);
            const c = viewCenter();
            setItemsAndSave(p => [...p, {
              id: uid(), type: "video", src: url,
              x: snap(c.x - w / 2, true), y: snap(c.y - h / 2, true),
              w, h, naturalWidth: width, naturalHeight: height,
              z: maxZ(p) + 1, radius: 2, rotation: 0,
            }]);
          } else {
            const isGif = file.type === "image/gif";
            const { url } = await uploadImage(file);
            if (isGif) {
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

  const handleFileUpload = (e) => { handleFiles(e.target.files); e.target.value = ""; };

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
      const mZ = items.length ? Math.max(...items.map(i => i.z)) : 0;
      const pasted = pasteItems(boardClip, c, mZ);
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
      color: "#C2C0B6", bgColor: "transparent", radius: 0, bold: false, italic: false, align: "left" };
    setItemsAndSave(p => [...p, item]); setSelectedIds([item.id]);
  };

  const addLink = () => {
    const c = viewCenter();
    const item = { id: uid(), type: "link", x: snap(c.x - 80, true), y: snap(c.y - 24, true), w: 160, h: 48, z: maxZ(items) + 1, rotation: 0,
      text: "Click me", url: "https://", fontSize: 15, fontFamily: FONTS[0].value,
      color: "#141413", bgColor: "#2C84DB", radius: 8, bold: true, italic: false, align: "center" };
    setItemsAndSave(p => [...p, item]); setSelectedIds([item.id]);
  };

  const addShape = (preset) => {
    const c = viewCenter();
    const item = { id: uid(), type: "shape", x: snap(c.x - preset.w / 2, true), y: snap(c.y - preset.h / 2, true),
      w: preset.w, h: preset.h, z: maxZ(items) + 1, rotation: 0, bgColor: "#262624", radius: preset.radius ?? 4, borderColor: "transparent", borderWidth: 0 };
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
            <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.02em" }}>infgrid.com</div>
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
