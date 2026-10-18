import type { Tool } from '../types';
import { meta } from './meta';
import { WhiteboardUi } from './ui';

const tool: Tool = { meta, Component: WhiteboardUi };
export default tool;
