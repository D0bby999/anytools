import type { Tool } from '../types';
import { meta } from './meta';
import { CrontabGeneratorUi } from './ui';

const tool: Tool = { meta, Component: CrontabGeneratorUi };
export default tool;
