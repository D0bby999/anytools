import type { Tool } from '../types';
import { meta } from './meta';
import { ReadingTimeUi } from './ui';

const tool: Tool = { meta, Component: ReadingTimeUi };
export default tool;
