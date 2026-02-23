import { MapSeriesIterator } from '../src/interfaces';

export default function mapSeries<T>(
  array: T[],
  interator: MapSeriesIterator<T>,
  thisArg?: unknown
): Promise<T[]>;
