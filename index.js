module.exports = Plugin
function Plugin(inputNodes) {
  if (!(this instanceof Plugin)) throw new Error('Missing `new` operator')
  if (!Array.isArray(inputNodes)) throw new Error('Expected an array of input nodes (input trees), got ' + inputNodes)

  this._instantiationStack = (new Error()).stack
  this._baseConstructorCalled = true
  this._inputNodes = inputNodes

  this._checkOverrides()
}

Plugin.prototype._checkOverrides = function() {
  if (typeof this.rebuild === 'function') {
    throw new Error('For compatibility, plugins must not define a plugin.rebuild() function')
  }
  if (this.read !== Plugin.prototype.read) {
    throw new Error('For compatibility, plugins must not define a plugin.read() function')
  }
  if (this.cleanup !== Plugin.prototype.cleanup) {
    throw new Error('For compatibility, plugins must not define a plugin.cleanup() function')
  }
}

// For future extensibility, we version the API using feature flags
Plugin.prototype.__broccoliNodeFeatures__ = Object.freeze({})

// The Broccoli builder calls plugin.__broccoliRegister__
Plugin.prototype.__broccoliRegister__ = function(builderFeatures) {
  if (!this._baseConstructorCalled) {
    throw new Error('Plugin subclasses must call the superclass constructor: Plugin.call(this, inputNodes)')
  }

  this._builderFeatures = builderFeatures // corresponding feature flags in builder

  return {
    inputNodes: this._inputNodes,
    postInit: this._postInit.bind(this),
    build: this._doBuild.bind(this),
    instantiationStack: this._instantiationStack
  }
}

Plugin.prototype._postInit = function(options) {
  this._postInitCalled = true
  this._cachePath = options.cachePath
  this._inputPaths = options.inputPaths
  this._outputPath = options.outputPath
}

Object.defineProperty(Plugin.prototype, 'cachePath', {
  get: function() {
    if (!this._postInitCalled) throw new Error('this.cachePath must not be accessed before build()')
    return this._cachePath
  }
})

Object.defineProperty(Plugin.prototype, 'inputPaths', {
  get: function() {
    if (!this._postInitCalled) throw new Error('this.inputPaths must not be accessed before build()')
    return this._inputPaths
  }
})

Object.defineProperty(Plugin.prototype, 'outputPath', {
  get: function() {
    if (!this._postInitCalled) throw new Error('this.outputPath must not be accessed before build()')
    return this._outputPath
  }
})

// Indirection (_doBuild -> build) allows subclasses like
// broccoli-caching-writer to hook into calls from the builder
Plugin.prototype._doBuild = function() {
  return this.build()
}

Plugin.prototype.build = function() {
  throw new Error('Plugin subclasses must implement a .build() function')
}


// Compatibility code so plugins can run on old, .read-based Broccoli:

Plugin.prototype.read = function(readTree) {
  var self = this

  if (!this._readCompat) {
    var ReadCompat = require('./read_compat')
    this._readCompat = new ReadCompat(this)
    // TODO catch errors
  }

  return this._readCompat.read(readTree)
}

Plugin.prototype.cleanup = function() {
  if (this._readCompat) this._readCompat.cleanup()
}



// TODO: tmp dir naming https://github.com/broccolijs/broccoli/issues/262
// TODO: description
// TODO: toString
