import type { Tool } from '../types';
import { meta } from './meta';
import { JwtSignVerifyUi } from './ui';

const tool: Tool = { meta, Component: JwtSignVerifyUi };
export default tool;
