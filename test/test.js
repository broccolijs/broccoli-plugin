var fs = require('fs')
var path = require('path')
var assert = require('assert')
var fixturify = require('fixturify')
var fixtureTree = require('broccoli-fixturify')
var Plugin = require('../index')

var broccoli_0_16_3 = require('./dependencies/broccoli-0.16.3')


function makePlugin(props) {
  TestPlugin.prototype = Object.create(Plugin.prototype)
  TestPlugin.prototype.constructor = TestPlugin
  function TestPlugin() {
    Plugin.apply(this, arguments)
  }

  // Empty defaults:
  TestPlugin.prototype.didInit = function() {}
  TestPlugin.prototype.build = function() {}

  for (key in props) {
    TestPlugin.prototype[key] = props[key]
  }

  return TestPlugin
}

var AnnotatingPlugin = makePlugin({
  didInit: function(inputTrees) {
    this.inputPaths = this.registerInputTrees(inputTrees)
    this.outputPath = this.getOutputPath()
    this.cachePath = this.getCachePath()
  },

  build: function() {
    for (var i = 0; i < this.inputPaths.length; i++) {
      var files = fs.readdirSync(this.inputPaths[i])
      for (var j = 0; j < files.length; j++) {
        var content = fs.readFileSync(path.join(this.inputPaths[i], files[j]))
        content += ' - from input tree #' + i
        fs.writeFileSync(path.join(this.outputPath, files[j]), content)
      }
    }
  }
})

var FailingPlugin = makePlugin({
  build: function() {
    throw new Error('')
  }
})

describe('integration test', function(){
  var tree1, tree2

  beforeEach(function() {
    tree1 = fixtureTree({ 'foo.txt': 'foo contents' })
    tree2 = fixtureTree({ 'bar.txt': 'bar contents' })
  })

  describe('Broccoli with .read API', function(){
    it('works without errors', function(){
      var tree = new AnnotatingPlugin([tree1, tree2])
      var builder = new broccoli_0_16_3.Builder(tree)
      return builder.build()
        .then(function(hash) {
          assert.deepEqual(fixturify.readSync(hash.directory), {
            'foo.txt': 'foo contents - from input tree #0',
            'bar.txt': 'bar contents - from input tree #1'
          })
          return builder.cleanup()
        })
    })

    it('calls didInit once', function() {
      var didInitCalls = 0
      var Plugin = makePlugin({
        didInit: function() {
          didInitCalls++
        }
      })
      var builder = new broccoli_0_16_3.Builder(new Plugin)
      return builder.build()
        .then(function() {
          return builder.build()
        })
        .then(function() {
          assert.equal(didInitCalls, 1)
          return builder.cleanup()
        })
    })
  })
})
