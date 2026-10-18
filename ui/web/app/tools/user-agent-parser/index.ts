import type { Tool } from '../types';
import { meta } from './meta';
import { UserAgentParserUi } from './ui';

const tool: Tool = { meta, Component: UserAgentParserUi };
export default tool;
