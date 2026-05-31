import type { Tool } from '../types';
import { meta } from './meta';
import { HashGeneratorUi } from './ui';

const tool: Tool = { meta, Component: HashGeneratorUi };
export default tool;
