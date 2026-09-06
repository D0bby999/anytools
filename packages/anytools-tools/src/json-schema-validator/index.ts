import type { Tool } from '../types';
import { meta } from './meta';
import { JsonSchemaValidatorUi } from './ui';

const tool: Tool = { meta, Component: JsonSchemaValidatorUi };
export default tool;
