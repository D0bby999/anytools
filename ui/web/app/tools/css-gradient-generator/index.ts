import type { Tool } from '../types';
import { meta } from './meta';
import { CssGradientGeneratorUi } from './ui';

const tool: Tool = { meta, Component: CssGradientGeneratorUi };
export default tool;
