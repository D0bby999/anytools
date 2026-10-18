import type { Tool } from '../types';
import { meta } from './meta';
import { UnicodeCleanerUi } from './ui';

const tool: Tool = { meta, Component: UnicodeCleanerUi };
export default tool;
