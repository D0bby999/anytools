import type { Tool } from '../types';
import { meta } from './meta';
import { HexEncodeUi } from './ui';

const tool: Tool = { meta, Component: HexEncodeUi };
export default tool;
