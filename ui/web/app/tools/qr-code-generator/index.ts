import type { Tool } from '../types';
import { meta } from './meta';
import { QrCodeGeneratorUi } from './ui';

const tool: Tool = { meta, Component: QrCodeGeneratorUi };
export default tool;
