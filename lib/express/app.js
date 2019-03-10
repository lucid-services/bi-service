'use strict';

module.exports = App;

const url     = require('url');
const _       = require('lodash');
const logger  = require('serviser-logger');
const http    = require('http');
const https   = require('https');
const Promise = require('bluebird');
const Express = require('express');

const AppStatus               = require('../common/appStatus.js');
const AppI                    = require('../common/app.js');
const Router                  = require('./router.js');
const routeNotFoundMiddleware = require('../middleware/routeNotFound');
const errorHandlerMiddleware  = require('../middleware/errorHandler');
const reqContentType          = require('../middleware/requestContentType.js');
const reqIdentityMiddleware   = require('../middleware/requestIdentity.js');
const appStatusCheckMiddleware= require('../middleware/appStatusCheck.js');

/**
 * App is `http` impementation of {@link App AppInterface} and represents
 * a bundle of {@link Router Routers} with {@link Route Routes}. It holds http[s] server object
 * or its equivalent/replacement and references to the {@link AppManager} and {@link Service}
 * instances which it was created from. It also manages its own `Config` instance with restricted scope
 *
 * @param {AppManager}   appManager
 * @param {Config}       config - module
 * @param {Object}       options
 * @param {String}       options.name - app's name
 * @param {Object}       [options.validator] - Ajv validator initialization options
 * @param {Object|Array} [options.validator.schemas] - list of globally accessible schema definitions
 *
 * @emits App#status-changed
 * @emits App#pre-init
 * @emits App#post-init
 * @emits App#pre-build
 * @emits App#post-build
 * @emits App#build-router
 * @emits App#listening
 * @emits App#error
 * @emits App#unknown-error
 * @emits App#error-response
 * @extends AppInterface
 * @constructor
 **/
function App(appManager, config, options) {
    const app = this;
    this.expressApp = Express();

    //App specific Router
    /**
     * App specific Router constructor
     * @name App#Router
     * @instance
     * @readonly
     * @type {Function}
     */
    this.Router = function() {
        Router.apply(this, arguments);
    };
    this.Router.prototype = Object.create(Router.prototype);
    this.Router.prototype.constructor = Router;
    this.Router.prototype.App = this;

    //parent constructor
    AppI.call(this, appManager, config, options);
    app.$normalizeConfig();
};

App.prototype = Object.create(AppI.prototype);
App.prototype.constructor = App;

/**
 * @private
 * @return {undefined}
 */
App.prototype.$normalizeConfig = function() {

    // set basePath
    var rootPath = this.config.get('baseUrl') || '';
    var host, protocol;
    if (rootPath) {
        //an url without protocol are not valid according to specs
        if (!rootPath.match(/^http(s)?/)) {
            rootPath = 'http://' + rootPath;
        }
        rootPath = url.parse(rootPath);
        host = rootPath.host;
        protocol = rootPath.protocol;
        rootPath = rootPath.pathname || '';
    }

    this.config.set('basePath', rootPath);
    this.config.set('host', host || '');
    this.config.set('protocol', protocol || '');
};

/**
 * @private
 * @return {undefined}
 */
App.prototype.$init = function() {

    var self = this;
    this.expressApp.locals.getUrl = function getUrl(uid, pathParams, queryParams) {
        return self.getRoute(uid).getUrl(pathParams, queryParams);
    };

    this.on('init', function(app) {
        var options = this.options;
        var headers = this.config.get('response:headers') || [];

        //generates unique uid for each request
        app.use(reqIdentityMiddleware.bind(app));


        app.expressApp.set('trust proxy', 'uniquelocal');
        //app.expressApp.set('view engine', 'ejs');
        app.expressApp.disable('x-powered-by');

        // Set default response headers & make sure req.body is an object
        // & path res object with custom methods
        app.use(function(req, res, next) {

            res.removeHeader('server', '*');
            headers.forEach(function(header) {
                res.setHeader.apply(res, header);
            });

            if (!req.body) {
                req.body = {};
            }

            return next();
        });

        if (app.config.get('stopOnError') === true) {
            app.use(appStatusCheckMiddleware.bind(app));
        }

        // Express global error handling
        app.once('post-build', function(app) {
            app.use('*', routeNotFoundMiddleware.bind(app));
            app.use(errorHandlerMiddleware.bind(app));
        });

        app.on('status-changed', function(status) {
            if (   status === AppStatus.ERROR
                && app.config.get('stopOnError') === true
            ) {
                logger.error(`The ${app.options.name} app has stopped processing all requests to prevent any further data damage`);
            }
        });

        //default error response fallback,
        //`error-response` listeners are handled asynchronously in a series
        app.on('error-response', function defaultResponse(err, res) {
            if (!res.headersSent) {
                res.json(err);
            }
        });

        app.prependListener('error-response', function setStatusCode(err, res) {
            res.status(err.code);
        });

    });

    return AppI.prototype.$init.call(this);
};

/**
 * returns protocol + host url string
 * @return {String}
 */
App.prototype.getHost = function() {
    if (this.config.get('protocol') && this.config.get('host')) {
        return `${this.config.get('protocol')}//${this.config.get('host')}`;
    }
    return '';
};

/**
 * bind application-level middleware that will be run before `Route`'s
 * middleware stack
 *
 * @param {String} [endpoint]
 * @param {Function} [callback]
 *
 * @return {undefined}
 */
App.prototype.use = function() {
    var args = Array.prototype.slice.call(arguments, 0);
    return this.expressApp.use.apply(this.expressApp, args);
};

/**
 * @private
 * @return {ExpressRouter}
 */
App.prototype.$buildExpressRouter = function() {
    return Express.Router();
};

/**
 * @param {Integer} defaultValue
 *
 * @private
 * @return {Integer}
 */
App.prototype.$getTimeoutInterval = function(defaultValue) {
    var timeout = this.config.get('request:timeout');
    if (typeof timeout === 'number') {
        return timeout;
    } else if (typeof defaultValue === 'number') {
        return defaultValue;
    }
    return 0;
};

/**
 * @private
 * @return {App}
 */
App.prototype.build = function() {
    var app = this;

    process.nextTick(function() {
        app.emit('pre-build', app);

        app.routers.forEach(function(router) {
            app.expressApp.use(router.getUrl(), router.$buildExpressRouter());
        });

        app.emit('post-build', app);
    });

    return app;
};

/**
 * start http(s) server listening on configured port
 *
 * @param {Integer|String} port - or socket
 * @param {String}         [hostname]
 * @param {Integer}        [backlog] - the maximum length of the queue of pending connections. The actual length will be determined by your OS through sysctl settings such as tcp_max_syn_backlog and somaxconn on linux. The default value of this parameter is 511 (not 512).
 * @param {Object}         [options]
 * @param {Boolean}        [options.ssl=false]
 *
 * @return http[s].Server
 */
App.prototype.listen = function() {
    var args = Array.prototype.slice.call(arguments, 0, 3);
    var app = this;
    var options = {
        ssl: false,
        cli: false
    };

    if (app.status === AppStatus.ERROR) {
        throw app.statusReason;
    }

    if (app.server !== null) {
        //if we needed the app to listen on both https and http, we should handle this on system level
        throw new Error('Another Server is already running.');
    }

    if (_.isPlainObject(arguments[arguments.length -1])) {
        options = _.assign(options, arguments[arguments.length -1])
    }

    var protocol = options.ssl ? https : http;

    app.server = protocol.createServer(app.expressApp);
    app.server.setTimeout(this.$getTimeoutInterval(10000));//10s

    app.server.on('error', function(err) {
        app.emit('error', err);
    });
    app.server.once('listening', function() {
        app.$setStatus(AppStatus.OK);
        app.emit('listening', app);
    });

    return app.server.listen.apply(app.server, args);
};
