precision mediump float;

attribute vec2 position;
//attribute vec2 tangent;
attribute vec2 normal;
attribute vec4 color;

uniform mat3 viewTransform;
uniform vec2 screenShape;
uniform float lineWidth;

varying vec4 fragColor;

void main() {
  fragColor = color;

  vec3 vPosition = viewTransform * vec3(position, 1.0);
  vec2 offset = normalize(
    screenShape * (viewTransform * vec3(normal, 0.0)).xy);
  gl_Position = vec4(vPosition.xy + lineWidth * vPosition.z * offset,
    0, vPosition.z);
}
