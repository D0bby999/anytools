import type { Tool } from '../types';
import { meta } from './meta';
import { MockDataGeneratorUi } from './ui';

const tool: Tool = { meta, Component: MockDataGeneratorUi };
export default tool;
