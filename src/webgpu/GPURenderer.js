// Main WebGPU renderer for the infinite canvas.
// Renders: grid background, all content items, selection outlines, connectors.

import {
  GRID_SHADER, QUAD_SHADER, MATTE_SHADER, LINE_SHADER, CIRCLE_SHADER, BLUR_SHADER, BLIT_SHADER,
  GRID_UNIFORM_SIZE, QUAD_UNIFORM_SIZE, LINE_UNIFORM_SIZE, CIRCLE_UNIFORM_SIZE, BLUR_UNIFORM_SIZE,
} from './shaders.js';
import { TextureCache } from './TextureCache.js';
import { TextRenderer } from './TextRenderer.js';
import { PillRenderer } from './PillRenderer.js';
import { hexToRgb, isGifSrc } from '../utils.js';

function hexToRgba(hex, alpha = 1) {
  return [...hexToRgb(hex), alpha];
}

export const SUPERSAMPLE = 2;
const MAX_QUAD_DRAWS = 1024;
const MAX_LINE_DRAWS = 512;
const MAX_CIRCLE_DRAWS = 1024;
const MAX_BLUR_ITEMS = 32;
const BLUR_STEP = 4; // pixel spacing between Gaussian blur taps

export class GPURenderer {
  constructor(canvas, device, context) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this._onNeedsRedraw = null;

    this.texCache = new TextureCache(device, () => {
      if (this._onNeedsRedraw) this._onNeedsRedraw();
    });
    this.textRenderer = new TextRenderer(device);
    this.pillRenderer = new PillRenderer(device);

    this._align = Math.max(256, device.limits.minUniformBufferOffsetAlignment);
    this._bindGroupCache = new WeakMap(); // GPUTextureView → GPUBindGroup

    // Blur effect: world-res textures + intermediates for Gaussian blur (zoom-independent)
    this._blurTextures = new Map(); // itemId → { texture, view, intTexture, intView, width, height }
    this._blurSnapshot = null; // canvas-sized snapshot for one-frame-delay blur

    this._initPipelines();
    this._initBuffers();
  }

  // ── Pipeline creation ──────────────────────────────────────────────────────

  _initPipelines() {
    const device = this.device;
    const format = this.format;

    const vertexLayout = {
      arrayStride: 8,
      attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
    };

    const blendAlpha = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };

    // ── Grid ──
    const gridModule = device.createShaderModule({ code: GRID_SHADER });
    this._gridBGL = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    this.gridPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._gridBGL] }),
      vertex: { module: gridModule, entryPoint: 'vs_main', buffers: [vertexLayout] },
      fragment: { module: gridModule, entryPoint: 'fs_main', targets: [{ format, blend: blendAlpha }] },
    });

    // ── Quad ──
    const quadModule = device.createShaderModule({ code: QUAD_SHADER });
    this._quadBGL0 = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } }],
    });
    this._quadBGL1 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const quadLayout = device.createPipelineLayout({ bindGroupLayouts: [this._quadBGL0, this._quadBGL1] });
    this.quadPipeline = device.createRenderPipeline({
      layout: quadLayout,
      vertex: { module: quadModule, entryPoint: 'vs_main', buffers: [vertexLayout] },
      fragment: { module: quadModule, entryPoint: 'fs_main', targets: [{ format, blend: blendAlpha }] },
    });

    // ── Matte (transparent cutout for media DOM overlay) ──
    const matteModule = device.createShaderModule({ code: MATTE_SHADER });
    const blendMatte = {
      color: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    this.mattePipeline = device.createRenderPipeline({
      layout: quadLayout, // same layout as quad — reuses bind groups
      vertex: { module: matteModule, entryPoint: 'vs_main', buffers: [vertexLayout] },
      fragment: { module: matteModule, entryPoint: 'fs_main', targets: [{ format, blend: blendMatte }] },
    });

    // ── Line ──
    const lineModule = device.createShaderModule({ code: LINE_SHADER });
    this._lineBGL = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } }],
    });
    this.linePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._lineBGL] }),
      vertex: { module: lineModule, entryPoint: 'vs_main', buffers: [vertexLayout] },
      fragment: { module: lineModule, entryPoint: 'fs_main', targets: [{ format, blend: blendAlpha }] },
    });

    // ── Circle ──
    const circleModule = device.createShaderModule({ code: CIRCLE_SHADER });
    this._circleBGL = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } }],
    });
    this.circlePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._circleBGL] }),
      vertex: { module: circleModule, entryPoint: 'vs_main', buffers: [vertexLayout] },
      fragment: { module: circleModule, entryPoint: 'fs_main', targets: [{ format, blend: blendAlpha }] },
    });

    // ── Blur + Blit (shared bind group layout: dynamic uniform + texture/sampler) ──
    this._blurBGL0 = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } }],
    });
    const blurBlitLayout = device.createPipelineLayout({ bindGroupLayouts: [this._blurBGL0, this._quadBGL1] });

    const blurModule = device.createShaderModule({ code: BLUR_SHADER });
    this.blurPipeline = device.createRenderPipeline({
      layout: blurBlitLayout,
      vertex: { module: blurModule, entryPoint: 'vs_main', buffers: [vertexLayout] },
      fragment: { module: blurModule, entryPoint: 'fs_main', targets: [{ format }] },
    });

    const blitModule = device.createShaderModule({ code: BLIT_SHADER });
    this.blitPipeline = device.createRenderPipeline({
      layout: blurBlitLayout,
      vertex: { module: blitModule, entryPoint: 'vs_main', buffers: [vertexLayout] },
      fragment: { module: blitModule, entryPoint: 'fs_main', targets: [{ format }] },
    });
  }

  // ── Buffer creation ────────────────────────────────────────────────────────

  _initBuffers() {
    const device = this.device;
    const A = this._align;

    // Static vertex buffers
    this.quadVertBuf = this._createStaticVB(new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]));
    this.gridVertBuf = this._createStaticVB(new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]));

    // Uniform buffers (dynamic offsets for per-draw data)
    this.gridUniformBuf = device.createBuffer({ size: GRID_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.quadUniformBuf = device.createBuffer({ size: A * MAX_QUAD_DRAWS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.lineUniformBuf = device.createBuffer({ size: A * MAX_LINE_DRAWS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.circleUniformBuf = device.createBuffer({ size: A * MAX_CIRCLE_DRAWS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Dynamic line vertex buffer (resized as needed)
    this.lineVertBuf = device.createBuffer({ size: 4096, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.lineVertBufSize = 4096;

    // Bind groups for non-dynamic pipelines
    this.gridBindGroup = device.createBindGroup({ layout: this._gridBGL, entries: [{ binding: 0, resource: { buffer: this.gridUniformBuf } }] });
    this.quadBindGroup = device.createBindGroup({ layout: this._quadBGL0, entries: [{ binding: 0, resource: { buffer: this.quadUniformBuf, size: QUAD_UNIFORM_SIZE } }] });
    this.lineBindGroup = device.createBindGroup({ layout: this._lineBGL, entries: [{ binding: 0, resource: { buffer: this.lineUniformBuf, size: LINE_UNIFORM_SIZE } }] });
    this.circleBindGroup = device.createBindGroup({ layout: this._circleBGL, entries: [{ binding: 0, resource: { buffer: this.circleUniformBuf, size: CIRCLE_UNIFORM_SIZE } }] });

    // Fallback texture bind group (used when no texture is bound)
    this._fallbackTexBG = this._getTexBindGroup(this.texCache.fallback.view, this.texCache.nearestSampler);

    // Blur/blit uniform buffer: packed [blit, H-dir, V-dir] triples for up to MAX_BLUR_ITEMS elements
    this._blurDirUniformBuf = device.createBuffer({ size: A * MAX_BLUR_ITEMS * 3, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this._blurDirBindGroup = device.createBindGroup({ layout: this._blurBGL0, entries: [{ binding: 0, resource: { buffer: this._blurDirUniformBuf, size: BLUR_UNIFORM_SIZE } }] });
  }

  _createStaticVB(data) {
    const buf = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buf, 0, data);
    return buf;
  }

  _getTexBindGroup(view, sampler) {
    let bg = this._bindGroupCache.get(view);
    if (bg) return bg;
    bg = this.device.createBindGroup({
      layout: this._quadBGL1,
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: sampler },
      ],
    });
    this._bindGroupCache.set(view, bg);
    return bg;
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

  resize() {
    const dpr = (window.devicePixelRatio || 1) * SUPERSAMPLE;
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    }
  }

  // ── Main render ────────────────────────────────────────────────────────────

  render({ items, panX, panY, zoom, bgGrid, globalShadow, selectedIds, editingTextId }) {
    this._overlays = []; // media overlay data for DOM positioning
    const device = this.device;
    const dpr = (window.devicePixelRatio || 1) * SUPERSAMPLE;
    const A = this._align;

    this.resize();

    const canvasW = this.canvas.width;
    const canvasH = this.canvas.height;
    if (canvasW === 0 || canvasH === 0) return;

    const cssW = canvasW / dpr;
    const cssH = canvasH / dpr;

    const bgRgb = hexToRgb(bgGrid.bgColor || '#141413');

    // DPR-scaled viewport values (used by blur passes and main render)
    const panDpr = panX * dpr;
    const panDprY = panY * dpr;
    const zoomDpr = zoom * dpr;
    const resW = cssW * dpr;
    const resH = cssH * dpr;

    // ── Phase 0: Pre-allocate blur textures at world-pixel resolution (zoom-independent) ──
    const sorted = [...items].sort((a, b) => a.z - b.z);
    this._currentSorted = sorted; // available to _findMediaBehind
    const blurItems = sorted.filter(i => i.bgBlur && i.type !== 'connector');

    const blurMeta = new Map(); // itemId → { blurW, blurH, idx }
    let blurIdx = 0;
    for (const item of blurItems) {
      if (item.w <= 0 || item.h <= 0) continue;
      const blurW = Math.max(2, Math.ceil(item.w));
      const blurH = Math.max(2, Math.ceil(item.h));
      this._getOrCreateBlurTexture(item.id, blurW, blurH);
      blurMeta.set(item.id, { blurW, blurH, idx: blurIdx++ });
    }
    const activeBlurIds = new Set(blurItems.map(i => i.id));
    this._cleanupBlurTextures(activeBlurIds);

    // ── Phase 1: Collect all draw commands ──

    const quadDraws = [];   // { uniforms: Float32Array(40), texView, sampler }
    const lineDraws = [];   // { uniforms: Float32Array(12), verts: Float32Array }
    const circleDraws = []; // { uniforms: Float32Array(12) }

    const selSet = new Set(selectedIds || []);

    // Viewport culling
    const marginX = cssW * 0.25 / zoom;
    const marginY = cssH * 0.25 / zoom;
    const vpLeft = -panX / zoom - marginX;
    const vpTop = -panY / zoom - marginY;
    const vpRight = (cssW - panX) / zoom + marginX;
    const vpBottom = (cssH - panY) / zoom + marginY;

    const contentDrawOrder = [];
    let firstBlurEntryIdx = -1; // index in contentDrawOrder of the first blur element

    for (const item of sorted) {
      if (item.type === 'connector') {
        const cL = Math.min(item.x1, item.x2), cT = Math.min(item.y1, item.y2);
        const cR = Math.max(item.x1, item.x2), cB = Math.max(item.y1, item.y2);
        if (cR < vpLeft || cL > vpRight || cB < vpTop || cT > vpBottom) continue;
        const ls = lineDraws.length, cs = circleDraws.length;
        this._collectConnector(item, panDpr, panDprY, zoomDpr, resW, resH, lineDraws, circleDraws);
        contentDrawOrder.push({ lineStart: ls, lineEnd: lineDraws.length, circleStart: cs, circleEnd: circleDraws.length });
      } else {
        if (item.x + item.w < vpLeft || item.x > vpRight || item.y + item.h < vpTop || item.y > vpBottom) continue;
        if (firstBlurEntryIdx < 0 && blurMeta.has(item.id)) {
          firstBlurEntryIdx = contentDrawOrder.length;
        }
        const qs = quadDraws.length;
        this._collectItem(item, panDpr, panDprY, zoomDpr, resW, resH, globalShadow, editingTextId, quadDraws);
        // Selection outline immediately after the item (same z-layer)
        if (selSet.has(item.id)) {
          this._collectSelection(item, panDpr, panDprY, zoomDpr, resW, resH, quadDraws);
        }
        contentDrawOrder.push({ quadStart: qs, quadEnd: quadDraws.length });
      }
    }

    // ── Phase 1b: Collect overlay draws (handles, pills, group box) ──
    // Separate arrays for correct layering: content → overlay quads → overlay lines → overlay circles
    const oQuads = [];    // group box, info pills
    const oLines = [];    // rotation rods
    const oCircles = [];  // handle dots, knobs

    for (const item of sorted) {
      if (!selSet.has(item.id)) continue;
      if (item.type === 'connector') {
        const cL = Math.min(item.x1, item.x2), cT = Math.min(item.y1, item.y2);
        const cR = Math.max(item.x1, item.x2), cB = Math.max(item.y1, item.y2);
        if (cR < vpLeft || cL > vpRight || cB < vpTop || cT > vpBottom) continue;
        this._collectConnectorHandles(item, panDpr, panDprY, zoomDpr, resW, resH, oCircles);
      } else {
        if (item.x + item.w < vpLeft || item.x > vpRight || item.y + item.h < vpTop || item.y > vpBottom) continue;
        this._collectItemHandles(item, panDpr, panDprY, zoomDpr, resW, resH, oLines, oCircles);
        if (item.type === 'image' || item.type === 'video') {
          this._collectInfoPill(item, panDpr, panDprY, zoomDpr, resW, resH, oQuads);
        }
      }
    }
    this._collectGroupBox(items, selectedIds, panDpr, panDprY, zoomDpr, resW, resH, oQuads);

    // Combine content + overlay into unified arrays for uniform upload
    const cQuadCount = quadDraws.length;
    const cLineCount = lineDraws.length;
    const cCircleCount = circleDraws.length;

    const allQuads = oQuads.length > 0 ? [...quadDraws, ...oQuads] : quadDraws;
    const allLines = oLines.length > 0 ? [...lineDraws, ...oLines] : lineDraws;
    const allCircles = oCircles.length > 0 ? [...circleDraws, ...oCircles] : circleDraws;

    // ── Phase 2: Upload uniform data ──

    // Grid uniforms
    const gridData = new Float32Array(32);
    gridData[0] = panDpr; gridData[1] = panDprY;
    gridData[2] = zoomDpr;
    gridData[4] = canvasW; gridData[5] = canvasH;
    gridData.set([bgRgb[0], bgRgb[1], bgRgb[2], 1], 8);
    if (bgGrid.enabled) {
      const d1 = bgGrid.dot1;
      const d1c = hexToRgb(d1.color);
      const fade = zoom >= 1 ? 1 : zoom <= 0.5 ? 0 : (zoom - 0.5) / 0.5;
      gridData.set([d1c[0], d1c[1], d1c[2], 1], 12);
      gridData[16] = d1.opacity * fade; gridData[17] = d1.size;
      gridData[18] = d1.softness; gridData[19] = d1.spacing;
      const d2 = bgGrid.dot2;
      const d2on = d2?.enabled ? 1 : 0;
      if (d2on) {
        const d2c = hexToRgb(d2.color);
        gridData.set([d2c[0], d2c[1], d2c[2], 1], 20);
        gridData[24] = 1; gridData[25] = d2.opacity * fade;
        gridData[26] = d2.size; gridData[27] = d2.softness;
        gridData[28] = d2.spacing;
      }
    }
    device.queue.writeBuffer(this.gridUniformBuf, 0, gridData);

    // Quad uniforms (packed into aligned slots)
    if (allQuads.length > 0) {
      const quadBuf = new ArrayBuffer(A * allQuads.length);
      for (let i = 0; i < allQuads.length; i++) {
        new Float32Array(quadBuf, A * i, 40).set(allQuads[i].uniforms);
      }
      device.queue.writeBuffer(this.quadUniformBuf, 0, new Uint8Array(quadBuf));
    }

    // Line uniforms
    if (allLines.length > 0) {
      const lineBuf = new ArrayBuffer(A * allLines.length);
      for (let i = 0; i < allLines.length; i++) {
        new Float32Array(lineBuf, A * i, 12).set(allLines[i].uniforms);
      }
      device.queue.writeBuffer(this.lineUniformBuf, 0, new Uint8Array(lineBuf));

      // Concatenate all line vertices
      let totalVerts = 0;
      for (const d of allLines) totalVerts += d.verts.length;
      const allVerts = new Float32Array(totalVerts);
      let offset = 0;
      for (const d of allLines) {
        allVerts.set(d.verts, offset);
        d._vertOffset = offset / 2; // in vertices
        d._vertCount = d.verts.length / 2;
        offset += d.verts.length;
      }
      const neededBytes = allVerts.byteLength;
      if (neededBytes > this.lineVertBufSize) {
        this.lineVertBuf.destroy();
        this.lineVertBufSize = neededBytes * 2;
        this.lineVertBuf = device.createBuffer({ size: this.lineVertBufSize, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      }
      device.queue.writeBuffer(this.lineVertBuf, 0, allVerts);
    }

    // Circle uniforms
    if (allCircles.length > 0) {
      const circleBuf = new ArrayBuffer(A * allCircles.length);
      for (let i = 0; i < allCircles.length; i++) {
        new Float32Array(circleBuf, A * i, 12).set(allCircles[i].uniforms);
      }
      device.queue.writeBuffer(this.circleUniformBuf, 0, new Uint8Array(circleBuf));
    }

    // Blur/blit uniforms: packed [blit, H-dir, V-dir] triples per blur element
    if (blurIdx > 0) {
      const blurDirBuf = new ArrayBuffer(A * blurIdx * 3);
      for (const [itemId, meta] of blurMeta) {
        const item = blurItems.find(i => i.id === itemId);
        // Slot 0: blit srcRect (UV coordinates in canvas texture)
        const blit = new Float32Array(blurDirBuf, A * (meta.idx * 3), 4);
        blit[0] = (item.x * zoomDpr + panDpr) / canvasW;  // srcOrigin.x
        blit[1] = (item.y * zoomDpr + panDprY) / canvasH; // srcOrigin.y
        blit[2] = item.w * zoomDpr / canvasW;              // srcSize.x
        blit[3] = item.h * zoomDpr / canvasH;              // srcSize.y
        // Slot 1: H blur direction
        const hDir = new Float32Array(blurDirBuf, A * (meta.idx * 3 + 1), 4);
        hDir[0] = BLUR_STEP / meta.blurW;
        // Slot 2: V blur direction
        const vDir = new Float32Array(blurDirBuf, A * (meta.idx * 3 + 2), 4);
        vDir[1] = BLUR_STEP / meta.blurH;
      }
      device.queue.writeBuffer(this._blurDirUniformBuf, 0, new Uint8Array(blurDirBuf));
    }

    // ── Phase 3: Build and submit command buffer ──

    let canvasTexture;
    try {
      canvasTexture = this.context.getCurrentTexture();
    } catch (e) {
      return; // context lost or canvas zero-size
    }
    const textureView = canvasTexture.createView();

    const encoder = device.createCommandEncoder();
    let pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: bgRgb[0], g: bgRgb[1], b: bgRgb[2], a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    pass.setViewport(0, 0, canvasW, canvasH, 0, 1);

    // Grid
    if (bgGrid.enabled) {
      const fade = zoom >= 1 ? 1 : zoom <= 0.5 ? 0 : (zoom - 0.5) / 0.5;
      if (fade > 0) {
        pass.setPipeline(this.gridPipeline);
        pass.setBindGroup(0, this.gridBindGroup);
        pass.setVertexBuffer(0, this.gridVertBuf);
        pass.draw(6);
      }
    }

    // ── Content layer (single split before first blur element) ──
    {
      let curPipe = null;

      const drawEntry = (entry) => {
        if (entry.quadStart !== undefined) {
          pass.setVertexBuffer(0, this.quadVertBuf);
          for (let i = entry.quadStart; i < entry.quadEnd; i++) {
            const draw = allQuads[i];
            const pipeline = draw.isMatte ? this.mattePipeline : this.quadPipeline;
            if (pipeline !== curPipe) { pass.setPipeline(pipeline); curPipe = pipeline; }
            pass.setBindGroup(0, this.quadBindGroup, [A * i]);
            pass.setBindGroup(1, draw.texBindGroup);
            pass.draw(6);
          }
        } else {
          if (entry.lineStart < entry.lineEnd) {
            if (curPipe !== this.linePipeline) { pass.setPipeline(this.linePipeline); curPipe = this.linePipeline; }
            pass.setVertexBuffer(0, this.lineVertBuf);
            for (let i = entry.lineStart; i < entry.lineEnd; i++) {
              pass.setBindGroup(0, this.lineBindGroup, [A * i]);
              pass.draw(allLines[i]._vertCount, 1, allLines[i]._vertOffset, 0);
            }
          }
          if (entry.circleStart < entry.circleEnd) {
            if (curPipe !== this.circlePipeline) { pass.setPipeline(this.circlePipeline); curPipe = this.circlePipeline; }
            pass.setVertexBuffer(0, this.quadVertBuf);
            for (let i = entry.circleStart; i < entry.circleEnd; i++) {
              pass.setBindGroup(0, this.circleBindGroup, [A * i]);
              pass.draw(6);
            }
          }
        }
      };

      // Where to split: right before the first blur element (or end if none)
      const splitIdx = (blurIdx > 0 && firstBlurEntryIdx >= 0) ? firstBlurEntryIdx : contentDrawOrder.length;

      // Draw content below first blur element
      for (let ei = 0; ei < splitIdx; ei++) drawEntry(contentDrawOrder[ei]);

      // Snapshot canvas → compute blur textures → resume
      if (blurIdx > 0 && firstBlurEntryIdx >= 0) {
        pass.end();

        this._getOrCreateSnapshot(canvasW, canvasH);
        encoder.copyTextureToTexture(
          { texture: canvasTexture },
          { texture: this._blurSnapshot },
          [canvasW, canvasH],
        );
        const snapshotBG = this._getTexBindGroup(this._blurSnapshotView, this.texCache.linearSampler);

        for (const [itemId, meta] of blurMeta) {
          const blurTex = this._blurTextures.get(itemId);
          if (!blurTex) continue;
          const blitOff = meta.idx * 3 * A;

          // Blit: downsample snapshot rect into world-res blur texture
          const blitP = encoder.beginRenderPass({
            colorAttachments: [{ view: blurTex.view, loadOp: 'clear', clearValue: { r: bgRgb[0], g: bgRgb[1], b: bgRgb[2], a: 1 }, storeOp: 'store' }],
          });
          blitP.setViewport(0, 0, meta.blurW, meta.blurH, 0, 1);
          blitP.setPipeline(this.blitPipeline);
          blitP.setBindGroup(0, this._blurDirBindGroup, [blitOff]);
          blitP.setBindGroup(1, snapshotBG);
          blitP.setVertexBuffer(0, this.quadVertBuf);
          blitP.draw(6);
          blitP.end();

          // 4-pass Gaussian blur (H→int, V→tex, H→int, V→tex)
          const texBgA = this._getTexBindGroup(blurTex.view, this.texCache.linearSampler);
          const texBgB = this._getTexBindGroup(blurTex.intView, this.texCache.linearSampler);
          const hOff = blitOff + A;
          const vOff = blitOff + A * 2;

          const bp = (targetView, srcBg, dirOff) => {
            const p = encoder.beginRenderPass({
              colorAttachments: [{ view: targetView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
            });
            p.setViewport(0, 0, meta.blurW, meta.blurH, 0, 1);
            p.setPipeline(this.blurPipeline);
            p.setBindGroup(0, this._blurDirBindGroup, [dirOff]);
            p.setBindGroup(1, srcBg);
            p.setVertexBuffer(0, this.quadVertBuf);
            p.draw(6);
            p.end();
          };

          bp(blurTex.intView, texBgA, hOff);  // H: tex→int
          bp(blurTex.view, texBgB, vOff);     // V: int→tex
          bp(blurTex.intView, texBgA, hOff);  // H: tex→int
          bp(blurTex.view, texBgB, vOff);     // V: int→tex
        }

        // Resume canvas pass (single loadOp:'load' — not per-element)
        pass = encoder.beginRenderPass({
          colorAttachments: [{ view: textureView, loadOp: 'load', storeOp: 'store' }],
        });
        pass.setViewport(0, 0, canvasW, canvasH, 0, 1);
        curPipe = null;
      }

      // Draw remaining content (blur elements and items above)
      for (let ei = splitIdx; ei < contentDrawOrder.length; ei++) drawEntry(contentDrawOrder[ei]);
    }

    // ── Overlay layer (handles, pills, group box — rendered on top of content) ──

    // Overlay quads (group bounding box, info pills)
    if (oQuads.length > 0) {
      pass.setPipeline(this.quadPipeline);
      pass.setVertexBuffer(0, this.quadVertBuf);
      for (let i = cQuadCount; i < allQuads.length; i++) {
        pass.setBindGroup(0, this.quadBindGroup, [A * i]);
        pass.setBindGroup(1, allQuads[i].texBindGroup);
        pass.draw(6);
      }
    }

    // Overlay lines (rotation rods)
    if (oLines.length > 0) {
      pass.setPipeline(this.linePipeline);
      pass.setVertexBuffer(0, this.lineVertBuf);
      const oLineEnd = cLineCount + oLines.length;
      for (let i = cLineCount; i < oLineEnd; i++) {
        pass.setBindGroup(0, this.lineBindGroup, [A * i]);
        pass.draw(allLines[i]._vertCount, 1, allLines[i]._vertOffset, 0);
      }
    }

    // Overlay circles (handle dots border+fill, knobs, delete circles)
    if (oCircles.length > 0) {
      pass.setPipeline(this.circlePipeline);
      pass.setVertexBuffer(0, this.quadVertBuf);
      for (let i = cCircleCount; i < allCircles.length; i++) {
        pass.setBindGroup(0, this.circleBindGroup, [A * i]);
        pass.draw(6);
      }
    }

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // ── Collect draw commands ──────────────────────────────────────────────────

  _collectItem(item, panX, panY, zoom, resW, resH, globalShadow, editingTextId, draws) {
    if (editingTextId === item.id && item.type !== 'text' && item.type !== 'link') return;

    const hasShadow = globalShadow?.enabled && this._itemShadowEnabled(item);
    const shadowSize = hasShadow ? (globalShadow.size || 1.5) : 0;
    const shadowPad = hasShadow ? shadowSize * 5 : 0;

    const u = new Float32Array(40);
    u[0] = resW; u[1] = resH;
    u[2] = panX; u[3] = panY;
    u[4] = zoom;
    u[5] = (item.rotation || 0) * Math.PI / 180;
    u[6] = item.radius ?? 2;
    u[7] = 1.0; // opacity
    u[8] = item.x; u[9] = item.y;
    u[10] = item.w; u[11] = item.h;
    u[12] = item.w + shadowPad * 2; u[13] = item.h + shadowPad * 2;
    u[14] = shadowPad; u[15] = shadowPad;
    // color [16-19], texCrop [20-23] set below
    u[20] = 0; u[21] = 0; u[22] = 1; u[23] = 1; // default texCrop

    // Border
    const borderWidth = item.borderWidth || 0;
    u[32] = borderWidth;
    if (borderWidth > 0 && item.borderColor && item.borderColor !== 'transparent') {
      u.set(hexToRgba(item.borderColor), 24);
    }

    // Shadow
    u[34] = hasShadow ? 1 : 0;
    u[35] = shadowSize;
    u[36] = globalShadow?.opacity ?? 0.1;
    u[37] = 0; // isSelection
    u[38] = 0; // textAlpha

    let texView = null;
    let sampler = this.texCache.nearestSampler;

    // ── Blur element: matte cutout + blur texture as background ──
    // Blur effect is always 100% opaque. Opacity slider controls only the
    // colored fill overlay drawn on top of the blur.
    if (item.bgBlur) {
      const blurTex = this._blurTextures.get(item.id);
      if (blurTex) {
        // Pass 1: shadow + border quad (full opacity, transparent fill)
        u[33] = 0; u.set([0, 0, 0, 0], 16);
        draws.push({ uniforms: new Float32Array(u), texBindGroup: this._fallbackTexBG, isMatte: false });

        // Pass 2: matte cutout at blur element bounds (always full punch-through)
        const mu = new Float32Array(40);
        mu[0] = resW; mu[1] = resH;
        mu[2] = panX; mu[3] = panY;
        mu[4] = zoom;
        mu[5] = (item.rotation || 0) * Math.PI / 180;
        mu[6] = item.radius ?? 2;
        mu[7] = 1.0;
        mu[8] = item.x; mu[9] = item.y;
        mu[10] = item.w; mu[11] = item.h;
        mu[12] = item.w + 2; mu[13] = item.h + 2;
        mu[14] = 1; mu[15] = 1;
        draws.push({ uniforms: mu, texBindGroup: this._fallbackTexBG, isMatte: true });

        // Pass 3: blur texture quad (always full opacity)
        const bu = new Float32Array(u);
        bu[12] = item.w; bu[13] = item.h;
        bu[14] = 0; bu[15] = 0;
        bu[33] = 1; // textured
        bu[34] = 0; // no shadow
        bu.set([1, 1, 1, 1], 16);
        bu[20] = 0; bu[21] = 0; bu[22] = 1; bu[23] = 1;
        const blurTexBG = this._getTexBindGroup(blurTex.view, this.texCache.linearSampler);
        draws.push({ uniforms: bu, texBindGroup: blurTexBG, isMatte: false });

        // Pass 4: colored fill overlay (bgColor at bgOpacity — the only thing opacity controls)
        const bgColor = this._getBgColor(item);
        if (bgColor[3] > 0) {
          const fu = new Float32Array(u);
          fu[12] = item.w; fu[13] = item.h;
          fu[14] = 0; fu[15] = 0;
          fu[33] = 0; fu[34] = 0;
          fu.set(bgColor, 16);
          draws.push({ uniforms: fu, texBindGroup: this._fallbackTexBG, isMatte: false });
        }

        // CSS backdrop-filter overlay for live media blurring (always full opacity)
        const mediaBehind = this._findMediaBehind(item);
        if (mediaBehind.length > 0) {
          this._overlays.push({
            id: item.id,
            type: 'blur-video',
            x: item.x, y: item.y,
            w: item.w, h: item.h,
            rotation: item.rotation || 0,
            radius: item.radius ?? 2,
            z: item.z,
            opacity: 1,
            blurRadius: 12,
          });
        }

        // Pass 5: text glyph overlay (full opacity)
        if ((item.type === 'text' || item.type === 'link') && editingTextId !== item.id) {
          const entry = this.textRenderer.get(item);
          const textRgba = hexToRgba(item.color || '#C2C0B6');
          const tu = new Float32Array(u);
          tu[12] = item.w; tu[13] = item.h;
          tu[14] = 0; tu[15] = 0;
          tu[33] = 0; tu[34] = 0; tu[38] = 1;
          tu.set(textRgba, 28);
          const textTexBG = this._getTexBindGroup(entry.view, this.textRenderer.sampler);
          draws.push({ uniforms: tu, texBindGroup: textTexBG, isMatte: false });
        }
        return;
      }
    }

    if (item.type === 'image' || item.type === 'video') {
      const isGif = item.type === 'image' && (item.isGif || isGifSrc(item.src));
      const isMedia = item.type === 'video' || isGif;

      if (isMedia) {
        // ── Media item (video/GIF): shadow/border quad + matte cutout ──
        // Content rendered via DOM overlay, not GPU texture.
        u[33] = 0; // not textured
        u.set([0, 0, 0, 0], 16); // transparent content (shadow/border only)

        // Pass 1: shadow + border (normal blend)
        draws.push({ uniforms: new Float32Array(u), texBindGroup: this._fallbackTexBG, isMatte: false });

        // Pass 2: matte cutout (erases framebuffer inside rounded rect)
        const mu = new Float32Array(40);
        mu[0] = resW; mu[1] = resH;
        mu[2] = panX; mu[3] = panY;
        mu[4] = zoom;
        mu[5] = (item.rotation || 0) * Math.PI / 180;
        mu[6] = item.radius ?? 2;
        mu[7] = 1.0; // opacity
        mu[8] = item.x; mu[9] = item.y;
        mu[10] = item.w; mu[11] = item.h;
        // No shadow padding for the matte — just 1px AA margin
        mu[12] = item.w + 2; mu[13] = item.h + 2;
        mu[14] = 1; mu[15] = 1;
        draws.push({ uniforms: mu, texBindGroup: this._fallbackTexBG, isMatte: true });

        // Record overlay data for DOM element positioning
        this._overlays.push({
          id: item.id,
          type: item.type === 'video' ? 'video' : 'gif',
          src: item.src,
          x: item.x, y: item.y,
          w: item.w, h: item.h,
          rotation: item.rotation || 0,
          radius: item.radius ?? 2,
          z: item.z,
        });
        return;
      }

      // ── Static image — GPU texture path ──
      const target = item.targetSrc || item.displaySrc || item.src;
      const allTiers = [item.src, item.srcQ50, item.srcQ25, item.srcQ12, item.srcQ6];
      const seen = new Set();
      const candidates = [];
      for (const c of [target, ...allTiers]) {
        if (c && !seen.has(c)) { seen.add(c); candidates.push(c); }
      }
      const entry = this.texCache.getBestReady(candidates, item.pixelated).entry;
      const isReady = entry.ready !== false;
      u[33] = isReady ? 1 : 0;
      const texW = entry.width || item.naturalWidth || item.w;
      const texH = entry.height || item.naturalHeight || item.h;
      const crop = this.texCache.coverUV(texW, texH, item.w, item.h);
      u[20] = crop[0]; u[21] = crop[1]; u[22] = crop[2]; u[23] = crop[3];
      u.set(isReady ? [1, 1, 1, 1] : [0, 0, 0, 0], 16);
      texView = entry.view;
    } else if (item.type === 'text' || item.type === 'link') {
      const isEditing = editingTextId === item.id;
      const bgColor = this._getBgColor(item);

      // Pass 1: background fill
      if (bgColor[3] > 0) {
        const u1 = new Float32Array(u);
        u1[33] = 0; // not textured
        u1.set(bgColor, 16);
        draws.push({ uniforms: u1, texBindGroup: this._fallbackTexBG });
      }

      // Pass 2: glyph mask (skip during editing)
      if (!isEditing) {
        const entry = this.textRenderer.get(item);
        const textRgba = hexToRgba(item.color || '#C2C0B6');
        const u2 = new Float32Array(u);
        u2[33] = 0; // not textured (using textAlpha mode)
        u2[34] = 0; // no shadow on text pass
        u2[38] = 1; // textAlpha
        u2.set(textRgba, 28); // textColor
        const texBG = this._getTexBindGroup(entry.view, this.textRenderer.sampler);
        draws.push({ uniforms: u2, texBindGroup: texBG });
      }
      return;
    } else if (item.type === 'shape') {
      u[33] = 0;
      u.set(this._getBgColor(item), 16);
    } else {
      return;
    }

    const texBG = texView
      ? this._getTexBindGroup(texView, sampler)
      : this._fallbackTexBG;
    draws.push({ uniforms: u, texBindGroup: texBG });
  }

  _collectSelection(item, panX, panY, zoom, resW, resH, draws) {
    const pad = 3;
    const u = new Float32Array(40);
    u[0] = resW; u[1] = resH;
    u[2] = panX; u[3] = panY;
    u[4] = zoom;
    u[5] = (item.rotation || 0) * Math.PI / 180;
    u[6] = (item.radius ?? 2) + 1;
    u[7] = 1.0;
    u[8] = item.x; u[9] = item.y;
    u[10] = item.w; u[11] = item.h;
    u[12] = item.w + pad * 2; u[13] = item.h + pad * 2;
    u[14] = pad; u[15] = pad;
    u[20] = 0; u[21] = 0; u[22] = 1; u[23] = 1;
    u[37] = 1; // isSelection
    draws.push({ uniforms: u, texBindGroup: this._fallbackTexBG });
  }

  _collectConnector(item, panX, panY, zoom, resW, resH, lineDraws, circleDraws) {
    const { x1, y1, x2, y2, lineWidth = 2, lineColor = '#C2C0B6',
            dot1 = true, dot2 = true, dotColor = '#C2C0B6', dotRadius = 5 } = item;
    const elbowX = item.elbowX ?? (x1 + x2) / 2;
    const elbowY = item.elbowY ?? (y1 + y2) / 2;
    const orient = item.orientation || 'h';
    const roundness = item.roundness ?? 20;

    const points = this._connectorPoints(x1, y1, x2, y2, elbowX, elbowY, orient, roundness);
    const lineVerts = this._thickLineVerts(points, lineWidth / 2);

    if (lineVerts.length > 0) {
      const u = new Float32Array(12);
      u[0] = resW; u[1] = resH;
      u[2] = panX; u[3] = panY;
      u[4] = zoom;
      u.set(hexToRgba(lineColor), 8);
      lineDraws.push({ uniforms: u, verts: new Float32Array(lineVerts) });
    }

    const addCircle = (cx, cy) => {
      const u = new Float32Array(12);
      u[0] = resW; u[1] = resH;
      u[2] = panX; u[3] = panY;
      u[4] = zoom; u[5] = dotRadius;
      u[6] = cx; u[7] = cy;
      u.set(hexToRgba(dotColor), 8);
      circleDraws.push({ uniforms: u });
    };
    if (dot1) addCircle(x1, y1);
    if (dot2) addCircle(x2, y2);
  }

  // ── Geometry helpers (pure math, copied from GLRenderer) ───────────────────

  _connectorPoints(x1, y1, x2, y2, elbowX, elbowY, orient, roundness) {
    const pts = [];
    if (orient === 'h') {
      const vertDist = Math.abs(y2 - y1);
      const halfVert = vertDist / 2;
      const s1 = Math.sign(elbowX - x1) || 1;
      const s2 = Math.sign(x2 - elbowX) || 1;
      const sv = Math.sign(y2 - y1) || 1;
      const r1 = Math.max(0, Math.min(Math.abs(elbowX - x1), halfVert, roundness));
      const r2 = Math.max(0, Math.min(Math.abs(x2 - elbowX), halfVert, roundness));
      if (vertDist < 1) return [[x1, y1], [x2, y2]];
      pts.push([x1, y1]);
      if (r1 >= 0.5) {
        pts.push([elbowX - s1 * r1, y1]);
        this._arcPoints(pts, elbowX - s1 * r1, y1, elbowX, y1 + sv * r1, elbowX - s1 * r1, y1 + sv * r1, r1, 8);
      } else { pts.push([elbowX, y1]); }
      if (r2 >= 0.5) {
        pts.push([elbowX, y2 - sv * r2]);
        this._arcPoints(pts, elbowX, y2 - sv * r2, elbowX + s2 * r2, y2, elbowX + s2 * r2, y2 - sv * r2, r2, 8);
      } else { pts.push([elbowX, y2]); }
      pts.push([x2, y2]);
    } else {
      const hRun = Math.abs(x2 - x1);
      const halfH = hRun / 2;
      const sv1 = Math.sign(elbowY - y1) || 1;
      const sv2 = Math.sign(y2 - elbowY) || 1;
      const sh = Math.sign(x2 - x1) || 1;
      const r1 = Math.max(0, Math.min(Math.abs(elbowY - y1), halfH, roundness));
      const r2 = Math.max(0, Math.min(Math.abs(y2 - elbowY), halfH, roundness));
      pts.push([x1, y1]);
      if (r1 >= 0.5) {
        pts.push([x1, elbowY - sv1 * r1]);
        this._arcPoints(pts, x1, elbowY - sv1 * r1, x1 + sh * r1, elbowY, x1 + sh * r1, elbowY - sv1 * r1, r1, 8);
      } else { pts.push([x1, elbowY]); }
      if (r2 >= 0.5) {
        pts.push([x2 - sh * r2, elbowY]);
        this._arcPoints(pts, x2 - sh * r2, elbowY, x2, elbowY + sv2 * r2, x2 - sh * r2, elbowY + sv2 * r2, r2, 8);
      } else { pts.push([x2, elbowY]); }
      pts.push([x2, y2]);
    }
    return pts;
  }

  _arcPoints(pts, sx, sy, ex, ey, cx, cy, r, steps) {
    const startAngle = Math.atan2(sy - cy, sx - cx);
    const endAngle = Math.atan2(ey - cy, ex - cx);
    let delta = endAngle - startAngle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const a = startAngle + delta * t;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }

  _thickLineVerts(points, halfWidth) {
    if (points.length < 2) return [];
    const verts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) continue;
      const nx = -dy / len * halfWidth;
      const ny = dx / len * halfWidth;
      verts.push(ax+nx, ay+ny, ax-nx, ay-ny, bx+nx, by+ny, bx+nx, by+ny, ax-nx, ay-ny, bx-nx, by-ny);
    }
    for (const [px, py] of points) {
      const segments = 8;
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        verts.push(px, py, px + Math.cos(a0) * halfWidth, py + Math.sin(a0) * halfWidth, px + Math.cos(a1) * halfWidth, py + Math.sin(a1) * halfWidth);
      }
    }
    return verts;
  }

  _itemShadowEnabled(item) {
    return item.shadow ?? (item.type !== 'shape' && item.type !== 'text');
  }

  /** Find video/GIF items below a blur element that intersect its bounds. */
  _findMediaBehind(blurItem) {
    if (!this._currentSorted) return [];
    const result = [];
    for (const item of this._currentSorted) {
      if (item.z >= blurItem.z) break;
      if (item.type === 'connector') continue;
      const isGif = item.type === 'image' && (item.isGif || isGifSrc(item.src));
      const isMedia = item.type === 'video' || isGif;
      if (!isMedia) continue;
      // Intersection test
      if (item.x + item.w < blurItem.x || item.x > blurItem.x + blurItem.w) continue;
      if (item.y + item.h < blurItem.y || item.y > blurItem.y + blurItem.h) continue;
      result.push({
        id: item.id,
        type: item.type === 'video' ? 'video' : 'gif',
        src: item.src,
        x: item.x, y: item.y,
        w: item.w, h: item.h,
        rotation: item.rotation || 0,
        radius: item.radius ?? 2,
        z: item.z,
      });
    }
    return result;
  }

  _getBgColor(item) {
    if (!item.bgColor || item.bgColor === 'transparent') return [0, 0, 0, 0];
    const op = item.bgOpacity ?? 1;
    if (op <= 0) return [0, 0, 0, 0];
    return [...hexToRgb(item.bgColor), op];
  }

  // ── Blur: offscreen 1:1 background capture + Gaussian blur ────────────────

  _getOrCreateBlurTexture(id, width, height) {
    const existing = this._blurTextures.get(id);
    if (existing && existing.width === width && existing.height === height) return existing;
    if (existing) {
      existing.texture.destroy();
      existing.intTexture.destroy();
    }
    const texture = this.device.createTexture({
      size: [width, height],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const intTexture = this.device.createTexture({
      size: [width, height],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const entry = { texture, view: texture.createView(), intTexture, intView: intTexture.createView(), width, height };
    this._blurTextures.set(id, entry);
    return entry;
  }

  _cleanupBlurTextures(activeIds) {
    for (const [id, entry] of this._blurTextures) {
      if (!activeIds.has(id)) {
        entry.texture.destroy();
        entry.intTexture.destroy();
        this._blurTextures.delete(id);
      }
    }
    // Destroy snapshot when no blur items remain
    if (activeIds.size === 0 && this._blurSnapshot) {
      this._blurSnapshot.destroy();
      this._blurSnapshot = null;
      this._blurSnapshotView = null;
    }
  }

  _getOrCreateSnapshot(width, height) {
    if (this._blurSnapshot && this._blurSnapshotW === width && this._blurSnapshotH === height) return;
    if (this._blurSnapshot) this._blurSnapshot.destroy();
    this._blurSnapshot = this.device.createTexture({
      size: [width, height],
      format: this.format,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    this._blurSnapshotView = this._blurSnapshot.createView();
    this._blurSnapshotW = width;
    this._blurSnapshotH = height;
  }

  // ── Overlay collection (handles, pills, group box) ────────────────────────

  _collectItemHandles(item, panDpr, panDprY, zoomDpr, resW, resH, oLines, oCircles) {
    const rot = (item.rotation || 0) * Math.PI / 180;
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const rp = (px, py) => [
      cx + (px - cx) * cosR - (py - cy) * sinR,
      cy + (px - cx) * sinR + (py - cy) * cosR,
    ];

    const BLUE = [0.173, 0.518, 0.859, 0.85];
    const BLUE_ROD = [0.173, 0.518, 0.859, 0.7];
    const FILL = [0.761, 0.753, 0.714, 1.0];

    const addCircle = (wcx, wcy, radius, color) => {
      const u = new Float32Array(12);
      u[0] = resW; u[1] = resH; u[2] = panDpr; u[3] = panDprY;
      u[4] = zoomDpr; u[5] = radius; u[6] = wcx; u[7] = wcy;
      u.set(color, 8);
      oCircles.push({ uniforms: u });
    };
    const addBordered = (wcx, wcy, r, bw, fill, border) => {
      addCircle(wcx, wcy, r + bw, border);
      addCircle(wcx, wcy, r, fill);
    };

    // Rotation rod: from top-center down to 1px above item, up to rod end
    const rodStart = rp(cx, item.y - 1);
    const rodEnd = rp(cx, item.y - 37);
    const rodVerts = this._thickLineVerts([rodStart, rodEnd], 0.75);
    if (rodVerts.length > 0) {
      const u = new Float32Array(12);
      u[0] = resW; u[1] = resH; u[2] = panDpr; u[3] = panDprY; u[4] = zoomDpr;
      u.set(BLUE_ROD, 8);
      oLines.push({ uniforms: u, verts: new Float32Array(rodVerts) });
    }

    // Rotation knob
    const [knobX, knobY] = rp(cx, item.y - 42);
    addBordered(knobX, knobY, 7, 1.5, FILL, BLUE);

    // 4 corner handles
    const corners = [[item.x, item.y], [item.x + item.w, item.y],
                     [item.x, item.y + item.h], [item.x + item.w, item.y + item.h]];
    for (const [lx, ly] of corners) {
      const [wx, wy] = rp(lx, ly);
      addBordered(wx, wy, 4.5, 1.5, FILL, BLUE);
    }

    // 4 edge midpoint handles
    const mids = [[cx, item.y], [cx, item.y + item.h],
                  [item.x, cy], [item.x + item.w, cy]];
    for (const [lx, ly] of mids) {
      const [wx, wy] = rp(lx, ly);
      addBordered(wx, wy, 4.5, 1.5, FILL, BLUE);
    }

  }

  _collectConnectorHandles(item, panDpr, panDprY, zoomDpr, resW, resH, oCircles) {
    const { x1, y1, x2, y2 } = item;
    const elbowX = item.elbowX ?? (x1 + x2) / 2;
    const elbowY = item.elbowY ?? (y1 + y2) / 2;
    const orient = item.orientation || 'h';
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const handleX = orient === 'h' ? elbowX : midX;
    const handleY = orient === 'h' ? midY : elbowY;

    const BLUE = [0.173, 0.518, 0.859, 0.85];
    const FILL = [0.761, 0.753, 0.714, 1.0];

    const addCircle = (wcx, wcy, radius, color) => {
      const u = new Float32Array(12);
      u[0] = resW; u[1] = resH; u[2] = panDpr; u[3] = panDprY;
      u[4] = zoomDpr; u[5] = radius; u[6] = wcx; u[7] = wcy;
      u.set(color, 8);
      oCircles.push({ uniforms: u });
    };

    // Elbow handle (bordered)
    addCircle(handleX, handleY, 6.5, BLUE);
    addCircle(handleX, handleY, 5, FILL);
  }

  _collectGroupBox(items, selectedIds, panDpr, panDprY, zoomDpr, resW, resH, oQuads) {
    if (!selectedIds || selectedIds.length < 2) return;
    const selSet = new Set(selectedIds);
    const selItems = items.filter(i => selSet.has(i.id));
    if (selItems.length < 2) return;
    const gid = selItems[0]?.groupId;
    if (!gid || !selItems.every(i => i.groupId === gid)) return;

    const pad = 10;
    const bounds = selItems.map(i => i.type === 'connector'
      ? { x: Math.min(i.x1, i.x2, i.elbowX ?? (i.x1 + i.x2) / 2),
          y: Math.min(i.y1, i.y2),
          r: Math.max(i.x1, i.x2, i.elbowX ?? (i.x1 + i.x2) / 2),
          b: Math.max(i.y1, i.y2) }
      : { x: i.x, y: i.y, r: i.x + i.w, b: i.y + i.h });
    const minX = Math.min(...bounds.map(b => b.x)) - pad;
    const minY = Math.min(...bounds.map(b => b.y)) - pad;
    const maxX = Math.max(...bounds.map(b => b.r)) + pad;
    const maxY = Math.max(...bounds.map(b => b.b)) + pad;
    const w = maxX - minX;
    const h = maxY - minY;

    const u = new Float32Array(40);
    u[0] = resW; u[1] = resH; u[2] = panDpr; u[3] = panDprY; u[4] = zoomDpr;
    u[5] = 0; u[6] = 6; u[7] = 1.0;
    u[8] = minX; u[9] = minY; u[10] = w; u[11] = h;
    u[12] = w; u[13] = h; u[14] = 0; u[15] = 0;
    u.set([0, 0, 0, 0], 16); // transparent fill
    u[20] = 0; u[21] = 0; u[22] = 1; u[23] = 1;
    u.set([0.173, 0.518, 0.859, 0.3], 24); // border color
    u[32] = 1; // border width
    u[33] = 0; u[34] = 0; u[37] = 0; u[38] = 0;
    oQuads.push({ uniforms: u, texBindGroup: this._fallbackTexBG });
  }

  _collectInfoPill(item, panDpr, panDprY, zoomDpr, resW, resH, oQuads) {
    const src = item.src;
    if (!src) return;
    const format = this._imgFormat(src);
    const srcType = this._imgSrcType(src);

    // Dimensions: prefer stored natural size, then look up from static image texture cache
    let dimW = item.naturalWidth || null;
    let dimH = item.naturalHeight || null;
    if (!dimW || !dimH) {
      // Videos/GIFs use DOM overlay — no GPU texture to read dimensions from.
      // Static images can fall back to texture cache.
      if (item.type !== 'video' && !item.isGif && !isGifSrc(item.src)) {
        const target = item.targetSrc || item.displaySrc || item.src;
        const tiers = [item.src, item.srcQ50, item.srcQ25, item.srcQ12, item.srcQ6];
        const seen = new Set();
        const candidates = [];
        for (const c of [target, ...tiers]) {
          if (c && !seen.has(c)) { seen.add(c); candidates.push(c); }
        }
        const entry = this.texCache.getBestReady(candidates, item.pixelated).entry;
        if (entry && entry.width > 1) {
          dimW = entry.width;
          dimH = entry.height;
        }
      }
    }

    const dimText = dimW && dimH ? `${dimW} \u00d7 ${dimH}` : null;
    const parts = [format, srcType, dimText].filter(Boolean);
    if (parts.length === 0) return;
    const text = parts.join(' \u00b7 ');

    const pill = this.pillRenderer.get(text);
    const pillLeft = item.x + item.w / 2 - pill.cssWidth / 2;
    const pillTop = item.y + item.h + 8;

    const u = new Float32Array(40);
    u[0] = resW; u[1] = resH; u[2] = panDpr; u[3] = panDprY; u[4] = zoomDpr;
    u[5] = 0; u[6] = 0; u[7] = 1.0;
    u[8] = pillLeft; u[9] = pillTop;
    u[10] = pill.cssWidth; u[11] = pill.cssHeight;
    u[12] = pill.cssWidth; u[13] = pill.cssHeight;
    u[14] = 0; u[15] = 0;
    u.set([1, 1, 1, 1], 16);
    u[20] = 0; u[21] = 0; u[22] = 1; u[23] = 1;
    u[33] = 1; // textured
    u[34] = 0; u[37] = 0; u[38] = 0;
    const texBG = this._getTexBindGroup(pill.view, this.pillRenderer.sampler);
    oQuads.push({ uniforms: u, texBindGroup: texBG });
  }

  _imgFormat(src) {
    if (!src) return null;
    if (src.startsWith('data:image/')) {
      const m = src.match(/^data:image\/(\w+)/);
      return m ? m[1].toUpperCase() : null;
    }
    const ext = src.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
    return { jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP', avif: 'AVIF', svg: 'SVG', bmp: 'BMP', webm: 'WEBM', mp4: 'MP4', mov: 'MOV' }[ext] || null;
  }

  _imgSrcType(src) {
    if (!src) return null;
    if (src.startsWith('http') && !src.includes('r2.dev')) return 'link';
    return 'stored';
  }

  destroy() {
    this.texCache.destroy();
    this.textRenderer.destroy();
    this.pillRenderer.destroy();
    for (const entry of this._blurTextures.values()) {
      entry.texture.destroy();
      entry.intTexture.destroy();
    }
    this._blurTextures.clear();
    if (this._blurSnapshot) {
      this._blurSnapshot.destroy();
      this._blurSnapshot = null;
    }
  }
}
