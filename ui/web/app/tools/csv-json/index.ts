import type { Tool } from '../types';
import { meta } from './meta';
import { CsvJsonUi } from './ui';

const tool: Tool = { meta, Component: CsvJsonUi };
export default tool;
