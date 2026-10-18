import type { Tool } from '../types';
import { meta } from './meta';
import { RandomPickerUi } from './ui';

const tool: Tool = { meta, Component: RandomPickerUi };
export default tool;
