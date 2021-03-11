import Plugin = require('./index');
import fs = require('fs');
import path = require('path');
import quickTemp = require('quick-temp');
import mapSeries = require('promise-map-series');
import rimraf = require('rimraf');
import symlinkOrCopy = require('symlink-or-copy');
const symlinkOrCopySync = symlinkOrCopy.sync;

import { InputNode, TransformNodeInfo, CallbackObject } from 'broccoli-node-api';
import { MapSeriesIterator } from './interfaces';

interface PluginWithDescription extends Plugin {
  description?: string;
}

const READ_COMPAT_FEATURES = Object.freeze({
  // these two features are supported by the old builders which still utilize read()
  persistentOutputFlag: true,
  sourceDirectories: true,
  // ReadCompat provides this capability as the builder relying on ReadCompat may not
  needsCacheFlag: true,
});

// Mimic how a Broccoli builder would call a plugin, using quickTemp to create
// directories
export default class ReadCompat {
  pluginInterface: TransformNodeInfo;
  inputPaths: string[];
  inputBasePath!: string;
  cachePath?: string;
  outputPath!: string;

  private _priorBuildInputNodeOutputPaths: string[];
  callbackObject: CallbackObject;

  constructor(plugin: PluginWithDescription) {
    this.pluginInterface = plugin.__broccoliGetInfo__(READ_COMPAT_FEATURES);

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

    this.pluginInterface.setup(
      {},
      {
        inputPaths: this.inputPaths,
        outputPath: this.outputPath,
        cachePath: this.cachePath,
      }
    );

    this.callbackObject = this.pluginInterface.getCallbackObject();

    if (plugin.description == null) {
      plugin.description = this.pluginInterface.name;
      if (this.pluginInterface.annotation != null) {
        plugin.description += ': ' + this.pluginInterface.annotation;
      }
    }
  }

  read(readTree: MapSeriesIterator<InputNode>): Promise<string> {
    if (!this.pluginInterface.persistentOutput) {
      rimraf.sync(this.outputPath);
      fs.mkdirSync(this.outputPath);
    }

    return mapSeries(this.pluginInterface.inputNodes, readTree)
      .then(outputPaths => {
        const priorBuildInputNodeOutputPaths = this._priorBuildInputNodeOutputPaths;
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

            symlinkOrCopySync(currentPath as string, this.inputPaths[i]);
          }
        }

        // save for next builds comparison
        this._priorBuildInputNodeOutputPaths = outputPaths as string[];

        return this.callbackObject.build();
      })
      .then(() => this.outputPath);
  }

  cleanup(): void {
    quickTemp.remove(this, 'outputPath');
    quickTemp.remove(this, 'cachePath');
    quickTemp.remove(this, 'inputBasePath');
  }
}
