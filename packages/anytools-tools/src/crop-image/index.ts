import type { Tool } from '../types';
import { meta } from './meta';
import { CropImageUi } from './ui';

const tool: Tool = { meta, Component: CropImageUi };
export default tool;
