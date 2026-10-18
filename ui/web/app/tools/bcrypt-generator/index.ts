import type { Tool } from '../types';
import { meta } from './meta';
import { BcryptGeneratorUi } from './ui';

const tool: Tool = { meta, Component: BcryptGeneratorUi };
export default tool;
