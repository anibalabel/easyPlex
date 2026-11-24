'use strict';

// CommonJS startup wrapper for Namecheap / cPanel Phusion Passenger (with "type": "module")
import('./server/src/node.js').catch((err) => {
  console.error('[EasyPlex Startup Error]', err);
  process.exit(1);
});
