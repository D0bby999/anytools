import type { Tool } from '../types';
import { meta } from './meta';
import { WordCounterUi } from './ui';

const tool: Tool = { meta, Component: WordCounterUi };
export default tool;
