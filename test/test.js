var fs = require('fs')
var path = require('path')
var RSVP = require('rsvp')
var fixturify = require('fixturify')
var fixtureNode = require('broccoli-fixturify')
var Plugin = require('../index')
var chai = require('chai'), expect = chai.expect
var chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)

var Builder_0_16_3 = require('./dependencies/broccoli-0.16.3').Builder


function makePlugin(props) {
  TestPlugin.prototype = Object.create(Plugin.prototype)
  TestPlugin.prototype.constructor = TestPlugin
  function TestPlugin() {
    Plugin.apply(this, arguments)
  }

  TestPlugin.prototype.build = function() {} // empty default

  for (key in props) {
    TestPlugin.prototype[key] = props[key]
  }

  return TestPlugin
}

var AnnotatingPlugin = makePlugin({
  build: function() {
    for (var i = 0; i < this.inputPaths.length; i++) {
      var files = fs.readdirSync(this.inputPaths[i])
      for (var j = 0; j < files.length; j++) {
        var content = fs.readFileSync(path.join(this.inputPaths[i], files[j]))
        content += ' - from input node #' + i
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

var build = function(builder) {
  return RSVP.Promise.resolve()
    .then(function() {
      return builder.build()
    })
    .then(function(hash) {
      return fixturify.readSync(hash.directory)
    })
    .finally(function() {
      return builder.cleanup()
    })
}


describe('integration test', function(){
  var node1, node2

  beforeEach(function() {
    node1 = fixtureNode({ 'foo.txt': 'foo contents' })
    node2 = fixtureNode({ 'bar.txt': 'bar contents' })
  })

  describe('Broccoli with .read API', function(){
    it('works without errors', function(){
      return expect(build(new Builder_0_16_3(new AnnotatingPlugin([node1, node2]))))
        .to.eventually.deep.equal({
          'foo.txt': 'foo contents - from input node #0',
          'bar.txt': 'bar contents - from input node #1'
        })
    })

    it('handles readCompat initialization errors', function() {
      var node = new AnnotatingPlugin([])
      var initializeReadCompatCalls = 0
      node._initializeReadCompat = function() { // stub
        throw new Error('someError ' + (++initializeReadCompatCalls))
      }
      var builder = new Builder_0_16_3(node)
      return RSVP.Promise.resolve()
        .then(function() {
          return expect(builder.build()).to.be.rejectedWith(Error, 'someError 1')
        })
        .then(function() {
          return expect(builder.build()).to.be.rejectedWith(Error, 'someError 1')
        })
    })
  })
})


describe('usage errors', function() {
  it('requires the base constructor to be called (super)', function() {
    TestPlugin.prototype = Object.create(Plugin.prototype)
    TestPlugin.prototype.constructor = TestPlugin
    function TestPlugin() { /* no Plugin.apply(this, arguments) here */ }
    TestPlugin.prototype.build = function() {}

    return expect(build(new Builder_0_16_3(new TestPlugin)))
      .to.be.rejectedWith(Error, /must call the superclass constructor/)
  })

  it('disallows overriding read, cleanup, and rebuild', function() {
    var badPlugins = [
      makePlugin({ read: function() {} })
    , makePlugin({ rebuild: function() {} })
    , makePlugin({ cleanup: function() {} })
    ]
    for (var i = 0; i < badPlugins.length; i++) {
      expect(function() { new badPlugins[i]([]) })
        .to.throw(/For compatibility, plugins must not define/)
    }
  })

  it('checks that the inputNodes argument is an array', function() {
    expect(function() { new AnnotatingPlugin('notAnArray') })
      .to.throw(/Expected an array/)
  })

  it('provides a helpful error message on missing `new`', function() {
    expect(function() { AnnotatingPlugin([]) })
      .to.throw(/Missing `new`/)
  })
})
