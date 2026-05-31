import type { Tool } from '../types';
import { meta } from './meta';
import { LoremIpsumGeneratorUi } from './ui';

const tool: Tool = { meta, Component: LoremIpsumGeneratorUi };
export default tool;
