import type { Tool } from '../types';
import { meta } from './meta';
import { PasswordGeneratorUi } from './ui';

const tool: Tool = { meta, Component: PasswordGeneratorUi };
export default tool;
