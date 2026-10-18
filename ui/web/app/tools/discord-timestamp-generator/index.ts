import type { Tool } from '../types';
import { meta } from './meta';
import { DiscordTimestampGeneratorUi } from './ui';

const tool: Tool = { meta, Component: DiscordTimestampGeneratorUi };
export default tool;
