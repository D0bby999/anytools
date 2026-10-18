import type { Tool } from '../types';
import { meta } from './meta';
import { WatermarkImageUi } from './ui';

const tool: Tool = { meta, Component: WatermarkImageUi };
export default tool;
