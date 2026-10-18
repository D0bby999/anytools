import type { Tool } from '../types';
import { meta } from './meta';
import { CronParserUi } from './ui';

const tool: Tool = { meta, Component: CronParserUi };
export default tool;
