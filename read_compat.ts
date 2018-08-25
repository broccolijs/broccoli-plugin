'use strict';

import fs = require('fs');
import path = require('path');
import mapSeries = require('promise-map-series');
import quickTemp = require('quick-temp');
import rimraf = require('rimraf');
import symlinkOrCopy = require('symlink-or-copy');
import symlinkOrCopySync = symlinkOrCopy.sync;

// Mimic how a Broccoli builder would call a plugin, using quickTemp to create
// directories
export = ReadCompat;
function ReadCompat(plugin) {
  this.pluginInterface = plugin.__broccoliGetInfo__();

  quickTemp.makeOrReuse(this, 'outputPath', this.pluginInterface.name);

  if (this.pluginInterface.needsCache) {
    quickTemp.makeOrReuse(this, 'cachePath', this.pluginInterface.name);
  } else {
    this.cachePath = undefined;
  }

  quickTemp.makeOrReuse(this, 'inputBasePath', this.pluginInterface.name);

  this.inputPaths = [];
  this._priorBuildInputNodeOutputPaths = [];

  if (this.pluginInterface.inputNodes.length === 1) {
    this.inputPaths.push(this.inputBasePath);
    this._priorBuildInputNodeOutputPaths.push(this.inputBasePath);
  } else {
    for (let i = 0; i < this.pluginInterface.inputNodes.length; i++) {
      this.inputPaths.push(path.join(this.inputBasePath, i + ''));
    }
  }

  this.pluginInterface.setup(null, {
    cachePath: this.cachePath,
    inputPaths: this.inputPaths,
    outputPath: this.outputPath
  });

  this.callbackObject = this.pluginInterface.getCallbackObject();

  if (plugin.description == null) {
    plugin.description = this.pluginInterface.name;
    if (this.pluginInterface.annotation != null) {
      plugin.description += ': ' + this.pluginInterface.annotation;
    }
  }
}

ReadCompat.prototype.read = function(readTree) {
  if (!this.pluginInterface.persistentOutput) {
    rimraf.sync(this.outputPath);
    fs.mkdirSync(this.outputPath);
  }

  return mapSeries(this.pluginInterface.inputNodes, readTree)
    .then(outputPaths => {
      const priorBuildInputNodeOutputPaths = this
        ._priorBuildInputNodeOutputPaths;
      // In old .read-based Broccoli, the inputNodes's outputPaths can change
      // on each rebuild. But the new API requires that our plugin sees fixed
      // input paths. Therefore, we symlink the inputNodes' outputPaths to our
      // (fixed) inputPaths on each .read.
      for (let i = 0; i < outputPaths.length; i++) {
        const priorPath = priorBuildInputNodeOutputPaths[i];
        const currentPath = outputPaths[i];

        // if this output path is different from last builds or
        // if we cannot symlink then clear and symlink/copy manually
        const hasDifferentPath = priorPath !== currentPath;
        const forceReSymlinking = !symlinkOrCopy.canSymlink || hasDifferentPath;

        if (forceReSymlinking) {
          // avoid `rimraf.sync` for initial build
          if (priorPath) {
            rimraf.sync(this.inputPaths[i]);
          }

          symlinkOrCopySync(currentPath, this.inputPaths[i]);
        }
      }

      // save for next builds comparison
      this._priorBuildInputNodeOutputPaths = outputPaths;

      return this.callbackObject.build();
    })
    .then(() => {
      return this.outputPath;
    });
};

ReadCompat.prototype.cleanup = function() {
  quickTemp.remove(this, 'outputPath');
  quickTemp.remove(this, 'cachePath');
  quickTemp.remove(this, 'inputBasePath');
};
