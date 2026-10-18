import type { Tool } from '../types';
import { meta } from './meta';
import { TokenCounterUi } from './ui';

const tool: Tool = { meta, Component: TokenCounterUi };
export default tool;
