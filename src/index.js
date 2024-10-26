const Deployer = require('./deployer');


if (typeof module !== 'undefined' && module.exports) {
  module.exports = Deployer;
}

if (typeof exports !== 'undefined') {
  Object.defineProperty(exports, '__esModule', { value: true });
  exports.default = Deployer;
  exports.Deployer = Deployer;
}

if (typeof window !== 'undefined') {
  window.Deployer = Deployer;
}
