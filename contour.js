'use strict'

module.exports = createContour2D

var iota          = require('iota-array')
var createShader  = require('gl-shader')
var createBuffer  = require('gl-buffer')
var ndarray       = require('ndarray')
var surfaceNets   = require('surface-nets')

var shaders = require('./lib/shaders')

function GLContour2D(
  plot,
  shader,
  pickShader,
  positionBuffer,
  colorBuffer,
  idBuffer) {
  this.plot           = plot
  this.shader         = shader
  this.pickShader     = pickShader
  this.positionBuffer = positionBuffer
  this.colorBuffer    = colorBuffer
  this.idBuffer       = idBuffer
  this.xData          = []
  this.yData          = []
  this.shape          = [0,0]
  this.bounds         = [Infinity, Infinity, -Infinity, -Infinity]
  this.pickOffset     = 0
  this.numVertices    = 0
  this.lineWidth      = 1
}

var proto = GLContour2D.prototype

var WEIGHTS = [
  1, 0,
  0, 0,
  0, 1,
  1, 0,
  1, 1,
  0, 1
]

proto.draw = (function() {
  var MATRIX = [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ]

  var SCREEN_SHAPE = [0,0]

  return function() {
    var plot          = this.plot
    var shader        = this.shader
    var bounds        = this.bounds
    var numVertices   = this.numVertices

    if(!numVertices) {
      return
    }

    var gl            = plot.gl
    var viewBox       = plot.viewBox
    var dataBox       = plot.dataBox

    var boundX  = bounds[2]  - bounds[0]
    var boundY  = bounds[3]  - bounds[1]
    var dataX   = dataBox[2] - dataBox[0]
    var dataY   = dataBox[3] - dataBox[1]

    MATRIX[0] = 2.0 * boundX / dataX
    MATRIX[4] = 2.0 * boundY / dataY
    MATRIX[6] = 2.0 * (bounds[0] - dataBox[0]) / dataX - 1.0
    MATRIX[7] = 2.0 * (bounds[1] - dataBox[1]) / dataY - 1.0

    SCREEN_SHAPE[0] = viewBox[2] - viewBox[0]
    SCREEN_SHAPE[1] = viewBox[3] - viewBox[1]

    shader.bind()

    var lineWidth = this.lineWidth * plot.pixelRatio

    var uniforms = shader.uniforms
    uniforms.viewTransform  = MATRIX
    uniforms.screenShape    = SCREEN_SHAPE
    uniforms.lineWidth      = lineWidth
    uniforms.pointSize      = 1000

    var attributes = shader.attributes

    //Draw lines
    this.positionBuffer.bind()
    attributes.position.pointer(gl.FLOAT, false, 16, 0)
    attributes.tangent.pointer(gl.FLOAT, false, 16, 8)

    this.colorBuffer.bind()
    attributes.color.pointer(gl.UNSIGNED_BYTE, true)

    gl.drawArrays(gl.TRIANGLES, 0, this.numVertices)

    //Draw end caps
    uniforms.lineWidth = 0
    uniforms.pointSize = lineWidth

    this.positionBuffer.bind()
    attributes.position.pointer(gl.FLOAT, false, 16*3, 0)
    attributes.tangent.pointer(gl.FLOAT, false, 16*3, 8)

    this.colorBuffer.bind()
    attributes.color.pointer(gl.UNSIGNED_BYTE, true, 4*3, 0)

    gl.drawArrays(gl.POINTS, 0, this.numVertices/3)
  }
})()

proto.drawPick = (function() {
  return function(pickOffset) {
    return pickOffset
  }
})()

proto.pick = function(x, y, value) {
  return null
}

function interpolate(array, point) {
  var idx = Math.floor(point)
  if(idx < 0) {
    return array[0]
  } else if(idx >= array.length-1) {
    return array[array.length-1]
  }
  var t = point - idx
  return (1.0 - t) * array[idx] + t * array[idx+1]
}

proto.update = function(options) {
  options = options || {}

  var shape = options.shape || [0,0]

  var x = options.x || iota(shape[0])
  var y = options.y || iota(shape[1])
  var z = options.z || new Float32Array(shape[0] * shape[1])

  var levels      = options.levels      || []
  var levelColors = options.levelColors || []

  var bounds = this.bounds
  var lox = bounds[0] = x[0]
  var loy = bounds[1] = y[0]
  var hix = bounds[2] = x[x.length-1]
  var hiy = bounds[3] = y[y.length-1]

  if(lox === hix) {
    bounds[2] += 1
    hix += 1
  }
  if(loy === hiy) {
    bounds[3] += 1
    hiy += 1
  }

  var xs = 1.0 / (hix - lox)
  var ys = 1.0 / (hiy - loy)

  this.xData = x
  this.yData = y

  this.lineWidth = options.lineWidth || 1

  var zarray = ndarray(z, shape)

  var positions = []
  var colors    = []
  var ids       = []

  for(var i=0; i<levels.length; ++i) {
    var contour = surfaceNets(zarray, levels[i])

    var c_r = (255*levelColors[4*i  ])|0
    var c_g = (255*levelColors[4*i+1])|0
    var c_b = (255*levelColors[4*i+2])|0
    var c_a = (255*levelColors[4*i+3])|0

    var c_cells     = contour.cells
    var c_positions = contour.positions
    for(var j=0; j<c_cells.length; ++j) {
      var e = c_cells[j]
      var a = c_positions[e[0]]
      var b = c_positions[e[1]]

      var pointId = Math.round(a[0]) + shape[0] * Math.round(a[1])

      var ax = interpolate(x, a[0])
      var ay = interpolate(y, a[1])
      var bx = interpolate(x, b[0])
      var by = interpolate(y, b[1])

      ax = xs * (ax - lox)
      ay = ys * (ay - loy)
      bx = xs * (bx - lox)
      by = ys * (by - loy)

      var dx = ax - bx
      var dy = ay - by
      var dl = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2))

      for(var k=0; k<WEIGHTS.length; k+=2) {
        var wx  = WEIGHTS[k]
        var wix = 1.0 - wx
        var wy  = 2.0 * WEIGHTS[k+1] - 1.0

        positions.push(
          wix * ax + wx * bx,  wix * ay + wx * by,
          wy * dx,        wy * dy)
        colors.push(c_r, c_g, c_b, c_a)
        ids.push(pointId)
      }
    }
  }

  this.positionBuffer.update(new Float32Array(positions))
  this.colorBuffer.update(new Uint8Array(colors))
  this.idBuffer.update(new Uint32Array(ids))

  this.numVertices = ids.length
}

proto.dispose = function() {
  this.plot.removeObject(this)
}

function createContour2D(plot, options) {
  var gl = plot.gl

  var shader     = createShader(gl, shaders.vertex,     shaders.fragment)
  var pickShader = createShader(gl, shaders.pickVertex, shaders.pickFragment)

  var positionBuffer = createBuffer(gl)
  var colorBuffer    = createBuffer(gl)
  var idBuffer       = createBuffer(gl)

  var contours = new GLContour2D(
    plot,
    shader,
    pickShader,
    positionBuffer,
    colorBuffer,
    idBuffer)

  contours.update(options)
  plot.addObject(contours)

  return contours
}
