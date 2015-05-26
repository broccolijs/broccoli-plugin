var fs = require('fs')
var path = require('path')
var fixturify = require('fixturify')
var fixtureTree = require('broccoli-fixturify')
var Plugin = require('../index')
var chai = require('chai'), expect = chai.expect
var chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)

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
          expect(fixturify.readSync(hash.directory)).to.deep.equal({
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
          expect(didInitCalls).to.equal(1)
          return builder.cleanup()
        })
    })
  })
})


describe('usage errors', function() {
  // TODO: .__broccoliRegister__() is not correct usage; create helper to do it properly

  it('requires the base constructor to be called (super)', function() {
    TestPlugin.prototype = Object.create(Plugin.prototype)
    TestPlugin.prototype.constructor = TestPlugin
    function TestPlugin() {
      // missing Plugin.call(this)
    }

    TestPlugin.prototype.didInit = function() {}
    TestPlugin.prototype.build = function() {}

    expect(function() {
      (new TestPlugin).__broccoliRegister__()
    }).to.throw(/must call the superclass constructor/)
  })

  it('does not allow for overriding read, cleanup, and rebuild', function() {
    var badPlugins = [
      makePlugin({ read: function() {} })
    , makePlugin({ rebuild: function() {} })
    , makePlugin({ cleanup: function() {} })
    ]
    for (var i = 0; i < badPlugins.length; i++) {
      expect(function() {
        (new badPlugins[i]).__broccoliRegister__()
      }).to.throw(/For compatibility, plugins must not define/)
    }
  })

  // it('checks that the argument to registerInputTrees is an array')
  // unimplemented: it('checks that argument to registerInputTree is a tree')
})
