// Noise/rotation GLSL adapted inline (no glslify build step) from the approach documented in
// https://github.com/codrops/WebGLBlobs (an IcosahedronGeometry displaced by 3D Perlin noise
// along its normals, with a sine-driven twist and a cosine colour palette in the fragment shader).

// Periodic 3D Perlin noise, Stefan Gustavson / Ashima Arts (MIT licensed) -- the inline
// equivalent of glslify's `require(glsl-noise/periodic/3d)`. `rep` is the tiling period per axis.
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float pnoise(vec3 P, vec3 rep) {
  vec3 Pi0 = mod(floor(P), rep);
  vec3 Pi1 = mod(Pi0 + vec3(1.0), rep);
  Pi0 = mod289(Pi0);
  Pi1 = mod289(Pi1);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;

  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);

  vec4 gx0 = ixy0 * (1.0 / 7.0);
  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);

  vec4 gx1 = ixy1 * (1.0 / 7.0);
  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);

  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x);
  vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z);
  vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x);
  vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z);
  vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);

  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;

  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);

  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;
}

// Inline equivalent of glslify's require(glsl-rotate/rotateY): same matrix layout as that package.
vec3 rotateY(vec3 v, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  mat3 m = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
  return m * v;
}
`;

export const BLOB_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
varying float vDistort;

uniform float uTime;
uniform float uSpeed;
uniform float uNoiseDensity;
uniform float uNoiseStrength;
uniform float uFrequency;
uniform float uAmplitude;

${NOISE_GLSL}

void main() {
  float t = uTime * uSpeed;

  // Periodic Perlin noise sampled on the (time-shifted) normal; density scales the tiling period.
  float distortion = pnoise((normal + t), vec3(10.0) * uNoiseDensity) * uNoiseStrength;

  // Disturb each vertex along the direction of its normal.
  vec3 pos = position + (normal * distortion);

  // Twist: a sine wave from top to bottom of the sphere drives a per-vertex rotation about Y.
  // uFrequency sets how many waves span the sphere, uAmplitude how far each one twists.
  float angle = sin(uv.y * uFrequency + t) * uAmplitude;
  pos = rotateY(pos, angle);

  // Only what the fragment shader reads: an unread varying (e.g. vNormal) draws a WebGL
  // "output of vertex shader not read" warning on every page load.
  vUv = uv;
  vDistort = distortion;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

// Cosine colour palette, per the "Cospalette" section of
// https://tympanus.net/codrops/2021/01/26/twisted-colorful-spheres-with-three-js/
// (Inigo Quilez's palette function: https://iquilezles.org/www/articles/palettes/palettes.htm),
// with our own blue/green coefficients -- see the comment block in main().
export const BLOB_FRAGMENT_SHADER = /* glsl */ `
varying vec2 vUv;
varying float vDistort;

uniform float uIntensity;
uniform float uAlpha;

vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  float distort = vDistort * uIntensity;

  // Blue <-> green palette, green and blue half a cycle apart so the surface sweeps green ->
  // teal -> blue and back.
  //  - Red rides in phase with green (0..0.24): at the green peak it warms the dark green toward
  //    a yellow-green, and at the blue peak it is ~0 so the blue carries no purple cast.
  //  - Green's floor is raised (~0.26..0.58) so the blue end still contains some green, which
  //    is what reads as cobalt (#0047AB ~ rgb(0, 0.28, 0.67)) rather than violet.
  //  - Blue tops out ~0.85 instead of 1.0, again closer to cobalt than to pure RGB blue.
  vec3 brightness = vec3(0.02, 0.50, 0.50);
  vec3 contrast = vec3(0.12, 0.40, 0.45);
  vec3 oscilation = vec3(1.0, 1.0, 1.0);
  vec3 phase = vec3(0.0, 0.0, 0.5);

  vec3 color = cosPalette(distort, brightness, contrast, oscilation, phase);

  gl_FragColor = vec4(color, uAlpha);
}
`;
