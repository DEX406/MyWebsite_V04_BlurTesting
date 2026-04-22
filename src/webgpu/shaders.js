// ── WebGPU (WGSL) Shader Sources ──
// Converted from the WebGL2 GLSL ES 3.0 shaders in ../webgl/shaders.js.
//
// Uniform buffer byte sizes (for JS-side allocation):
export const GRID_UNIFORM_SIZE   = 128;
export const QUAD_UNIFORM_SIZE   = 176;
export const LINE_UNIFORM_SIZE   = 48;
export const CIRCLE_UNIFORM_SIZE = 48;
export const BLIT_UNIFORM_SIZE   = 16;
export const BLUR_UNIFORM_SIZE   = 16;

// ── Shared WGSL prelude ───────────────────────────────────────────────────────
// Helpers reused across multiple pipelines. Interpolated into each shader
// module below so every pipeline gets an identical, single source of truth.

const PRELUDE = /* wgsl */ `
// Transform a world-space point to clip-space NDC with Y-flip (WebGPU: top-left → NDC).
fn world_to_ndc(world: vec2<f32>, pan: vec2<f32>, zoom: f32, resolution: vec2<f32>) -> vec4<f32> {
let screen = world * zoom + pan;
var ndc = screen / resolution * 2.0 - 1.0;
ndc.y = -ndc.y;
return vec4<f32>(ndc, 0.0, 1.0);
}

// Signed distance from point p to a rounded box of given half-size and corner radius.
fn rounded_box_sdf(p: vec2<f32>, half_size: vec2<f32>, r: f32) -> f32 {
let q = abs(p) - half_size + r;
return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - r;
}
`;

// Quad/matte share the same uniform struct and vertex stage. Defined once
// and spliced into both shader modules to avoid layout drift.
const QUAD_UNIFORMS_WGSL = /* wgsl */ `struct QuadUniforms { resolution:     vec2<f32>,  // offset   0 pan:            vec2<f32>,  // offset   8 zoom:           f32,        // offset  16 rotation:       f32,        // offset  20 radius:         f32,        // offset  24 opacity:        f32,        // offset  28 item_pos:       vec2<f32>,  // offset  32 item_size:      vec2<f32>,  // offset  40 pad_size:       vec2<f32>,  // offset  48 pad_offset:     vec2<f32>,  // offset  56 color:          vec4<f32>,  // offset  64 tex_crop:       vec4<f32>,  // offset  80 border_color:   vec4<f32>,  // offset  96 text_color:     vec4<f32>,  // offset 112 border_width:   f32,        // offset 128 textured:       f32,        // offset 132 has_shadow:     f32,        // offset 136 shadow_size:    f32,        // offset 140 shadow_opacity: f32,        // offset 144 is_selection:   f32,        // offset 148 text_alpha:     f32,        // offset 152 noise_opacity:  f32,        // offset 156 noise_enabled:  f32,        // offset 160 _p0:            f32,        // offset 164 _p1:            f32,        // offset 168 _p2:            f32,        // offset 172 };`;

// Shared vertex stage for quad + matte. Applies local rotation around the item
// center, then world→screen→NDC.
const QUAD_VERTEX_WGSL = /* wgsl */ `
struct QuadVsOutput {
@builtin(position) pos: vec4<f32>,
@location(0) local_px: vec2<f32>,
};

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> QuadVsOutput {
var out: QuadVsOutput;
let local = a_pos * u.pad_size;
out.local_px = local;

let item_center = u.pad_offset + u.item_size * 0.5;
let c = cos(u.rotation);
let s = sin(u.rotation);
let d = local - item_center;
let rotated = item_center + vec2<f32>(d.x * c - d.y * s, d.x * s + d.y * c);

let world = (u.item_pos - u.pad_offset) + rotated;
out.pos = world_to_ndc(world, u.pan, u.zoom, u.resolution);
return out;
}
`;

// ── Grid shader ────────────────────────────────────────────────────────────────
// Renders the dot-grid background as a fullscreen quad.
// Uniform layout (128 bytes / 32 floats):
//   [0]  pan.x        [1]  pan.y
//   [2]  zoomDpr      [3]  _pad
//   [4]  resolution.x [5]  resolution.y   [6-7]  _pad
//   [8]  bgColor.r    [9]  bgColor.g      [10] bgColor.b   [11] 1.0
//   [12] d1Color.r    [13] d1Color.g      [14] d1Color.b   [15] 1.0
//   [16] d1Opacity    [17] d1Size         [18] d1Softness  [19] d1Spacing
//   [20] d2Color.r    [21] d2Color.g      [22] d2Color.b   [23] 1.0
//   [24] d2On         [25] d2Opacity      [26] d2Size      [27] d2Softness
//   [28] d2Spacing    [29-31] _pad

export const GRID_SHADER = /* wgsl */ `
${PRELUDE}

struct GridUniforms {
pan:         vec2<f32>,
zoom_dpr:    f32,
_p0:         f32,
resolution:  vec2<f32>,
_p1:         vec2<f32>,
bg_color:    vec4<f32>,
d1_color:    vec4<f32>,
d1_opacity:  f32,
d1_size:     f32,
d1_softness: f32,
d1_spacing:  f32,
d2_color:    vec4<f32>,
d2_on:       f32,
d2_opacity:  f32,
d2_size:     f32,
d2_softness: f32,
d2_spacing:  f32,
_p2:         f32,
_p3:         f32,
_p4:         f32,
};

@group(0) @binding(0) var<uniform> u: GridUniforms;

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> @builtin(position) vec4<f32> {
return vec4<f32>(a_pos, 0.0, 1.0);
}

// GLSL mod() uses floor division; WGSL % uses truncation. For negative coords
// (user panning left/up of origin) we need the floor-based version.
fn glsl_mod(x: vec2<f32>, y: f32) -> vec2<f32> {
return x - floor(x / y) * y;
}

fn dot_alpha(world: vec2<f32>, spacing: f32, size: f32, softness: f32) -> f32 {
let g = glsl_mod(world, spacing);
let d = length(min(g, vec2<f32>(spacing) - g));
let edge0 = size - 0.5;
let edge1 = select(size * (1.0 + softness * 2.0), size + 0.5, softness < 0.01);
return 1.0 - smoothstep(edge0, edge1, d);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
let screen = frag_pos.xy;
let world  = (screen - u.pan) / u.zoom_dpr;

var col = u.bg_color.rgb;

let a1 = dot_alpha(world, u.d1_spacing, u.d1_size, u.d1_softness);
col = mix(col, u.d1_color.rgb, a1 * u.d1_opacity);

if (u.d2_on > 0.5) {
let a2 = dot_alpha(world, u.d2_spacing, u.d2_size, u.d2_softness);
col = mix(col, u.d2_color.rgb, a2 * u.d2_opacity);
}

return vec4<f32>(col, 1.0);
}
`;

// ── Quad shader ────────────────────────────────────────────────────────────────
// Renders images, shapes, text, links, shadows, borders, selection outlines.
// Uniform layout (176 bytes / 44 floats) — see QuadUniforms struct for offsets.

export const QUAD_SHADER = /* wgsl */ `
${PRELUDE}
${QUAD_UNIFORMS_WGSL}

@group(0) @binding(0) var<uniform> u: QuadUniforms;
@group(1) @binding(0) var t_tex:   texture_2d<f32>;
@group(1) @binding(1) var s_tex:   sampler;
@group(1) @binding(2) var t_noise: texture_2d<f32>;
@group(1) @binding(3) var s_noise: sampler;

${QUAD_VERTEX_WGSL}

@fragment
fn fs_main(in: QuadVsOutput) -> @location(0) vec4<f32> {
let item_local = in.local_px - u.pad_offset;
let p          = item_local - u.item_size * 0.5;
let half_size  = u.item_size * 0.5;
let r          = min(u.radius, min(half_size.x, half_size.y));
let dist       = rounded_box_sdf(p, half_size, r);

// Sample texture early — must happen before any non-uniform discard so that
// screen-space derivatives are valid across the 2×2 fragment quad.
var uv = u.tex_crop.xy + (item_local / u.item_size) * u.tex_crop.zw;
uv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
let tex_sample = textureSample(t_tex, s_tex, uv);

// Anchor noise in canvas/world space, 4× denser for 1:1 sharpness at ~4× zoom.
let world_px = (in.pos.xy - u.pan) / u.zoom;
let noise_uv = (world_px * 4.0) / 512.0;
let noise_sample = textureSample(t_noise, s_noise, noise_uv);

// ── Selection outline ──
if (u.is_selection > 0.5) {
let outline_width = 1.5;
let outer_dist = rounded_box_sdf(p, half_size + outline_width, r + outline_width);
let aa_o       = 1.0 - smoothstep(-0.5, 0.5, outer_dist);
let inner      = 1.0 - smoothstep(-0.5, 0.5, dist);
let outline    = aa_o - inner;
let sel_color  = vec4<f32>(0.173, 0.518, 0.859, outline * 0.7);
if (sel_color.a < 0.01) { discard; }
return sel_color;
}

// ── Shadow ──
if (u.has_shadow > 0.5 && dist > 0.0) {
let blur = u.shadow_size * 4.67;
let shadow_alpha = u.shadow_opacity * (1.0 - smoothstep(0.0, blur, dist));
if (shadow_alpha < 0.005) { discard; }
return vec4<f32>(0.0, 0.0, 0.0, shadow_alpha * u.opacity);
}

// ── Outside rounded box ──
if (dist > 0.5) { discard; }
let aa = 1.0 - smoothstep(-0.5, 0.5, dist);

// ── Border ──
if (u.border_width > 0.0 && dist > -(u.border_width)) {
return vec4<f32>(u.border_color.rgb, u.border_color.a * aa * u.opacity);
}

// ── Content ──
var col: vec4<f32>;
if (u.text_alpha > 0.5) {
col = vec4<f32>(u.text_color.rgb, u.text_color.a * tex_sample.a);
} else if (u.textured > 0.5) {
col = tex_sample;
} else {
col = u.color;
}

if (u.noise_enabled > 0.5 && u.noise_opacity > 0.0) {
let n_alpha = noise_sample.r * u.noise_opacity;
col = vec4<f32>(mix(col.rgb, noise_sample.rgb, n_alpha), col.a);
}

return vec4<f32>(col.rgb, col.a * aa * u.opacity);
}
`;

// ── Matte shader ──────────────────────────────────────────────────────────────
// Renders transparent cutouts in the canvas for media items (videos, GIFs).
// DOM elements behind the canvas show through the cutout holes.
// Shares QuadUniforms and the quad vertex stage — same 176-byte uniform buffer
// can be bound to either pipeline without re-packing.
// Blend mode: src=zero, dst=one-minus-src-alpha → erases framebuffer where matte=1.

export const MATTE_SHADER = /* wgsl */ `
${PRELUDE}
${QUAD_UNIFORMS_WGSL}

@group(0) @binding(0) var<uniform> u: QuadUniforms;

${QUAD_VERTEX_WGSL}

@fragment
fn fs_main(in: QuadVsOutput) -> @location(0) vec4<f32> {
let item_local = in.local_px - u.pad_offset;
let p          = item_local - u.item_size * 0.5;
let half_size  = u.item_size * 0.5;
let r          = min(u.radius, min(half_size.x, half_size.y));
let dist       = rounded_box_sdf(p, half_size, r);

if (dist > 0.5) { discard; }
let mask = 1.0 - smoothstep(-0.5, 0.5, dist);

// With blend (zero, one-minus-src-alpha): framebuffer *= (1 - mask)
// mask=1 inside shape → pixel becomes transparent → DOM shows through
return vec4<f32>(0.0, 0.0, 0.0, mask * u.opacity);
}
`;

// ── Line shader ────────────────────────────────────────────────────────────────
// Renders connector thick-line geometry (pre-triangulated on CPU).
// Uniform layout (48 bytes / 12 floats):
//   [0]  resolution.x [1]  resolution.y
//   [2]  pan.x        [3]  pan.y
//   [4]  zoom         [5-7]  _pad
//   [8]  color.r      [9]  color.g        [10] color.b     [11] color.a

export const LINE_SHADER = /* wgsl */ `
${PRELUDE}

struct LineUniforms {
resolution: vec2<f32>,
pan:        vec2<f32>,
zoom:       f32,
_p0:        f32,
_p1:        f32,
_p2:        f32,
color:      vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: LineUniforms;

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> @builtin(position) vec4<f32> {
return world_to_ndc(a_pos, u.pan, u.zoom, u.resolution);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
return u.color;
}
`;

// ── Circle shader ──────────────────────────────────────────────────────────────
// Renders dots at connector endpoints.
// Uniform layout (48 bytes / 12 floats):
//   [0]  resolution.x [1]  resolution.y
//   [2]  pan.x        [3]  pan.y
//   [4]  zoom         [5]  radius
//   [6]  center.x     [7]  center.y
//   [8]  color.r      [9]  color.g        [10] color.b     [11] color.a

export const CIRCLE_SHADER = /* wgsl */ `
${PRELUDE}

struct CircleUniforms {
resolution: vec2<f32>,
pan:        vec2<f32>,
zoom:       f32,
radius:     f32,
center:     vec2<f32>,
color:      vec4<f32>,
};

struct CircleVsOutput {
@builtin(position) pos: vec4<f32>,
@location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: CircleUniforms;

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> CircleVsOutput {
var out: CircleVsOutput;
out.uv = a_pos * 2.0 - 1.0;
let world = u.center + (a_pos - 0.5) * u.radius * 2.0;
out.pos = world_to_ndc(world, u.pan, u.zoom, u.resolution);
return out;
}

@fragment
fn fs_main(in: CircleVsOutput) -> @location(0) vec4<f32> {
let d = length(in.uv);
if (d > 1.0) { discard; }
return u.color;
}
`;

// ── Fullscreen-quad shaders (blit + blur) ────────────────────────────────────
// Both draw a [0,1]² quad covering the whole target. No Y-flip needed: the
// source and destination share the same convention, so a straight NDC map
// is correct.

const FULLSCREEN_VS_WGSL = /* wgsl */ `struct FsVsOutput { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, };`;

// ── Blit shader ──────────────────────────────────────────────────────────────
// Copies a sub-rect from a source texture into the full render target.
// Uniform layout (16 bytes / 4 floats):
//   [0] srcOrigin.x  [1] srcOrigin.y  [2] srcSize.x  [3] srcSize.y

export const BLIT_SHADER = /* wgsl */ `
${FULLSCREEN_VS_WGSL}

struct BlitUniforms {
srcOrigin: vec2<f32>,  // UV origin in source texture
srcSize:   vec2<f32>,  // UV extent in source texture
};

@group(0) @binding(0) var<uniform> u: BlitUniforms;
@group(1) @binding(0) var t_src: texture_2d<f32>;
@group(1) @binding(1) var s_src: sampler;

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> FsVsOutput {
var out: FsVsOutput;
out.uv = u.srcOrigin + a_pos * u.srcSize;
out.pos = vec4<f32>(a_pos * 2.0 - 1.0, 0.0, 1.0);
return out;
}

@fragment
fn fs_main(in: FsVsOutput) -> @location(0) vec4<f32> {
return textureSample(t_src, s_src, in.uv);
}
`;

// ── Gaussian blur shader ──────────────────────────────────────────────────────
// Fullscreen-quad 13-tap separable Gaussian blur (σ ≈ 2 in tap units).
// Direction uniform controls horizontal vs vertical pass.
// Uniform layout (16 bytes / 4 floats):
//   [0] direction.x  [1] direction.y  [2-3] _pad

export const BLUR_SHADER = /* wgsl */ `
${FULLSCREEN_VS_WGSL}

struct BlurUniforms {
direction: vec2<f32>,  // texel-space step: (step/w, 0) or (0, step/h)
_pad:      vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: BlurUniforms;
@group(1) @binding(0) var t_src: texture_2d<f32>;
@group(1) @binding(1) var s_src: sampler;

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> FsVsOutput {
var out: FsVsOutput;
out.uv = a_pos;
out.pos = vec4<f32>(a_pos * 2.0 - 1.0, 0.0, 1.0);
return out;
}

// 13-tap Gaussian (σ=2 in tap units, normalized weights).
const W0 = 0.199676;
const W1 = 0.176221;
const W2 = 0.121119;
const W3 = 0.064832;
const W4 = 0.027025;
const W5 = 0.008775;
const W6 = 0.002219;

@fragment
fn fs_main(in: FsVsOutput) -> @location(0) vec4<f32> {
let d = u.direction;
var col = textureSample(t_src, s_src, in.uv) * W0;
col += (textureSample(t_src, s_src, in.uv + d)       + textureSample(t_src, s_src, in.uv - d))       * W1;
col += (textureSample(t_src, s_src, in.uv + d * 2.0) + textureSample(t_src, s_src, in.uv - d * 2.0)) * W2;
col += (textureSample(t_src, s_src, in.uv + d * 3.0) + textureSample(t_src, s_src, in.uv - d * 3.0)) * W3;
col += (textureSample(t_src, s_src, in.uv + d * 4.0) + textureSample(t_src, s_src, in.uv - d * 4.0)) * W4;
col += (textureSample(t_src, s_src, in.uv + d * 5.0) + textureSample(t_src, s_src, in.uv - d * 5.0)) * W5;
col += (textureSample(t_src, s_src, in.uv + d * 6.0) + textureSample(t_src, s_src, in.uv - d * 6.0)) * W6;
return col;
}
`;
