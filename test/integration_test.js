'use strict'

var fs = require('fs')
var path = require('path')
var RSVP = require('rsvp')
var fixturify = require('fixturify')
var Fixturify = require('broccoli-fixturify')
var Plugin = require('../index')
var chai = require('chai'), expect = chai.expect
var chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
var multidepPackages = require('multidep')('test/multidep.json')


AnnotatingPlugin.prototype = Object.create(Plugin.prototype)
AnnotatingPlugin.prototype.constructor = AnnotatingPlugin
function AnnotatingPlugin() {
  Plugin.apply(this, arguments)
}
AnnotatingPlugin.prototype.build = function() {
  for (var i = 0; i < this.inputPaths.length; i++) {
    var files = fs.readdirSync(this.inputPaths[i])
    for (var j = 0; j < files.length; j++) {
      var content = fs.readFileSync(path.join(this.inputPaths[i], files[j]))
      content += ' - from input node #' + i
      fs.writeFileSync(path.join(this.outputPath, files[j]), content)
    }
  }
}



describe('integration test', function(){
  var node1, node2

  beforeEach(function() {
    node1 = new Fixturify({ 'foo.txt': 'foo contents' })
    node2 = new Fixturify({ 'bar.txt': 'bar contents' })
  })

  var builder

  afterEach(function() {
    if (builder) {
      return RSVP.resolve(builder.cleanup()).then(function() {
        builder = null
      })
    }
  })

  describe('.read compatibility code', function() {
    var Builder_0_16 = multidepPackages['broccoli']['0.16.8']().Builder

    it('sets description', function() {
      var node = new AnnotatingPlugin([], {
        name: 'SomePlugin',
        annotation: 'some annotation'
      })
      builder = new Builder_0_16(node)
      return builder.build()
        .then(function(hash) {
          return expect(hash.graph.toJSON().description).to.equal('SomePlugin: some annotation')
        })
    })

    it('handles readCompat initialization errors', function() {
      var node = new AnnotatingPlugin([])
      var initializeReadCompatCalls = 0
      node._initializeReadCompat = function() { // stub
        throw new Error('someError ' + (++initializeReadCompatCalls))
      }
      builder = new Builder_0_16(node)
      return RSVP.Promise.resolve()
        .then(function() {
          return expect(builder.build()).to.be.rejectedWith(Error, 'someError 1')
        })
        .then(function() {
          return expect(builder.build()).to.be.rejectedWith(Error, 'someError 1')
        })
    })
  })

  multidepPackages.broccoli.forEachVersion(function(broccoliVersion, module) {
    var Builder = module.Builder

    // Call .build on the builder and return outputPath; works across Builder
    // versions
    function build(builder) {
      return RSVP.Promise.resolve()
        .then(function() {
          return builder.build()
        })
        .then(function(hash) {
          return /^0\./.test(broccoliVersion) ? hash.directory : builder.outputPath
        })
    }

    describe('Broccoli ' + broccoliVersion, function(){
      it('works without errors', function(){
        builder = new Builder(new AnnotatingPlugin([node1, node2]))
        return expect(build(builder).then(function(outputPath) {
          return fixturify.readSync(outputPath)
        })).to.eventually.deep.equal({
          'foo.txt': 'foo contents - from input node #0',
          'bar.txt': 'bar contents - from input node #1'
        })
      })

      describe('persistent output', function() {
        BuildOnce.prototype = Object.create(Plugin.prototype)
        BuildOnce.prototype.constructor = BuildOnce
        function BuildOnce(options) {
          Plugin.call(this, [], options)
        }

        BuildOnce.prototype.build = function() {
          if (!(this.builtOnce)) {
            this.builtOnce = true
            fs.writeFileSync(path.join(this.outputPath, 'foo.txt'), 'test')
          }
        }

        function isPersistent(options) {
          var builder = new Builder(new BuildOnce(options))
          function buildAndCheckExistence() {
            return build(builder)
              .then(function(outputPath) {
                return fs.existsSync(path.join(outputPath, 'foo.txt'))
              })
          }
          return expect(buildAndCheckExistence()).to.eventually.equal(true)
            .then(buildAndCheckExistence)
            .finally(function() { builder.cleanup() })
        }

        it('is not persistent by default', function() {
          return expect(isPersistent({})).to.eventually.equal(false)
        })

        it('is not persistent when persistentOutput is false', function() {
          return expect(isPersistent({ persistentOutput: false })).to.eventually.equal(false)
        })

        it('is persistent when persistentOutput is true', function() {
          return expect(isPersistent({ persistentOutput: true })).to.eventually.equal(true)
        })
      })
    })
  })
})
