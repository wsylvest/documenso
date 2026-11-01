#!/usr/bin/env node
// Launch the stdio proxy. The source is TypeScript, so register tsx first.
import { register } from 'tsx/esm/api';

register();

await import('../src/stdio.ts');
