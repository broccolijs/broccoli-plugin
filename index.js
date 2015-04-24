module.exports = BroccoliPlugin
function BroccoliPlugin() {
  this._pluginState = {
    inputTrees: []
  }
}

// For future extensibility, we version the API using feature flags
BroccoliPlugin.prototype.__broccoliPluginFeatures__ = {}

// The Broccoli builder calls this
BroccoliPlugin.prototype.__broccoliRegister__ = function(options) {
  this._builderInfo = { // need better name than "info"
    builderFeatures: options.builderFeatures, // analogous to __broccoliPluginFeatures__
    pluginCallbacks: options.pluginCallbacks
  }

  var state = getState(this)
  return {
    inputTrees: state.inputTrees,
    description: getDescription(this)
  }
}

BroccoliPlugin.prototype.registerInputTrees = function(trees) {
  if (!Array.isArray(trees)) throw new Error('Expected an array of input trees, got ' + trees)
  getState(this).inputTrees = getState(this).inputTrees.concat(trees)
}

BroccoliPlugin.prototype.getInputPaths = function() {
  return getBuilderInfo(this).pluginCallbacks.getInputPaths()
}

BroccoliPlugin.prototype.getOutputPath = function() {
  return getBuilderInfo(this).pluginCallbacks.getOutputPath()
}

BroccoliPlugin.prototype.getCachePath = function() {
  return getBuilderInfo(this).pluginCallbacks.getCachePath()
}

BroccoliPlugin.prototype.build = function() {
  throw new Error('Override the `build` function in your plugin subclass')
}

BroccoliPlugin.prototype.cleanup = function() {
}

BroccoliPlugin.prototype.rebuild = function() {
  // Compatibility code for old Broccoli goes here.
}

BroccoliPlugin.prototype.read = function(readTree) {
  // Compatibility code for old Broccoli goes here.
}

function getState(plugin) {
  if (!plugin._pluginState) {
    // We are very insistent that subclasses call super, even though it's
    // trivially avoidable, so that we can add more functionality to the
    // constructor in the future.
    throw new Error('Uninitialized BroccoliPlugin base class state in ' + getDescription(plugin)
      + '; did you forget to call the base class constructor, BroccoliPlugin.call(this)?')
  }
  return plugin._pluginState
}

function getBuilderInfo(plugin) {
  if (!plugin._builderInfo) {
    throw new Error('This function cannot be called before build()')
  }
  return plugin._builderInfo
}

function getDescription(plugin) {
  // Make this an instance method?
  return plugin.description || plugin.constructor.name || 'unnamed plugin'
}
