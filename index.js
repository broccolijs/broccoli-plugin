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
Plugin.prototype.__broccoliFeatures__ = Object.freeze({})

// The Broccoli builder calls plugin.__broccoliRegister__
Plugin.prototype.__broccoliRegister__ = function(builderFeatures) {
  if (!this._baseConstructorCalled) {
    throw new Error('Plugin subclasses must call the superclass constructor: Plugin.call(this, inputNodes)')
  }

  // Feature flags in builder, corresponding to __broccoliFeatures__
  this._builderFeatures = builderFeatures

  return {
    inputNodes: this._inputNodes,
    postInit: this._postInit.bind(this),
    build: this.getBuildCallback(),
    instantiationStack: this._instantiationStack
  }
}

Plugin.prototype._postInit = function(options) {
  this.inputPaths = options.inputPaths
  this.outputPath = options.outputPath
  this.cachePath = options.cachePath
}

// Indirection (getBuildCallback -> build) allows subclasses like
// broccoli-caching-writer to hook into calls from the builder
Plugin.prototype.getBuildCallback = function() {
  return this.build.bind(this)
}

Plugin.prototype.build = function() {
  throw new Error('Plugin subclasses must implement a .build() function')
}


// Compatibility code so plugins can run on old, .read-based Broccoli:

Plugin.prototype.read = function(readTree) {
  var self = this

  if (this._readCompat == null) {
    try {
      this._initializeReadCompat() // call this.__broccoliRegister__()
    } catch (err) {
      // Prevent trying to initialize again on next .read
      this._readCompat = false
      // Remember error so we can throw it on all subsequent .read calls
      this._readCompatError = err
    }
  }

  if (this._readCompatError != null) throw this._readCompatError

  return this._readCompat.read(readTree)
}

Plugin.prototype.cleanup = function() {
  if (this._readCompat) return this._readCompat.cleanup()
}

Plugin.prototype._initializeReadCompat = function() {
  var ReadCompat = require('./read_compat')
  this._readCompat = new ReadCompat(this)
}



// TODO: tmp dir naming https://github.com/broccolijs/broccoli/issues/262
// TODO: description
// TODO: toString
// TODO: one error with several references, or, multiple errors at once

// Allow for adding the following features in the future:
//
// logging
// persistent caches
// in-memory tree representations (and/or filesChanged structure)
// nested nodes
