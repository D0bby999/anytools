import type { Tool } from '../types';
import { meta } from './meta';
import { StlObjViewerUi } from './ui';

const tool: Tool = { meta, Component: StlObjViewerUi };
export default tool;
