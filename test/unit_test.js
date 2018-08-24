'use strict';

var Plugin = require('../index');
var chai = require('chai'),
  expect = chai.expect;
var chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

class NoopPlugin extends Plugin {
  build() {}
}

describe('unit tests', function() {
  it('produces correct toString result', function() {
    expect(new NoopPlugin([]) + '').to.equal('[NoopPlugin]');
    expect(new NoopPlugin([], { name: 'FooPlugin' }) + '').to.equal(
      '[FooPlugin]'
    );
    expect(new NoopPlugin([], { annotation: 'some note' }) + '').to.equal(
      '[NoopPlugin: some note]'
    );
  });

  describe('usage errors', function() {
    it('requires the base constructor to be called (super)', function() {
      class TestPlugin extends Plugin {
        constructor() {}
        build() {}
      }

      return expect(function() {
        new TestPlugin().__broccoliGetInfo__();
      }).to.throw(Error, /call super constructor/);
    });

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
      }).to.throw(
        TypeError,
        'TestPlugin: Expected Broccoli node, got null for inputNodes[0]'
      );

      expect(function() {
        new TestPlugin([undefined]);
      }).to.throw(
        TypeError,
        'TestPlugin: Expected Broccoli node, got undefined for inputNodes[0]'
      );

      expect(function() {
        new TestPlugin([true]);
      }).to.throw(
        TypeError,
        'TestPlugin: Expected Broccoli node, got true for inputNodes[0]'
      );

      expect(function() {
        new TestPlugin([[]]);
      }).to.throw(TypeError, /TestPlugin: Expected Broccoli node/);

      // Expect not to throw
      new TestPlugin([]);
      new TestPlugin(['some/path']);
      new TestPlugin([new TestPlugin([])]);
    });

    it('disallows overriding read, cleanup, and rebuild', function() {
      var prohibitedNames = ['read', 'rebuild', 'cleanup'];
      for (var i = 0; i < prohibitedNames.length; i++) {
        class BadPlugin extends Plugin {
          build() {}
        }
        BadPlugin.prototype[prohibitedNames[i]] = function() {};

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

    it('provides a helpful error message on missing `new`', function() {
      expect(function() {
        NoopPlugin([]);
      }).to.throw(/cannot be invoked without \'new\'/);
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
        var node = new NoopPlugin([]);
        expectBasicInterface(
          node.__broccoliGetInfo__({
            persistentOutputFlag: true,
            sourceDirectories: true
          })
        );
      });

      it('returns a plugin interface when no feature flags are given', function() {
        var node = new NoopPlugin([]);
        expectBasicInterface(node.__broccoliGetInfo__());
      });

      it('throws an error when not passed enough feature flags', function() {
        var node = new NoopPlugin([]);
        expect(function() {
          // Pass empty features object, rather than missing (= default) argument
          node.__broccoliGetInfo__({});
        }).to.throw(/Minimum builderFeatures required/);
      });
    });

    describe('features', function() {
      it('sets needsCache if provided at instantiation`', function() {
        var node = new NoopPlugin([], {
          needsCache: false
        });

        var pluginInterface = node.__broccoliGetInfo__();
        expect(pluginInterface).to.have.property('needsCache', false);
      });
    });

    describe('backwards compatibility', function() {
      // All we're testing here is that old builder versions don't get
      // properties that they don't support from __broccoliGetInfo__(). They
      // typically won't care, so this is mostly for the sake of exactness.
      //
      // The main backwards compatiblity tests are not here but in the
      // integration test suite, which tests against all Broccoli versions.

      var node = new NoopPlugin([]);

      it('2 feature flags', function() {
        expect(
          node.__broccoliGetInfo__({
            persistentOutputFlag: true,
            sourceDirectories: true
          })
        ).to.have.all.keys([
          'nodeType',
          'inputNodes',
          'setup',
          'getCallbackObject',
          'instantiationStack',
          'name',
          'annotation',
          'persistentOutput'
        ]);
      });

      it('3 feature flags', function() {
        expect(
          node.__broccoliGetInfo__({
            persistentOutputFlag: true,
            sourceDirectories: true,
            needsCacheFlag: true
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
          'needsCache'
        ]);
      });
    });
  });
});
