import type { Tool } from '../types';
import { meta } from './meta';
import { RsaKeypairGeneratorUi } from './ui';

const tool: Tool = { meta, Component: RsaKeypairGeneratorUi };
export default tool;
