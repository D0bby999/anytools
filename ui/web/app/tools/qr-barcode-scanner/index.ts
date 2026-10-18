import type { Tool } from '../types';
import { meta } from './meta';
import { QrBarcodeScannerUi } from './ui';

const tool: Tool = { meta, Component: QrBarcodeScannerUi };
export default tool;
