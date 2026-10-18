import type { Tool } from '../types';
import { meta } from './meta';
import { BarcodeGeneratorUi } from './ui';

const tool: Tool = { meta, Component: BarcodeGeneratorUi };
export default tool;
