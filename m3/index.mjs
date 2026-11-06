/**
 * Directory entry for `node --test m3/` and `node m3/`.
 *
 * Some Node 20+ test runners treat a directory argument as one program and
 * start it through this file. Importing the suites registers them with
 * node:test. The files are also valid on their own (`node --test m3/*.test.mjs`).
 */
import './matrix.test.mjs';
import './m3.test.mjs';
