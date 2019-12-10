const fs = require('fs');
const path = require('path');
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
  const files = fs.readdirSync(sourceDir);
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
  build() {
    // empty method
  }
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
      return Promise.resolve(builder.cleanup()).then(function() {
        builder = null;
      });
    }
  });

  describe('.read compatibility code', function() {
    const Builder_0_16 = multidepRequire('broccoli', '0.16.9').Builder;

    it('sets description', function() {
      const node = new AnnotatingPlugin([], {
        name: 'SomePlugin',
        annotation: 'some annotation',
      });
      builder = new Builder_0_16(node);
      return builder.build().then(function(hash) {
        return expect(hash.graph.toJSON().description).to.equal('SomePlugin: some annotation');
      });
    });

    it('handles readCompat initialization errors', function() {
      const node = new AnnotatingPlugin([]);
      let initializeReadCompatCalls = 0;
      node._initializeReadCompat = function() {
        // stub
        throw new Error('someError ' + ++initializeReadCompatCalls);
      };
      builder = new Builder_0_16(node);
      return Promise.resolve()
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
        symlinkOrCopy._setOptions({
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
      UnstableOutputPathTree.prototype.read = async function(readTree) {
        quickTemp.makeOrRemake(this, 'outputBasePath');

        const inputTreesOutputPath = await readTree(this._inputTree);
        const outputPath = path.join(this.outputBasePath, '' + this._buildCount++);
        fs.mkdirSync(outputPath);

        copyFilesWithAnnotation(0, inputTreesOutputPath, outputPath);

        return outputPath;
      };
      UnstableOutputPathTree.prototype.cleanup = function() {
        quickTemp.remove(this, 'outputBasePath');
      };

      function StableOutputPathTree(inputTree) {
        this._inputTree = inputTree;
        quickTemp.makeOrReuse(this, 'outputPath');
      }
      StableOutputPathTree.prototype.read = async function(readTree) {
        quickTemp.makeOrRemake(this, 'outputPath');

        const inputTreesOutputPath = await readTree(this._inputTree);

        copyFilesWithAnnotation(0, inputTreesOutputPath, this.outputPath);

        return this.outputPath;
      };

      StableOutputPathTree.prototype.cleanup = function() {
        quickTemp.remove(this, 'outputPath');
      };

      class InputPathTracker extends Plugin {
        build(...args) {
          inputPaths.push(this.inputPaths[0]);

          return AnnotatingPlugin.prototype.build.apply(this, args);
        }
      }

      function isConsistent(inputNode) {
        builder = new Builder_0_16(inputNode);

        function buildAndCheck() {
          return Promise.resolve()
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
        const unstableNode = new UnstableOutputPathTree(node1);
        const inputTracker = new InputPathTracker([unstableNode]);

        return isConsistent(inputTracker);
      });

      it('provides stable inputPaths when upstream output path is consistent', function() {
        const unstableNode = new StableOutputPathTree(node1);
        const inputTracker = new InputPathTracker([unstableNode]);

        return isConsistent(inputTracker);
      });

      it('provides stable inputPaths when upstream output path is consistent without symlinking', async function() {
        symlinkOrCopy._setOptions({
          fs,
          isWindows: process.platform === 'win32',
          canSymlink: false,
        });

        quickTemp.makeOrRemake(tmp, 'fixtures');
        fixturify.writeSync(tmp.fixtures, {
          'foo.txt': 'foo contents',
        });

        const unstableNode = new StableOutputPathTree(tmp.fixtures);
        const inputTracker = new InputPathTracker([unstableNode]);

        await isConsistent(inputTracker);

        fixturify.writeSync(tmp.fixtures, {
          'foo.txt': 'foo other contents',
        });

        const hash = await builder.build();
        const fixture = fixturify.readSync(hash.directory);

        expect(fixture).to.deep.equal({
          'foo.txt': 'foo other contents - from input node #0 - from input node #0',
        });
      });
    });
  });

  describe('.input/.output functionality', function() {
    const Builder = multidepRequire('broccoli', '0.16.9').Builder;
    class FSFacadePlugin extends Plugin {
      build() {
        const content = this.input.readFileSync('foo.txt', 'utf-8');
        this.output.writeFileSync('complied.txt', content);
      }
    }

    it('reads file using this.input', async function() {
      const node = new FSFacadePlugin([node1, node2]);
      builder = new Builder(node);
      await builder.build();
      expect(node.input.readFileSync('foo.txt', 'utf-8')).to.equal('foo contents');
    });

    it('reads file using this.input', async function() {
      const node = new FSFacadePlugin([node1, node2]);
      builder = new Builder(node);
      await builder.build();
      expect(node.input.at(1).readFileSync('bar.txt', 'utf-8')).to.equal('bar contents');
    });

    it('writes file using this.output', async function() {
      const node = new FSFacadePlugin([node1, node2]);
      builder = new Builder(node);
      await builder.build();
      expect(node.output.readFileSync('complied.txt', 'utf-8')).to.equal('foo contents');
    });

    it('verify few operations we expect are present in input', async function() {
      const node = new FSFacadePlugin([node1, node2]);
      builder = new Builder(node);
      await builder.build();
      expect(typeof node.input.readFileSync == 'function').to.be.true;
      expect(typeof node.input.readdirSync == 'function').to.be.true;
      expect(typeof node.input.at == 'function').to.be.true;
      expect(() => {
        node.input.writeFileSync('read.md', 'test');
      }).to.throw(/Operation writeFileSync is not allowed .*/);
    });

    it('verify few operations we expect are present in output', async function() {
      const node = new FSFacadePlugin([node1, node2]);
      builder = new Builder(node);
      await builder.build();
      expect(typeof node.output.readFileSync == 'function').to.be.true;
      expect(typeof node.output.readdirSync == 'function').to.be.true;
      expect(typeof node.output.existSync == 'function').to.be.true;
      expect(typeof node.output.writeFileSync == 'function').to.be.true;
      expect(typeof node.output.rmdirSync == 'function').to.be.true;
      expect(typeof node.output.mkdirSync == 'function').to.be.true;
      expect(() => {
        node.output.readFileMeta('test.txt');
      }).to.throw(/Operation readFileMeta is not allowed .*/);
    });
  });

  multidepRequire.forEachVersion('broccoli', function(broccoliVersion, module) {
    const Builder = module.Builder;

    // Call .build on the builder and return outputPath; works across Builder
    // versions
    function build(builder) {
      return Promise.resolve()
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
          const buildOnce = new BuildOnce([], options);
          const builder = new Builder(buildOnce);
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
          const buildOnce = new BuildOnce([], options);
          const builder = new Builder(buildOnce);
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

      describe('needsCache', async function() {
        async function hasCacheDirectory(options) {
          const plugin = new NoopPlugin([], options);
          const builder = new Builder(plugin);

          try {
            await build(builder);
            if (plugin.cachePath != null) {
              expect(fs.existsSync(plugin.cachePath)).to.equal(true);
            }
            return plugin.cachePath != null;
          } finally {
            builder.cleanup();
          }
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
