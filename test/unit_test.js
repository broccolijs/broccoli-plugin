const Plugin = require('../dist/index');
const chai = require('chai'),
  expect = chai.expect;
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

class NoopPlugin extends Plugin {
  build() {}
}

describe('unit tests', function() {
  it('produces correct toString result', function() {
    expect(new NoopPlugin([]) + '').to.equal('[NoopPlugin]');
    expect(new NoopPlugin([], { name: 'FooPlugin' }) + '').to.equal('[FooPlugin]');
    expect(new NoopPlugin([], { annotation: 'some note' }) + '').to.equal(
      '[NoopPlugin: some note]'
    );
  });

  describe('usage errors', function() {
    it('validates inputNodes', function() {
      class TestPlugin extends Plugin {
        build() {}
      }

      expect(function() {
        new TestPlugin();
      }).to.throw(
        TypeError,
        'TestPlugin: Expected an array of input nodes (input trees), got undefined'
      );

      expect(function() {
        new TestPlugin({});
      }).to.throw(
        TypeError,
        'TestPlugin: Expected an array of input nodes (input trees), got [object Object]'
      );

      expect(function() {
        new TestPlugin({ length: 1 });
      }).to.throw(
        TypeError,
        'TestPlugin: Expected an array of input nodes (input trees), got [object Object]'
      );

      expect(function() {
        new TestPlugin([null]);
      }).to.throw(TypeError, 'TestPlugin: Expected Broccoli node, got null for inputNodes[0]');

      expect(function() {
        new TestPlugin([undefined]);
      }).to.throw(TypeError, 'TestPlugin: Expected Broccoli node, got undefined for inputNodes[0]');

      expect(function() {
        new TestPlugin([true]);
      }).to.throw(TypeError, 'TestPlugin: Expected Broccoli node, got true for inputNodes[0]');

      expect(function() {
        new TestPlugin([[]]);
      }).to.throw(TypeError, /TestPlugin: Expected Broccoli node/);

      // Expect not to throw
      new TestPlugin([]);
      new TestPlugin(['some/path']);
      new TestPlugin([new TestPlugin([])]);
    });

    it('disallows overriding read, cleanup, and rebuild', function() {
      let prohibitedNames = ['read', 'rebuild', 'cleanup'];
      for (let i = 0; i < prohibitedNames.length; i++) {
        class BadPlugin extends Plugin {
          build() {}
        }

        BadPlugin.prototype[prohibitedNames[i]] = () => {};

        expect(function() {
          new BadPlugin([]);
        }).to.throw(/For compatibility, plugins must not define/);
      }
    });

    it('checks that the inputNodes argument is an array', function() {
      expect(function() {
        new NoopPlugin('notAnArray');
      }).to.throw(/Expected an array/);
    });

    it('throws runtime exceptions if inputPaths/outputPath are accessed prematurily', function() {
      expect(function() {
        new class extends Plugin {
          constructor(...args) {
            super(...args);
            this.inputPaths;
          }
        }([]);
      }).to.throw(/BroccoliPlugin: this.inputPaths is only accessible once the build has begun./);

      expect(function() {
        new class extends Plugin {
          constructor(...args) {
            super(...args);
            this.outputPath;
          }
        }([]);
      }).to.throw(/BroccoliPlugin: this.outputPath is only accessible once the build has begun./);

      class Other extends Plugin {}
      const subject = new Other([]);
      expect(() => subject.inputPaths).to.throw(
        /BroccoliPlugin: this.inputPaths is only accessible once the build has begun./
      );
      expect(() => subject.outputPath).to.throw(
        /BroccoliPlugin: this.outputPath is only accessible once the build has begun./
      );
    });

    it('throws runtime exceptions if input/output are accessed prematurily', function() {
      expect(function() {
        new class extends Plugin {
          constructor(...args) {
            super(...args);
            this.input;
          }
        }([]);
      }).to.throw(/BroccoliPlugin: this.input is only accessible once the build has begun./);

      expect(function() {
        new class extends Plugin {
          constructor(...args) {
            super(...args);
            this.output;
          }
        }([]);
      }).to.throw(/BroccoliPlugin: this.output is only accessible once the build has begun./);

      class Other extends Plugin {}
      const subject = new Other([]);
      expect(() => subject.input).to.throw(
        /BroccoliPlugin: this.input is only accessible once the build has begun./
      );
      expect(() => subject.output).to.throw(
        /BroccoliPlugin: this.output is only accessible once the build has begun./
      );
    });
  });

  describe('__broccoliGetInfo__', function() {
    describe('builderFeatures argument', function() {
      function expectBasicInterface(pluginInterface) {
        expect(pluginInterface).to.have.property('nodeType', 'transform');
        expect(pluginInterface)
          .to.have.property('inputNodes')
          .that.deep.equals([]);
        expect(pluginInterface).to.have.property('persistentOutput', false);
        expect(pluginInterface).to.have.property('name', 'NoopPlugin');
        expect(pluginInterface).to.have.property('annotation', undefined);

        expect(typeof pluginInterface.setup).to.equal('function');
        expect(typeof pluginInterface.getCallbackObject).to.equal('function');
        expect(typeof pluginInterface.instantiationStack).to.equal('string');
      }

      it('returns a plugin interface with explicit feature flags', function() {
        let node = new NoopPlugin([]);
        expectBasicInterface(
          node.__broccoliGetInfo__({
            persistentOutputFlag: true,
            sourceDirectories: true,
          })
        );
      });

      it('defaults to the default featureset if no features are provided', function() {
        let node = new NoopPlugin([]);

        expectBasicInterface(node.__broccoliGetInfo__());
      });

      it('throws an error when not passed enough feature flags', function() {
        let node = new NoopPlugin([]);
        expect(function() {
          // Pass empty features object, rather than missing (= default) argument
          node.__broccoliGetInfo__({});
        }).to.throw(/Minimum builderFeatures not met/);
      });
    });

    describe('features', function() {
      it('sets needsCache if provided at instantiation`', function() {
        let node = new NoopPlugin([], {
          needsCache: false,
        });

        {
          // legacy builder
          let pluginInterface = node.__broccoliGetInfo__({
            persistentOutputFlag: true,
            sourceDirectories: true,
          });
          expect(pluginInterface).to.not.have.property('needsCache');
        }

        {
          // normal modern builder
          let pluginInterface = node.__broccoliGetInfo__({
            persistentOutputFlag: true,
            sourceDirectories: true,
            needsCacheFlag: true,
          });

          expect(pluginInterface).to.have.property('needsCache', false);
        }
      });
    });

    describe('backwards compatibility', function() {
      // All we're testing here is that old builder versions don't get
      // properties that they don't support from __broccoliGetInfo__(). They
      // typically won't care, so this is mostly for the sake of exactness.
      //
      // The main backwards compatiblity tests are not here but in the
      // integration test suite, which tests against all Broccoli versions.

      let node = new NoopPlugin([]);

      it('2 feature flags', function() {
        expect(
          node.__broccoliGetInfo__({
            persistentOutputFlag: true,
            sourceDirectories: true,
          })
        ).to.have.all.keys([
          'nodeType',
          'inputNodes',
          'setup',
          'getCallbackObject',
          'instantiationStack',
          'name',
          'annotation',
          'persistentOutput',
        ]);
      });

      it('3 feature flags', function() {
        expect(
          node.__broccoliGetInfo__({
            persistentOutputFlag: true,
            sourceDirectories: true,
            needsCacheFlag: true,
          })
        ).to.have.all.keys([
          'nodeType',
          'inputNodes',
          'setup',
          'getCallbackObject',
          'instantiationStack',
          'name',
          'annotation',
          'persistentOutput',
          'needsCache',
        ]);
      });

      it('4 feature flags', function() {
        expect(
          node.__broccoliGetInfo__({
            persistentOutputFlag: true,
            sourceDirectories: true,
            needsCacheFlag: true,
            volatileFlag: true,
          })
        ).to.have.all.keys([
          'nodeType',
          'inputNodes',
          'setup',
          'getCallbackObject',
          'instantiationStack',
          'name',
          'annotation',
          'persistentOutput',
          'needsCache',
          'volatile',
        ]);
      });

      it('5 feature flags', function() {
        expect(
          node.__broccoliGetInfo__({
            persistentOutputFlag: true,
            sourceDirectories: true,
            needsCacheFlag: true,
            volatileFlag: true,
            trackInputChangesFlag: true,
          })
        ).to.have.all.keys([
          'nodeType',
          'inputNodes',
          'setup',
          'getCallbackObject',
          'instantiationStack',
          'name',
          'annotation',
          'persistentOutput',
          'needsCache',
          'volatile',
          'trackInputChanges',
        ]);
      });
    });
  });
});
