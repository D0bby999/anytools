import type { Tool } from '../types';
import { meta } from './meta';
import { RemovePdfPagesUi } from './ui';

const tool: Tool = { meta, Component: RemovePdfPagesUi };
export default tool;
