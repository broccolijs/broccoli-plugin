'use strict';

import {
  CallbackObject,
  TransformNode,
  TransformNodeInfo
} from 'broccoli-node-api';
import fs = require('fs');
import path = require('path');
import rimraf = require('rimraf');

// tslint:disable-next-line:no-var-requires
const quickTemp: any = require('quick-temp');
// tslint:disable-next-line:no-var-requires
const symlinkOrCopy: any = require('symlink-or-copy');
const symlinkOrCopySync = symlinkOrCopy.sync;

// Mimic how a Broccoli builder would call a plugin, using quickTemp to create
// directories
export = ReadCompat;
class ReadCompat {
  public inputPaths: string[];
  public outputPath!: string; // assigned by quicktemp
  public cachePath: string | undefined;

  private pluginInterface: TransformNodeInfo;
  private callbackObject: CallbackObject;

  private inputBasePath!: string; // assigned by quicktemp
  private _priorBuildInputNodeOutputPaths: string[];

  constructor(plugin: TransformNode & { description?: string }) {
    this.pluginInterface = plugin.__broccoliGetInfo__(
      plugin.__broccoliFeatures__
    );

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

    // TODO, apparently it is ok for setup to be called with null
    // also need to make cachePath optional
    this.pluginInterface.setup(plugin.__broccoliFeatures__, {
      cachePath: this.cachePath!,
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

  public async read(
    readTree: (tree: object | string) => Promise<string>
  ): Promise<string> {
    if (!this.pluginInterface.persistentOutput) {
      rimraf.sync(this.outputPath);
      fs.mkdirSync(this.outputPath);
    }

    const outputPaths = [] as string[];
    const inputNodes = this.pluginInterface.inputNodes;
    for (const inputNode of inputNodes) {
      outputPaths.push(await readTree(inputNode));
    }

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

        symlinkOrCopySync(currentPath, this.inputPaths[i]);
      }
    }

    // save for next builds comparison
    this._priorBuildInputNodeOutputPaths = outputPaths;

    await this.callbackObject.build();

    return this.outputPath;
  }

  public cleanup() {
    quickTemp.remove(this, 'outputPath');
    quickTemp.remove(this, 'cachePath');
    quickTemp.remove(this, 'inputBasePath');
  }
}
