// ── WebGPU (WGSL) Shader Sources ──
// Converted from the WebGL2 GLSL ES 3.0 shaders in ../webgl/shaders.js.
// Each export is a single WGSL module with @vertex and @fragment entry points.
//
// Uniform buffer byte sizes (for JS-side allocation):
export const GRID_UNIFORM_SIZE = 128;
export const QUAD_UNIFORM_SIZE = 160;
export const MATTE_UNIFORM_SIZE = 160; // same layout as quad
export const LINE_UNIFORM_SIZE = 48;
export const CIRCLE_UNIFORM_SIZE = 48;

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

export const GRID_SHADER = `
struct GridUniforms {
  pan:         vec2<f32>,  // offset  0
  zoom_dpr:    f32,        // offset  8
  _p0:         f32,        // offset 12
  resolution:  vec2<f32>,  // offset 16
  _p1:         vec2<f32>,  // offset 24
  bg_color:    vec4<f32>,  // offset 32
  d1_color:    vec4<f32>,  // offset 48
  d1_opacity:  f32,        // offset 64
  d1_size:     f32,        // offset 68
  d1_softness: f32,        // offset 72
  d1_spacing:  f32,        // offset 76
  d2_color:    vec4<f32>,  // offset 80
  d2_on:       f32,        // offset 96
  d2_opacity:  f32,        // offset 100
  d2_size:     f32,        // offset 104
  d2_softness: f32,        // offset 108
  d2_spacing:  f32,        // offset 112
  _p2:         f32,        // offset 116
  _p3:         f32,        // offset 120
  _p4:         f32,        // offset 124
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
  // WebGPU frag_pos is top-left origin — no Y flip needed (unlike GL).
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
// Uniform layout (160 bytes / 40 floats):
//   [0]  resolution.x [1]  resolution.y
//   [2]  pan.x        [3]  pan.y
//   [4]  zoom         [5]  rotation       [6]  radius       [7]  opacity
//   [8]  itemPos.x    [9]  itemPos.y
//   [10] itemSize.x   [11] itemSize.y
//   [12] padSize.x    [13] padSize.y
//   [14] padOffset.x  [15] padOffset.y
//   [16] color.r      [17] color.g        [18] color.b      [19] color.a
//   [20] texCrop.x    [21] texCrop.y      [22] texCrop.z    [23] texCrop.w
//   [24] borderColor.r [25] borderColor.g [26] borderColor.b [27] borderColor.a
//   [28] textColor.r  [29] textColor.g    [30] textColor.b  [31] textColor.a
//   [32] borderWidth  [33] textured       [34] hasShadow    [35] shadowSize
//   [36] shadowOpacity [37] isSelection   [38] textAlpha    [39] _pad

export const QUAD_SHADER = `
struct QuadUniforms {
  resolution:     vec2<f32>,  // offset   0
  pan:            vec2<f32>,  // offset   8
  zoom:           f32,        // offset  16
  rotation:       f32,        // offset  20
  radius:         f32,        // offset  24
  opacity:        f32,        // offset  28
  item_pos:       vec2<f32>,  // offset  32
  item_size:      vec2<f32>,  // offset  40
  pad_size:       vec2<f32>,  // offset  48
  pad_offset:     vec2<f32>,  // offset  56
  color:          vec4<f32>,  // offset  64
  tex_crop:       vec4<f32>,  // offset  80
  border_color:   vec4<f32>,  // offset  96
  text_color:     vec4<f32>,  // offset 112
  border_width:   f32,        // offset 128
  textured:       f32,        // offset 132
  has_shadow:     f32,        // offset 136
  shadow_size:    f32,        // offset 140
  shadow_opacity: f32,        // offset 144
  is_selection:   f32,        // offset 148
  text_alpha:     f32,        // offset 152
  _pad:           f32,        // offset 156
};

struct QuadVsOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) local_px: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: QuadUniforms;
@group(1) @binding(0) var t_tex: texture_2d<f32>;
@group(1) @binding(1) var s_tex: sampler;

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> QuadVsOutput {
  var out: QuadVsOutput;
  let local = a_pos * u.pad_size;
  out.uv = a_pos;
  out.local_px = local;

  let item_center = u.pad_offset + u.item_size * 0.5;
  let c = cos(u.rotation);
  let s = sin(u.rotation);
  let d = local - item_center;
  let rotated = item_center + vec2<f32>(d.x * c - d.y * s, d.x * s + d.y * c);

  let world = (u.item_pos - u.pad_offset) + rotated;
  let screen = world * u.zoom + u.pan;
  var ndc = screen / u.resolution * 2.0 - 1.0;
  ndc.y = -ndc.y;
  out.pos = vec4<f32>(ndc, 0.0, 1.0);
  return out;
}

fn rounded_box_sdf(p: vec2<f32>, half_size: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - half_size + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - r;
}

@fragment
fn fs_main(in: QuadVsOutput) -> @location(0) vec4<f32> {
  let item_local = in.local_px - u.pad_offset;
  let p = item_local - u.item_size * 0.5;
  let half_size = u.item_size * 0.5;
  let r = min(u.radius, min(half_size.x, half_size.y));
  let dist = rounded_box_sdf(p, half_size, r);

  // Sample texture early — must happen before non-uniform discard so that
  // screen-space derivatives are valid for the 2×2 fragment quad.
  var uv = u.tex_crop.xy + (item_local / u.item_size) * u.tex_crop.zw;
  uv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  let tex_sample = textureSample(t_tex, s_tex, uv);

  // ── Selection outline ──
  if (u.is_selection > 0.5) {
    let outline_width = 1.5;
    let outer_dist = rounded_box_sdf(p, half_size + outline_width, r + outline_width);
    let aa_o = 1.0 - smoothstep(-0.5, 0.5, outer_dist);
    let inner = 1.0 - smoothstep(-0.5, 0.5, dist);
    let outline = aa_o - inner;
    let sel_color = vec4<f32>(0.173, 0.518, 0.859, outline * 0.7);
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

  return vec4<f32>(col.rgb, col.a * aa * u.opacity);
}
`;

// ── Line shader ────────────────────────────────────────────────────────────────
// Renders connector thick-line geometry (pre-triangulated on CPU).
// Uniform layout (48 bytes / 12 floats):
//   [0]  resolution.x [1]  resolution.y
//   [2]  pan.x        [3]  pan.y
//   [4]  zoom         [5-7]  _pad
//   [8]  color.r      [9]  color.g        [10] color.b     [11] color.a

export const LINE_SHADER = `
struct LineUniforms {
  resolution: vec2<f32>,  // offset  0
  pan:        vec2<f32>,  // offset  8
  zoom:       f32,        // offset 16
  _p0:        f32,        // offset 20
  _p1:        f32,        // offset 24
  _p2:        f32,        // offset 28
  color:      vec4<f32>,  // offset 32
};

@group(0) @binding(0) var<uniform> u: LineUniforms;

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> @builtin(position) vec4<f32> {
  let screen = a_pos * u.zoom + u.pan;
  var ndc = screen / u.resolution * 2.0 - 1.0;
  ndc.y = -ndc.y;
  return vec4<f32>(ndc, 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return u.color;
}
`;

// ── Matte shader ──────────────────────────────────────────────────────────────
// Renders transparent cutouts in the canvas for media items (videos, GIFs).
// DOM elements behind the canvas show through the cutout holes.
// Uses the same uniform layout as QUAD_SHADER for simplicity.
// Blend mode: src=zero, dst=one-minus-src-alpha → erases framebuffer where matte=1.

export const MATTE_SHADER = `
struct QuadUniforms {
  resolution:     vec2<f32>,
  pan:            vec2<f32>,
  zoom:           f32,
  rotation:       f32,
  radius:         f32,
  opacity:        f32,
  item_pos:       vec2<f32>,
  item_size:      vec2<f32>,
  pad_size:       vec2<f32>,
  pad_offset:     vec2<f32>,
  color:          vec4<f32>,
  tex_crop:       vec4<f32>,
  border_color:   vec4<f32>,
  text_color:     vec4<f32>,
  border_width:   f32,
  textured:       f32,
  has_shadow:     f32,
  shadow_size:    f32,
  shadow_opacity: f32,
  is_selection:   f32,
  text_alpha:     f32,
  _pad:           f32,
};

struct MatteVsOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) local_px: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: QuadUniforms;
@group(1) @binding(0) var t_tex: texture_2d<f32>;
@group(1) @binding(1) var s_tex: sampler;

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> MatteVsOutput {
  var out: MatteVsOutput;
  let local = a_pos * u.pad_size;
  out.uv = a_pos;
  out.local_px = local;

  let item_center = u.pad_offset + u.item_size * 0.5;
  let c = cos(u.rotation);
  let s = sin(u.rotation);
  let d = local - item_center;
  let rotated = item_center + vec2<f32>(d.x * c - d.y * s, d.x * s + d.y * c);

  let world = (u.item_pos - u.pad_offset) + rotated;
  let screen = world * u.zoom + u.pan;
  var ndc = screen / u.resolution * 2.0 - 1.0;
  ndc.y = -ndc.y;
  out.pos = vec4<f32>(ndc, 0.0, 1.0);
  return out;
}

fn rounded_box_sdf(p: vec2<f32>, half_size: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - half_size + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - r;
}

@fragment
fn fs_main(in: MatteVsOutput) -> @location(0) vec4<f32> {
  let item_local = in.local_px - u.pad_offset;
  let p = item_local - u.item_size * 0.5;
  let half_size = u.item_size * 0.5;
  let r = min(u.radius, min(half_size.x, half_size.y));
  let dist = rounded_box_sdf(p, half_size, r);

  if (dist > 0.5) { discard; }
  let mask = 1.0 - smoothstep(-0.5, 0.5, dist);

  // With blend (zero, one-minus-src-alpha): framebuffer *= (1 - mask)
  // mask=1 inside shape → pixel becomes transparent → DOM shows through
  return vec4<f32>(0.0, 0.0, 0.0, mask * u.opacity);
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

export const CIRCLE_SHADER = `
struct CircleUniforms {
  resolution: vec2<f32>,  // offset  0
  pan:        vec2<f32>,  // offset  8
  zoom:       f32,        // offset 16
  radius:     f32,        // offset 20
  center:     vec2<f32>,  // offset 24
  color:      vec4<f32>,  // offset 32
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
  let screen = world * u.zoom + u.pan;
  var ndc = screen / u.resolution * 2.0 - 1.0;
  ndc.y = -ndc.y;
  out.pos = vec4<f32>(ndc, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(in: CircleVsOutput) -> @location(0) vec4<f32> {
  let d = length(in.uv);
  if (d > 1.0) { discard; }
  return u.color;
}
`;
