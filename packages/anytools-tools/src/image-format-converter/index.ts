import type { Tool } from '../types';
import { meta } from './meta';
import { ImageFormatConverterUi } from './ui';

const tool: Tool = { meta, Component: ImageFormatConverterUi };
export default tool;
