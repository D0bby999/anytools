import type { Tool } from '../types';
import { meta } from './meta';
import { JwtDecoderUi } from './ui';

const tool: Tool = { meta, Component: JwtDecoderUi };
export default tool;
