const util = require('util');

module.exports = RouterError;

/**
 * @constructor
 * @extends Error
 **/
function RouterError(message) {

    Error.call(this); //super constructor
    Error.captureStackTrace(this, this.constructor);

    this.name = this.constructor.name;
    this.message = message;
}

util.inherits(RouterError, Error);
