import type { Tool } from '../types';
import { meta } from './meta';
import { YoutubeThumbnailGrabberUi } from './ui';

const tool: Tool = { meta, Component: YoutubeThumbnailGrabberUi };
export default tool;
