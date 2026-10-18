import type { Tool } from '../types';
import { meta } from './meta';
import { CreateZipUi } from './ui';

const tool: Tool = { meta, Component: CreateZipUi };
export default tool;
