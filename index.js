var quickTemp = require('quick-temp')
var mapSeries = require('promise-map-series')
var rimraf = require('rimraf')
var symlinkOrCopySync = require('symlink-or-copy').sync
var RSVP = require('rsvp')
var fs = require('fs')
var path = require('path')


module.exports = Plugin
function Plugin() {
  this._instantiationStack = (new Error()).stack
  this._initializationState = 0

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
Plugin.prototype.__broccoliPluginFeatures__ = {}

// The Broccoli builder calls plugin.__broccoliRegister__
// TODO: move features into interface?
Plugin.prototype.__broccoliRegister__ = function(builderFeatures, builderInterface) {
  try {
    this._builderFeatures = builderFeatures // corresponding feature flags in builder
    this._builderInterface = builderInterface

    if (this._initializationState !== 0) {
      throw new Error('Plugin subclasses must call the superclass constructor: Plugin.call(this)')
    }
    this._initializationState = 1

    // TODO: maybe _builderInterface.registerPluginInterface for better nomenclature
    this._builderInterface.registerPluginCallbacks({
      build: this._doBuild.bind(this)
      // destroy: this._doDestroy.bind(this)
    })

    this.didInit()
    this._initializationState = 2
  } catch (err) {
    err.broccoliInstantiationStack = this._instantiationStack
    throw err
  }
}

Plugin.prototype.registerInputTrees = function(trees) {
  this._checkWithinDidInit()
  if (!Array.isArray(trees)) throw new Error('Expected an array of input trees, got ' + trees + '; did you mean this.registerInputTree(tree)?')
  var paths = []
  for (var i = 0; i < trees.length; i++) {
    paths.push(this.registerInputTree(trees[i]))
  }
  return paths
}

Plugin.prototype.registerInputTree = function(tree) {
  return this._builderInterface.registerInputTree(tree)
}

Plugin.prototype.getOutputPath = function() {
  this._checkWithinDidInit() // TODO: relax to allow calling from .build?
  return this._builderInterface.getOutputPath()
}

Plugin.prototype.getCachePath = function() {
  this._checkWithinDidInit() // TODO: relax to allow calling from .build?
  return this._builderInterface.getCachePath()
}

// Indirection (_doBuild -> build) allows subclasses like
// broccoli-caching-writer to hook into calls from the builder
Plugin.prototype._doBuild = function() {
  var self = this

  if (typeof this.build !== 'function') {
    throw new Error('Plugin subclasses must implement a .build() function')
  }

  return RSVP.resolve()
    .then(this.build.bind(this))
    .catch(function(err) {
      err.broccoliInstantiationStack = self._instantiationStack
      throw err
    })
}

// TODO: eliminate? https://github.com/broccolijs/broccoli/issues/263
// TODO: if not: add _hasDestroy?
Plugin.prototype._destroy = function() {
  if (typeof this._plugin.destroy === 'function') {
    return this._plugin.destroy()
  }
}

Plugin.prototype._checkWithinDidInit = function() {
  if (this._initializationState !== 1) {
    throw new Error('This function can only be called from within .didInit()')
  }
}


// Compatibility code so plugins can run on old, .read-based Broccoli:

Plugin.prototype.read = function(readTree) {
  if (!this.hasOwnProperty('_initializationState')) {
    throw new Error('Plugin subclasses must call the superclass constructor: Plugin.call(this)')
  }
  if (this._initializationState === 0) {
    this._readCompatBuilderInterface = new ReadCompatBuilderInterface(this)
    this.__broccoliRegister__({}, this._readCompatBuilderInterface)
  }
  return this._readCompatBuilderInterface.read(readTree)
}

Plugin.prototype.cleanup = function() {
  this._readCompatBuilderInterface.cleanup()
}

// Old, .read-based Broccoli doesn't give us a builder interface, so we make
// our own, using quickTemp to create directories
function ReadCompatBuilderInterface(plugin) {
  this.plugin = plugin
  this.inputTrees = []
  quickTemp.makeOrReuse(this, 'outputDir')
  quickTemp.makeOrReuse(this, 'inputDirs')
}

ReadCompatBuilderInterface.prototype.getOutputPath = function() {
  return this.outputDir
}

ReadCompatBuilderInterface.prototype.getCachePath = function() {
  return quickTemp.makeOrReuse(this, 'cacheDir')
}

ReadCompatBuilderInterface.prototype.registerPluginCallbacks = function(callbacks) {
  this.callbacks = callbacks
}

ReadCompatBuilderInterface.prototype.registerInputTree = function(tree) {
  var i = this.inputTrees.length
  this.inputTrees.push(tree)
  // In old .read-based Broccoli, the inputTree's output path can change on
  // each rebuild. But the new API requires that we return a fixed input path
  // now. Therefore, we make up a fixed input path now, and we'll symlink
  // inputTree's actual output path to our fixed input path on each .read()
  return path.join(this.inputDirs, i + '')
}

ReadCompatBuilderInterface.prototype.read = function(readTree) {
  var self = this

  rimraf.sync(this.outputDir)
  fs.mkdirSync(this.outputDir)

  return mapSeries(this.inputTrees, readTree)
    .then(function(outputPaths) {
      // Symlink the inputTrees' outputPaths to our (fixed) input paths
      for (var i = 0; i < outputPaths.length; i++) {
        var fixedInputPath = path.join(self.inputDirs, i + '')
        if (fs.existsSync(fixedInputPath)) {
          rimraf.sync(fixedInputPath)
        }
        symlinkOrCopySync(outputPaths[i], fixedInputPath)
      }

      return self.callbacks.build()
    })
    .then(function() {
      return self.outputDir
    })
}

ReadCompatBuilderInterface.prototype.cleanup = function() {
  quickTemp.remove(this, 'outputDir')
  quickTemp.remove(this, 'inputDirs')
  quickTemp.remove(this, 'cacheDir')
}


// TODO: tmp dir naming https://github.com/broccolijs/broccoli/issues/262
// TODO: setDescription
// TODO: Rename broccoli-plugin?
