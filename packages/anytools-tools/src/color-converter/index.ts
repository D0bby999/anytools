import type { Tool } from '../types';
import { meta } from './meta';
import { ColorConverterUi } from './ui';

const tool: Tool = { meta, Component: ColorConverterUi };
export default tool;
