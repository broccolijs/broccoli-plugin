import { MapSeriesIterator } from '../src/interfaces';

declare function mapSeries<T>(
  array: T[],
  interator: MapSeriesIterator<T>,
  thisArg?: unknown
): Promise<T[]>;

export = mapSeries;
