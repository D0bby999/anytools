import type { Tool } from '../types';
import { meta } from './meta';
import { ProtobufDecoderUi } from './ui';

const tool: Tool = { meta, Component: ProtobufDecoderUi };
export default tool;
