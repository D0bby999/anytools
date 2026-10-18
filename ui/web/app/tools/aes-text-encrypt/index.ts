import type { Tool } from '../types';
import { meta } from './meta';
import { AesTextEncryptUi } from './ui';

const tool: Tool = { meta, Component: AesTextEncryptUi };
export default tool;
