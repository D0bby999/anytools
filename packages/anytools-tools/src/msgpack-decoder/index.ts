import type { Tool } from '../types';
import { meta } from './meta';
import { MsgpackDecoderUi } from './ui';

const tool: Tool = { meta, Component: MsgpackDecoderUi };
export default tool;
