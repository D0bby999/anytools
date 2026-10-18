import type { Tool } from '../types';
import { meta } from './meta';
import { UnzipArchiveUi } from './ui';

const tool: Tool = { meta, Component: UnzipArchiveUi };
export default tool;
