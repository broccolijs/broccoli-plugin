import { MapSeriersIterator } from '../src/interfaces';

declare function mapSeries<T>(
  array: T[],
  interator: MapSeriersIterator<T>,
  thisArg?: any
): Promise<T[]>;

export = mapSeries;
