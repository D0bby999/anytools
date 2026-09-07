import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// happy-dom keeps one document across a file's tests; without this a component mounted in one
// test is still in the DOM for the next, and `getByRole` throws "found multiple elements".
afterEach(cleanup);
