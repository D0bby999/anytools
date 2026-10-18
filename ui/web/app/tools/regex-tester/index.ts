import type { Tool } from '../types';
import { meta } from './meta';
import { RegexTesterUi } from './ui';

const tool: Tool = { meta, Component: RegexTesterUi };
export default tool;
