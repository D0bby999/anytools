import type { Tool } from '../types';
import { meta } from './meta';
import { DiffCheckerUi } from './ui';

const tool: Tool = { meta, Component: DiffCheckerUi };
export default tool;
