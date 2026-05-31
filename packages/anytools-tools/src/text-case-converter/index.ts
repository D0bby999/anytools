import type { Tool } from '../types';
import { meta } from './meta';
import { TextCaseConverterUi } from './ui';

const tool: Tool = { meta, Component: TextCaseConverterUi };
export default tool;
