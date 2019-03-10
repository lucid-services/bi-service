'use strict';

module.exports = App; //aka. AppInterface

const _                 = require('lodash');
const EventEmmiter      = require('events-bluebird');
const Validator         = require('ajv');
const validatorKeywords = require('ajv-keywords');

const utils                   = require('../utils.js');
const AppStatus               = require('./appStatus.js');
const ValidationError         = require('../error/validationError.js');
const ValidationCompoundError = require('../error/validationCompoundError.js');

/**
 * @param {AppManager}   appManager
 * @param {Config}       config - module
 * @param {Object}       options
 * @param {String}       options.name - app's name
 * @param {Object}       [options.validator] - Ajv validator initialization options
 * @param {Object|Array} [options.validator.schemas] - list of globally accessible schema definitions
 *
 * @emits AppInterface#status-changed
 * @emits AppInterface#pre-init
 * @emits AppInterface#post-init
 * @emits AppInterface#pre-build
 * @emits AppInterface#post-build
 * @emits AppInterface#build-router
 * @emits AppInterface#listening
 * @emits AppInterface#error
 * @emits AppInterface#unknown-error
 * @emits AppInterface#error-response
 * @alias AppInterface
 * @abstract
 * @constructor
 **/
function App(appManager, config, options) {
    EventEmmiter.call(this);
    const app = this;

    /**
     * see affiliated `bi-config` npm package
     * @name AppInterface#config
     * @instance
     * @readonly
     * @type {Config}
     */
    this.config          = config;
    /**
     * @name AppInterface#appManager
     * @instance
     * @readonly
     * @type {AppManager}
     */
    this.appManager      = appManager;
    /**
     * @name AppInterface#service
     * @instance
     * @readonly
     * @type {Service}
     */
    this.service         = appManager.service;
    /**
     * @name AppInterface#resourceManager
     * @instance
     * @readonly
     * @type {ResourceManager}
     */
    this.resourceManager = this.service.resourceManager;

    /**
     * one of {@link AppStatus} enum
     * @name AppInterface#status
     * @instance
     * @readonly
     * @type {String}
     */
    this.status = null;

    Object.defineProperty(this, 'routers', {value: []});
    //indexed by its UID
    Object.defineProperty(this, 'routes', {value: {}});
    Object.defineProperty(this, 'server', {writable: true, value: null});
    // related documentation server App ref
    Object.defineProperty(this, 'doc', {writable: true, value: null});
    Object.defineProperty(this, 'statusReason', {writable: true, value: null});
    Object.defineProperty(this, 'options', {
        value: ( options && _.cloneDeep(options) ) || {}
    });
    Object.defineProperty(this, 'validator', {writable: true, value: null});

    if (!this.options.name || typeof this.options.name !== 'string') {
        throw new Error('App `name` option is mandatory and should be a string');
    }

    /**
     * @name AppInterface#name
     * @instance
     * @readonly
     * @type {String}
     */
    Object.defineProperty(this, 'name', {
        get: function nameGetter() {
            return this.options.name;
        }
    });

    //we have to exlicitly add 'memory' store to the config to be able
    //to write to it as 'literal' or 'default' store is readonly!
    if (config.stores && !config.stores.memory) {
        config.use('memory');
    }

    this.$setStatus(AppStatus.INIT);
    app.service.resourceManager.register(`config-${app.name}`, config);
    app.$init();
};

App.prototype = Object.create(EventEmmiter.prototype);
App.prototype.constructor = App;

/**
 * registeres event listener.  
 * overrides event emmiter implementation
 *
 * @extends EventEmitter
 *
 * @param {String} event
 * @param {Function} callback
 * @return {Boolean}
 */
App.prototype.on = function(event) {
    switch (event) {
        case 'unknown-error':
            if (this.listenerCount(event) >= 1) {
                throw new Error('You can assign only single listener for the event');
            }
            break;
    }

    return EventEmmiter.prototype.on.apply(this, arguments);
};

/**
 * @param {String} status - see {AppStatus} enum for available option values
 * @param {mixed} reason
 *
 * @private
 * @return {undefined}
 */
App.prototype.$setStatus = function(status, reason) {
    const app = this;

    process.nextTick(function() {
        if (app.status === AppStatus.ERROR) {
            return;
        }

        app.status = status;
        app.statusReason = reason;
        app.emit('status-changed', status);
    });
};

/**
 * @private
 * @return {undefined}
 */
App.prototype.$init = function() {

    const self = this;

    //cache routes, validate route UIDs
    this.on('build-router', function(router) {
        const app = this;

        router.on('build-route', function registerRoutes(route) {
            if (app.routes.hasOwnProperty(route.uid)) {
                throw new Error(`Route uid: ${route.uid} must be unique.`);
            }
            app.routes[route.uid] = route;;
        });
    });

    this.once('init', function validateConfiguration() {
        try {
            this.config.inspectIntegrity();
        } catch(e) {
            this.emit('error', e);
        }
    });

    process.nextTick(function(app) {
        app.emit('pre-init', app);
        app.emit('init', app);
        app.emit('post-init', app);
    }, this);
};

/**
 * @return {Ajv} validator instance
 */
App.prototype.getValidator = function getValidator() {
    if (this.validator === null) {
        let defaults = {
            $data: true, //data json references
            allErrors: false,
            verbose: true, //include validated data in errors
            schemaId: '$id',
            nullable: true, //support nullable OpenAPI v3 keyword
            //it should fail if other keywords are present
            //along the $ref keywords in the schema
            extendRefs: 'fail',
            //only additional properties with additionalProperties keyword
            //equal to false are removed
            additionalProperties: true,
            removeAdditional: true,
            useDefaults: true,
            coerceTypes: true,
            passContext: true, //pass validation context to custom keyword functions
        };

        _.assign(defaults, this.options.validator || {});
        this.validator = new Validator(defaults);

        //register keywords from ajv-keywords package
        validatorKeywords(this.validator);

        //custom ajv keywords provided by bi-service
        utils.registerCustomKeywords(this.validator);

        //Error constructor that will be used by the app
        _defineValidationErrorConstructor(
            this.validator,
            defaults.allErrors ? ValidationCompoundError: ValidationError
        );
    }

    return this.validator;
};

/**
 * @param {Validator} validator - ajv instance
 * @return {undefined}
 */
function _defineValidationErrorConstructor(validator, defaultValue) {
    function setter(value) {
        if (!ValidationError.prototype.isPrototypeOf(value && value.prototype)) {
            throw new TypeError('Error constructor must inherit ' +
                'Service.error.ValidationError');
        }
        setter.value = value;
    }

    setter.value = defaultValue;

    function getter() {
        return setter.value;
    }

    Object.defineProperty(validator, 'ValidationErrorConstructor', {
        get: getter,
        set: setter,
        configurable: false
    });
}

/**
 * @param {String} uid
 *
 * @throws Error - when route is not found
 * @return {Route}
 */
App.prototype.getRoute = function(uid) {
    if (!this.routes.hasOwnProperty(uid)) {
        throw new Error(`Route ${uid} not found`);
    }

    return this.routes[uid];
};

/**
 * @param {Object} options
 * @param {String} [options.public]
 * @param {String} [options.version]
 * @param {String} options.url
 *
 * @return {Router}
 */
App.prototype.buildRouter = function(options) {
    const router = new this.Router(options);
    this.routers.push(router);

    this.emit('build-router', router);
    return router;
};

/**
 * bind application-level middleware that will be run before `Route`'s
 * middleware stack
 *
 * @param {String} [endpoint]
 * @param {Function} [callback]
 * @abstract
 *
 * @return {AppInterface} - self
 */
App.prototype.use = function() {
    throw new Error('Not implemented by subclass');
};

/**
 * is supposed to prepare and bind all supported end points to the server object
 * @private
 * @abstract
 * @return {AppInterface}
 */
App.prototype.build = function() {
    //TODO doc
    throw new Error('Not implemented by subclass');
};

/**
 * @param {Integer|String} [port|socket]
 * @abstract
 */
App.prototype.listen = function() {
    throw new Error('Not implemented by subclass');
};

/**
 * shutdown underlying net socket. if not running, resolved Promise will be returned
 * @return {Promise}
 */
App.prototype.close = function() {
    const app = this;

    return new Promise(function(resolve, reject) {
        if (!app.server || app.server.address() === null) {
            return resolve();
        }

        app.server.close(function(err) {
            if (err) return reject(err);
            resolve(app.server);
        });
    });
};

// ==================== JSDOC AppInterface EVENTS DEFINITIONS ======================== //

/**
 * emitted once each time after status change.
 * Once you get {@link AppStatus#ERROR} status, the App's status can NOT
 * be changed thus no more `status-changed` events will be emitted.
 *
 * @event AppInterface#status-changed
 * @property {String} status - see {@link AppStatus} enum for available option values
 */

/**
 * emitted before internal initialization of the App instance
 *
 * @event AppInterface#pre-init
 * @property {AppInterface} app
 */

/**
 * emitted after internal initialization of the App instance. At this point the
 * App instance should be fully initiallized.
 *
 * @event AppInterface#post-init
 * @property {AppInterface} app
 */

/**
 * emitted before app route definitions are assembled into a single function.
 *
 * @event AppInterface#pre-build
 * @property {AppInterface} app
 */

/**
 * emitted after app route definitions are assembled into a single function and
 * binded to internal http[s] server.
 *
 * @event AppInterface#post-build
 * @property {AppInterface} app
 */

/**
 * emitted with each {@link AppInterface#buildRouter} method call.
 *
 * @event AppInterface#build-router
 * @property {RouterInterface} router
 */

/**
 * reflects http[s] server `listening` event
 *
 * @event AppInterface#listening
 * @property {AppInterface} app
 */

/**
 * fires each time an unexpected internal Error is encoutered.
 * When the Error is catched in the application space, the Error is coerced
 * to {@link ServiceError} type which is safe to respond with.  
 *
 * Internal listener is binded at initialization time which logs all received
 * Errors with the [bi-logger](https://github.com/lucid-services/bi-logger) package.  
 * {@link AppInterface#status} is updated with the first internal error setting the Application to `error` state.
 * @event AppInterface#error
 * @property {Error} error
 */

/**
 * By default an {@link AppInterface App} handles all "expected" & unexpected Errors automatically
 * and responds to a request accordingly.  
 * By pushing a listener to this event, you can define custom user
 * error processing logic and respond to the request manually.  
 * Listeners of this event are executed asynchronously - `Promises` are supported.
 *
 * @example
 *
 * app.on('error-response', function(err, res) {
 *     //pseudocode:
 *     //renders html view and sends html response instead of default json response
 *     return res.render('error', err); //returns a Promise
 * });
 *
 * @event AppInterface#error-response
 * @property {RequestError} err
 * @property {http.ServerResponse} res - response
 */

/**
 * Is emitted before a response to a request is sent and allows to convert
 * an unknown error (an error which is not instanceof {@link RequestError}
 * and at the same time is not **dirrect** instanceof [Error](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error))
 * to {@link RequestError} which will be then processed in place of the original unknown error object.  
 * if no listener is present all unknown errors will be automatically converted to {@link ServiceError}
 *
 * @example
 *
 * app.on('unknown-error', function(err, errorHandler) {
 *     if (err instanceof SequelizeUniqueConstraintError) {
 *         return errorHandler(new RequestError('Entity already exists'));
 *     }
 *     //hand back the error processing to the application
 *     return errorHandler(err);
 * });
 *
 * @event AppInterface#unknown-error
 * @property {Error} err
 * @property {Function} errorHandler - callback function
 */

// ========================================================================== //
