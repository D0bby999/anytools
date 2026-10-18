import type { Tool } from '../types';
import { meta } from './meta';
import { IntegerBaseConverterUi } from './ui';

const tool: Tool = { meta, Component: IntegerBaseConverterUi };
export default tool;
