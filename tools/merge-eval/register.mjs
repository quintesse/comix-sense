import { registerHooks } from 'node:module';
import { resolve, load } from './loader.mjs';
registerHooks({ resolve, load });
