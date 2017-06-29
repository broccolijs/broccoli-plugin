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
var multidepRequire = require('multidep')('test/multidep.json')
var quickTemp = require('quick-temp')
var symlinkOrCopy = require('symlink-or-copy');

function copyFilesWithAnnotation(sourceDirId, sourceDir, destDir) {
  var files = fs.readdirSync(sourceDir)
  for (var j = 0; j < files.length; j++) {
    var content = fs.readFileSync(path.join(sourceDir, files[j]))
    content += ' - from input node #' + sourceDirId
    fs.writeFileSync(path.join(destDir, files[j]), content)
  }
}

AnnotatingPlugin.prototype = Object.create(Plugin.prototype)
AnnotatingPlugin.prototype.constructor = AnnotatingPlugin
function AnnotatingPlugin() {
  Plugin.apply(this, arguments)
}
AnnotatingPlugin.prototype.build = function() {
  for (var i = 0; i < this.inputPaths.length; i++) {
    copyFilesWithAnnotation(i, this.inputPaths[i], this.outputPath)
  }
}

NoopPlugin.prototype = Object.create(Plugin.prototype)
NoopPlugin.prototype.constructor = NoopPlugin
function NoopPlugin() {
  Plugin.apply(this, arguments)
}
NoopPlugin.prototype.build = function() {}



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
    var Builder_0_16 = multidepRequire('broccoli', '0.16.9').Builder

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

    describe('stable inputPaths', function() {
      var tmp, inputPaths, originalCanSymlink, builder

      beforeEach(function() {
        inputPaths = []

        originalCanSymlink = symlinkOrCopy.canSymlink
        tmp = {}
      })

      afterEach(function() {
        symlinkOrCopy.setOptions({
          fs: fs,
          isWindows: process.platform === 'win32',
          canSymlink: originalCanSymlink
        })

        quickTemp.remove(tmp, 'fixtures')

        return builder && builder.cleanup()
      })

      function UnstableOutputPathTree(inputTree) {
        this._inputTree = inputTree;
        quickTemp.makeOrReuse(this, 'outputBasePath')
        this._buildCount = 0;
      }
      UnstableOutputPathTree.prototype.read = function(readTree) {
        var self = this

        quickTemp.makeOrRemake(self, 'outputBasePath')

        return readTree(this._inputTree)
          .then(function(inputTreesOutputPath) {
            var outputPath = path.join(self.outputBasePath, '' + self._buildCount++)
            fs.mkdirSync(outputPath)

            copyFilesWithAnnotation(0, inputTreesOutputPath, outputPath)

            return outputPath
          })
      }
      UnstableOutputPathTree.prototype.cleanup = function() {
        quickTemp.remove(this, 'outputBasePath');
      }

      function StableOutputPathTree(inputTree) {
        this._inputTree = inputTree;
        quickTemp.makeOrReuse(this, 'outputPath')
      }
      StableOutputPathTree.prototype.read = function(readTree) {
        var self = this

        quickTemp.makeOrRemake(self, 'outputPath')

        return readTree(this._inputTree)
          .then(function(inputTreesOutputPath) {
            copyFilesWithAnnotation(0, inputTreesOutputPath, self.outputPath)

            return self.outputPath
          })
      }
      StableOutputPathTree.prototype.cleanup = function() {
        quickTemp.remove(this, 'outputPath');
      }

      function InputPathTracker() {
        Plugin.apply(this, arguments)
      }
      InputPathTracker.prototype = Object.create(AnnotatingPlugin.prototype)
      InputPathTracker.prototype.constructor = InputPathTracker

      InputPathTracker.prototype.build = function() {
        inputPaths.push(this.inputPaths[0]);

        return AnnotatingPlugin.prototype.build.apply(this, arguments);
      }

      function isConsistent(inputNode) {
        builder = new Builder_0_16(inputNode)

        function buildAndCheck() {
          return RSVP.Promise.resolve()
            .then(function() {
              return builder.build()
            })
            .then(function(hash) {
              return fixturify.readSync(hash.directory)
            })
            .then(function(fixture) {
              expect(fixture).to.deep.equal({
                'foo.txt': 'foo contents - from input node #0 - from input node #0',
              })

              return fixture;
            })
        }
        return buildAndCheck()
          .then(buildAndCheck)
          .then(function(fileExists) {
            expect(inputPaths[0]).to.equal(inputPaths[1])
          })
      }

      it('provides stable inputPaths when upstream output path changes', function() {
        var unstableNode = new UnstableOutputPathTree(node1)
        var inputTracker = new InputPathTracker([unstableNode])

        return isConsistent(inputTracker)
      })

      it('provides stable inputPaths when upstream output path is consistent', function() {
        var unstableNode = new StableOutputPathTree(node1)
        var inputTracker = new InputPathTracker([unstableNode])

        return isConsistent(inputTracker)
      })

      it('provides stable inputPaths when upstream output path is consistent without symlinking', function() {
        symlinkOrCopy.setOptions({
          fs: fs,
          isWindows: process.platform === 'win32',
          canSymlink: false
        })

        quickTemp.makeOrRemake(tmp, 'fixtures')
        fixturify.writeSync(tmp.fixtures, {
          'foo.txt': 'foo contents'
        });

        var unstableNode = new StableOutputPathTree(tmp.fixtures)
        var inputTracker = new InputPathTracker([unstableNode])

        return isConsistent(inputTracker)
          .then(function() {
            fixturify.writeSync(tmp.fixtures, {
              'foo.txt': 'foo other contents'
            });

            return builder.build();
          })
          .then(function(hash) {
            var fixture = fixturify.readSync(hash.directory)

            expect(fixture).to.deep.equal({
              'foo.txt': 'foo other contents - from input node #0 - from input node #0',
            })
          })
      })
    })
  })

  multidepRequire.forEachVersion('broccoli', function(broccoliVersion, module) {
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

      describe('needsCache', function() {
        function hasCacheDirectory(options) {
          var plugin = new NoopPlugin([], options)
          var builder = new Builder(plugin)
          return build(builder)
            .then(function(outputPath) {
              if (plugin.cachePath != null) {
                expect(fs.existsSync(plugin.cachePath)).to.equal(true)
              }
              return plugin.cachePath != null
            })
            .finally(function() { builder.cleanup() })
        }

        it('has cache directory by default', function() {
          return expect(hasCacheDirectory()).to.eventually.equal(true)
        })

        it('has no cache directory when needsCache is false', function() {
          return expect(hasCacheDirectory({ needsCache: false })).to.eventually.equal(false)
        })

        it('has cache directory when needsCache is true', function() {
          return expect(hasCacheDirectory({ needsCache: true })).to.eventually.equal(true)
        })
      })

      describe('sideEffectFree', function() {
        function assertReads(builder, actualReads, expectedReads) {
          return builder.build().then(function (hash) {
            // ensure depth first order, so the rest of our tests make sense
            expect(actualReads.slice()).to.deep.eql(expectedReads);
            actualReads.length = 0; // reset state;
          });
        }

        var reads;

        function Pure(path, inputTrees) {
          Plugin.call(this, inputTrees || [], {
            persistentOutput: true,
            sideEffectFree: true
          })
          this.name = path;
          this._path = path;
        }

        Pure.prototype = Object.create(Plugin.prototype);
        Pure.prototype.constructor = Plugin;

        Pure.prototype.build = function() {
          this.revised();
          reads.push(this._path);
        };

        function Impure(path, inputTrees) {
          Plugin.call(this, inputTrees || [], {
            persistentOutput: true,
            sideEffectFree: false
          })
          this.name = path;
          this._path = path;
        }

        Impure.prototype = Object.create(Plugin.prototype);
        Impure.prototype.constructor = Plugin;

        Impure.prototype.build = function() {
          reads.push(this._path);
        };

        beforeEach(function() {
          reads = [];
        });

        it('works', function() {
          var a = new Pure('a');
          var b = new Pure('b');
          var c = new Pure('c');
          var d = new Pure('d', [a, b, c]);
          var e = new Pure('e');
          var f = new Pure('f');
          var g = new Pure('g', [f]);
          var h = new Pure('h', [d, e, g]);

          var builder = new Builder(h);

          return assertReads(builder, reads, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).then(function() {
            // no changes, and all are pure
            return assertReads(builder, reads, []);
          }).then(function() {
            a.revised();
            return assertReads(builder, reads, ['d', 'h']);
          }).then(function() {
            a.revised();
            f.revised();
            return assertReads(builder, reads, ['d', 'g', 'h']);
          }).then(function() {
            e.revised();
            return assertReads(builder, reads, ['h']);
          }).then(function() {
            f.revised();
            return assertReads(builder, reads, ['g', 'h']);
          }).then(function() {
            h.revised();
            return assertReads(builder, reads, []);
          })
            .finally(function() {
              return builder.cleanup();
            });
        });

        it('works with mixed capability plugins', function() {
          var a = new Pure('a');
          var b = new Pure('b');
          var c = new Pure('c');
          var d = new Pure('d', [a, b, c]);
          var e = new Pure('e');
          var f = new Pure('f');
          var g = new Impure('g', [f]);
          var h = new Pure('h', [d, e, g]);

          var builder = new Builder(h);

          return assertReads(builder, reads, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).then(function() {
            // no changes, and all are pure
            return assertReads(builder, reads, ['g', 'h']);
          }).then(function() {
            a.revised();
            return assertReads(builder, reads, ['d', 'g', 'h']);
          }).then(function() {
            a.revised();
            f.revised();
            return assertReads(builder, reads, ['d', 'g', 'h']);
          }).then(function() {
            e.revised();
            return assertReads(builder, reads, ['g', 'h']);
          }).then(function() {
            f.revised();
            return assertReads(builder, reads, ['g', 'h']);
          }).then(function() {
            h.revised();
            return assertReads(builder, reads, ['g', 'h']);
          })
            .finally(function() {
              return builder.cleanup();
            });

        });
      });
    })
  })
})
