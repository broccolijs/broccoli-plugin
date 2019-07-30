import { MapSeriesIterator } from '../src/interfaces';

declare function mapSeries<T>(
  array: T[],
  interator: MapSeriesIterator<T>,
  thisArg?: any
): Promise<T[]>;

export = mapSeries;
