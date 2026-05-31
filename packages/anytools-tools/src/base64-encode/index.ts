import type { Tool } from '../types';
import { meta } from './meta';
import { Base64ToolUi } from './ui';

const tool: Tool = {
  meta,
  Component: Base64ToolUi,
};

export default tool;
