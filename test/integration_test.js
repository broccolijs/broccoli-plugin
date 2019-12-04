const fs = require('fs');
const path = require('path');
const RSVP = require('rsvp');
const fixturify = require('fixturify');
const Fixturify = require('broccoli-fixturify');
const Plugin = require('../dist/index');
const chai = require('chai'),
  expect = chai.expect;
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const multidepRequire = require('multidep')('test/multidep.json');
const quickTemp = require('quick-temp');
const symlinkOrCopy = require('symlink-or-copy');

function copyFilesWithAnnotation(sourceDirId, sourceDir, destDir) {
  let files = fs.readdirSync(sourceDir);
  for (let j = 0; j < files.length; j++) {
    let content = fs.readFileSync(path.join(sourceDir, files[j]));
    content += ' - from input node #' + sourceDirId;
    fs.writeFileSync(path.join(destDir, files[j]), content);
  }
}

class AnnotatingPlugin extends Plugin {
  build() {
    for (let i = 0; i < this.inputPaths.length; i++) {
      copyFilesWithAnnotation(i, this.inputPaths[i], this.outputPath);
    }
  }
}

class NoopPlugin extends Plugin {
  build() {}
}

describe('integration test', function() {
  let node1, node2;

  beforeEach(function() {
    node1 = new Fixturify({ 'foo.txt': 'foo contents' });
    node2 = new Fixturify({ 'bar.txt': 'bar contents' });
  });

  let builder;

  afterEach(function() {
    if (builder) {
      return RSVP.resolve(builder.cleanup()).then(function() {
        builder = null;
      });
    }
  });

  describe('.read compatibility code', function() {
    let Builder_0_16 = multidepRequire('broccoli', '0.16.9').Builder;

    it('sets description', function() {
      let node = new AnnotatingPlugin([], {
        name: 'SomePlugin',
        annotation: 'some annotation',
      });
      builder = new Builder_0_16(node);
      return builder.build().then(function(hash) {
        return expect(hash.graph.toJSON().description).to.equal('SomePlugin: some annotation');
      });
    });

    it('handles readCompat initialization errors', function() {
      let node = new AnnotatingPlugin([]);
      let initializeReadCompatCalls = 0;
      node._initializeReadCompat = function() {
        // stub
        throw new Error('someError ' + ++initializeReadCompatCalls);
      };
      builder = new Builder_0_16(node);
      return RSVP.Promise.resolve()
        .then(function() {
          return expect(builder.build()).to.be.rejectedWith(Error, 'someError 1');
        })
        .then(function() {
          return expect(builder.build()).to.be.rejectedWith(Error, 'someError 1');
        });
    });

    describe('stable inputPaths', function() {
      let tmp, inputPaths, originalCanSymlink, builder;

      beforeEach(function() {
        inputPaths = [];

        originalCanSymlink = symlinkOrCopy.canSymlink;
        tmp = {};
      });

      afterEach(function() {
        symlinkOrCopy.setOptions({
          fs,
          isWindows: process.platform === 'win32',
          canSymlink: originalCanSymlink,
        });

        quickTemp.remove(tmp, 'fixtures');

        return builder && builder.cleanup();
      });

      function UnstableOutputPathTree(inputTree) {
        this._inputTree = inputTree;
        quickTemp.makeOrReuse(this, 'outputBasePath');
        this._buildCount = 0;
      }
      UnstableOutputPathTree.prototype.read = function(readTree) {
        let self = this;

        quickTemp.makeOrRemake(self, 'outputBasePath');

        return readTree(this._inputTree).then(function(inputTreesOutputPath) {
          let outputPath = path.join(self.outputBasePath, '' + self._buildCount++);
          fs.mkdirSync(outputPath);

          copyFilesWithAnnotation(0, inputTreesOutputPath, outputPath);

          return outputPath;
        });
      };
      UnstableOutputPathTree.prototype.cleanup = function() {
        quickTemp.remove(this, 'outputBasePath');
      };

      function StableOutputPathTree(inputTree) {
        this._inputTree = inputTree;
        quickTemp.makeOrReuse(this, 'outputPath');
      }
      StableOutputPathTree.prototype.read = function(readTree) {
        let self = this;

        quickTemp.makeOrRemake(self, 'outputPath');

        return readTree(this._inputTree).then(function(inputTreesOutputPath) {
          copyFilesWithAnnotation(0, inputTreesOutputPath, self.outputPath);

          return self.outputPath;
        });
      };
      StableOutputPathTree.prototype.cleanup = function() {
        quickTemp.remove(this, 'outputPath');
      };

      class InputPathTracker extends Plugin {
        build() {
          inputPaths.push(this.inputPaths[0]);

          return AnnotatingPlugin.prototype.build.apply(this, arguments);
        }
      }

      function isConsistent(inputNode) {
        builder = new Builder_0_16(inputNode);

        function buildAndCheck() {
          return RSVP.Promise.resolve()
            .then(function() {
              return builder.build();
            })
            .then(function(hash) {
              return fixturify.readSync(hash.directory);
            })
            .then(function(fixture) {
              expect(fixture).to.deep.equal({
                'foo.txt': 'foo contents - from input node #0 - from input node #0',
              });

              return fixture;
            });
        }
        return buildAndCheck()
          .then(buildAndCheck)
          .then(function() {
            expect(inputPaths[0]).to.equal(inputPaths[1]);
          });
      }

      it('provides stable inputPaths when upstream output path changes', function() {
        let unstableNode = new UnstableOutputPathTree(node1);
        let inputTracker = new InputPathTracker([unstableNode]);

        return isConsistent(inputTracker);
      });

      it('provides stable inputPaths when upstream output path is consistent', function() {
        let unstableNode = new StableOutputPathTree(node1);
        let inputTracker = new InputPathTracker([unstableNode]);

        return isConsistent(inputTracker);
      });

      it('provides stable inputPaths when upstream output path is consistent without symlinking', function() {
        symlinkOrCopy.setOptions({
          fs,
          isWindows: process.platform === 'win32',
          canSymlink: false,
        });

        quickTemp.makeOrRemake(tmp, 'fixtures');
        fixturify.writeSync(tmp.fixtures, {
          'foo.txt': 'foo contents',
        });

        let unstableNode = new StableOutputPathTree(tmp.fixtures);
        let inputTracker = new InputPathTracker([unstableNode]);

        return isConsistent(inputTracker)
          .then(function() {
            fixturify.writeSync(tmp.fixtures, {
              'foo.txt': 'foo other contents',
            });

            return builder.build();
          })
          .then(function(hash) {
            let fixture = fixturify.readSync(hash.directory);

            expect(fixture).to.deep.equal({
              'foo.txt': 'foo other contents - from input node #0 - from input node #0',
            });
          });
      });
    });
  });

  multidepRequire.forEachVersion('broccoli', function(broccoliVersion, module) {
    let Builder = module.Builder;

    // Call .build on the builder and return outputPath; works across Builder
    // versions
    function build(builder) {
      return RSVP.Promise.resolve()
        .then(function() {
          return builder.build();
        })
        .then(function(hash) {
          return /^0\./.test(broccoliVersion) ? hash.directory : builder.outputPath;
        });
    }

    describe('Broccoli ' + broccoliVersion, function() {
      it('works without errors', function() {
        builder = new Builder(new AnnotatingPlugin([node1, node2]));
        return expect(
          build(builder).then(function(outputPath) {
            return fixturify.readSync(outputPath);
          })
        ).to.eventually.deep.equal({
          'foo.txt': 'foo contents - from input node #0',
          'bar.txt': 'bar contents - from input node #1',
        });
      });

      describe('persistent fs', function() {
        class BuildOnce extends Plugin {
          build() {
            if (!this.builtOnce) {
              this.builtOnce = true;
              fs.writeFileSync(path.join(this.outputPath, 'foo.txt'), 'test');
            }
          }
        }

        function isPersistent(options) {
          let buildOnce = new BuildOnce([], options);
          let builder = new Builder(buildOnce);
          function buildAndCheckExistence() {
            return build(builder).then(function() {
              return buildOnce.output.existsSync('foo.txt');
            });
          }
          return expect(buildAndCheckExistence())
            .to.eventually.equal(true)
            .then(buildAndCheckExistence)
            .finally(function() {
              builder.cleanup();
            });
        }

        it('is not persistent by default', function() {
          return expect(isPersistent({})).to.eventually.equal(false);
        });

        it('is not persistent when persistentOutput is false', function() {
          return expect(isPersistent({ persistentOutput: false })).to.eventually.equal(false);
        });

        it('is persistent when persistentOutput is true', function() {
          return expect(isPersistent({ persistentOutput: true })).to.eventually.equal(true);
        });
      });

      describe('persistent InputOutput', function() {
        class BuildOnce extends Plugin {
          build() {
            if (!this.builtOnce) {
              this.builtOnce = true;
              this.output.writeFileSync('foo.txt', 'test');
            }
          }
        }

        function isPersistent(options) {
          let buildOnce = new BuildOnce([], options);
          let builder = new Builder(buildOnce);
          function buildAndCheckExistence() {
            return build(builder).then(function() {
              return buildOnce.output.existsSync('foo.txt');
            });
          }
          return expect(buildAndCheckExistence())
            .to.eventually.equal(true)
            .then(buildAndCheckExistence)
            .finally(function() {
              builder.cleanup();
            });
        }

        it('is not persistent by default', function() {
          return expect(isPersistent({})).to.eventually.equal(false);
        });

        it('is not persistent when persistentOutput is false', function() {
          return expect(isPersistent({ persistentOutput: false })).to.eventually.equal(false);
        });

        it('is persistent when persistentOutput is true', function() {
          return expect(isPersistent({ persistentOutput: true })).to.eventually.equal(true);
        });
      });

      describe('needsCache', function() {
        function hasCacheDirectory(options) {
          let plugin = new NoopPlugin([], options);
          let builder = new Builder(plugin);
          return build(builder)
            .then(function() {
              if (plugin.cachePath != null) {
                expect(fs.existsSync(plugin.cachePath)).to.equal(true);
              }
              return plugin.cachePath != null;
            })
            .finally(function() {
              builder.cleanup();
            });
        }

        it('has cache directory by default', function() {
          return expect(hasCacheDirectory()).to.eventually.equal(true);
        });

        it('has no cache directory when needsCache is false', function() {
          return expect(hasCacheDirectory({ needsCache: false })).to.eventually.equal(false);
        });

        it('has cache directory when needsCache is true', function() {
          return expect(hasCacheDirectory({ needsCache: true })).to.eventually.equal(true);
        });
      });
    });
  });
});
