import type { Tool } from '../types';
import { meta } from './meta';
import { UuidGeneratorUi } from './ui';

const tool: Tool = { meta, Component: UuidGeneratorUi };
export default tool;
