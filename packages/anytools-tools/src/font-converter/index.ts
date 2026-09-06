import type { Tool } from '../types';
import { meta } from './meta';
import { FontConverterUi } from './ui';

const tool: Tool = { meta, Component: FontConverterUi };
export default tool;
