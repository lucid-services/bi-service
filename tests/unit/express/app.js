var nconf            = require('nconf');
var sinon            = require('sinon');
var chai             = require('chai');
var chaiAsPromised   = require('chai-as-promised');
var sinonChai        = require("sinon-chai");
var http             = require('http');
var https            = require('https');
var Express          = require('express');
var logger           = require('bi-logger');
var Session          = require('express-session');
var CouchbaseODM     = require('kouchbase-odm');
var ExpressValidator = require('bi-json-inspector');

var CouchbaseCluster = require('../../../lib/database/couchbase.js');
var AppManager       = require('../../../lib/express/appManager.js');
var App              = require('../../../lib/express/app.js');
var Router           = require('../../../lib/express/router.js');
var AppStatus        = require('../../../lib/express/appStatus.js');
var sequelizeBuilder = require('../../../lib/database/sequelize.js');
var Config           = require('../mocks/config.js');
var Server           = require('../mocks/server.js');
var MemcachedStore   = require('../mocks/memcachedStore.js');

//this makes sinon-as-promised available in sinon:
require('sinon-as-promised');

var expect = chai.expect;

chai.use(sinonChai);
chai.use(chaiAsPromised);
chai.should();

describe('App', function() {

    beforeEach(function() {
        this.models = {};
        this.config = new Config();
        this.configGetStub = sinon.stub(this.config, 'get');

        this.appManager = new AppManager(this.models);
    });

    afterEach(function() {
        delete this.models;
        delete this.config;
        delete this.appManager;
    });

    describe('constructor', function() {
        it('should throw an Error when we try to create an App with no `name` option set', function() {
            var self = this;

            function tCase() {
                self.appManager.buildApp(self.config, {});
            }

            expect(tCase).to.throw(Error);
        });

        it('should throw an Error when a Router is trying to register a Route with duplicate uid (route name which is already registered)', function() {
            var self = this;

            var app = self.appManager.buildApp(self.config, {name: '0'});
            var router1 = app.buildRouter({url: '/', version: 1});
            var router2 = app.buildRouter({url: '/group', version: 1});

            router1.buildRoute({
                name: 'get',
                type: 'get',
                url: '/'
            });


            function tCase() {
                router2.buildRoute({
                    name: 'get',
                    type: 'get',
                    url: '/'
                });
            }

            expect(tCase).to.throw(Error);
        });

        it('should throw an Error when we try to build an App with non-unique `name`', function() {
            var self = this;

            self.appManager.buildApp(self.config, {name: 'unique'});

            function tCase() {
                self.appManager.buildApp(self.config, {name: 'unique'});
            }

            expect(tCase).to.throw(Error);
        });
    });

    describe('methods', function() {
        beforeEach(function() {
            var app = this.app = this.appManager.buildApp(this.config, {name: '1'});

            this.getExpressInjectorSpy = sinon.spy(ExpressValidator, 'getExpressInjector');

            this.preBuildSpy      = sinon.spy();
            this.postBuildSpy     = sinon.spy();
            this.statusChangedSpy = sinon.spy();
            this.preInitSpy       = sinon.spy();
            this.postInitSpy      = sinon.spy();
            this.unknownErrorSpy  = sinon.spy();
            this.errorSpy         = sinon.spy();

            app.on('pre-build', this.preBuildSpy);
            app.on('post-build', this.postBuildSpy);
            app.on('status-changed', this.statusChangedSpy);
            app.on('pre-init', this.preInitSpy);
            app.on('post-init', this.postInitSpy);
            app.on('unknown-error', this.unknownErrorSpy);
            app.on('error', this.errorSpy);

            this.appEmitSpy = sinon.spy(app, 'emit');

            this.configGetStub.withArgs('couchbase').returns({
                host: 'localhost',
                buckets: {
                    main: {
                        bucket: 'main'
                    }
                }
            });

        });

        before(function() {
            this.matchers = {
                expressRouter: function routerMatcher(router) {
                    return Express.Router.isPrototypeOf(router);
                }
            };

            this.nextTick = function(callback) {
                return new Promise(function(resolve, reject) {
                    process.nextTick(function() {
                        try {
                            callback();
                            resolve();
                        } catch(e) {
                            reject(e);
                        }
                    });
                });
            };
        });

        afterEach(function() {
            delete this.app;

            this.appEmitSpy.restore();
            this.getExpressInjectorSpy.restore();
        });

        describe('on', function() {
            it('should throw an error when we try to bind more than one listener for the `unknown-error` event', function() {
                var app = this.app;

                //we have already assigned one listener in the "before" hook
                expect(bindListener).to.throw(Error);

                function bindListener() {
                    app.on('unknown-error', function() {
                        return;
                    });
                }
            });

            it('should call registered listeners when we emit an event', function() {
                var app = this.app;

                app.emit('unknown-error');
                app.emit('unknown-error');

                this.unknownErrorSpy.should.have.been.calledTwice;
            });
        });

        describe('$setStatus', function() {
            it('should fail silently when we try to change status of an app which is in ERROR state', function() {
                var self = this;
                var app = this.app;

                app.$setStatus(AppStatus.ERROR);

                return this.nextTick(function() {
                    self.statusChangedSpy.reset();
                    app.$setStatus(AppStatus.OK);
                }).should.be.fulfilled.then(function() {
                    self.statusChangedSpy.should.have.callCount(0);
                });
            });

            it('should change the status/state of the app', function() {
                var app = this.app;

                return this.nextTick(function() {
                    app.$setStatus(AppStatus.OK);
                }).should.be.fulfilled.then(function() {
                    app.status.should.be.equal(AppStatus.OK);
                });
            });

            it('should emit the `status-changed` event', function() {
                var self = this;
                var app = this.app;

                self.statusChangedSpy.reset();

                return this.nextTick(function() {
                    app.$setStatus(AppStatus.OK);
                }).should.be.fulfilled.then(function() {
                    self.statusChangedSpy.should.have.been.calledOnce;
                    self.statusChangedSpy.should.have.been.calledWith(AppStatus.OK);
                });
            });
        });

        describe('$init', function() {
            it('should emit `pre-init` event', function() {
                this.preInitSpy.should.have.been.calledOnce;
            });

            it('should emit `pre-init` event', function() {
                this.postInitSpy.should.have.been.calledOnce;
            });

            it('should pass CLONED options object to the json inspector injector middleware', function() {
                var self = this;

                this.getExpressInjectorSpy.should.have.been.calledOnce;
                this.getExpressInjectorSpy.should.have.been.calledWith(sinon.match(function(options) {
                    return self.app.options.validator !== options && options.should.be.eql(self.app.options.validator);
                }));
            });
        });

        describe('useSession', function() {
            it('should connect Session middlewares to express app', function() {
                var appUseSpy = sinon.spy(this.app, 'use');
                var memcachedMock = new MemcachedStore();

                this.configGetStub.returns({});

                this.app.useSession(memcachedMock);

                this.app.storage.session.should.be.equal(memcachedMock);

                //TODO verify that actuall session middleware was provided to the function
                sinon.assert.alwaysCalledWith(appUseSpy, sinon.match.func);
                appUseSpy.calledTwice;
            });

            it('should return connected memcached object when the app is already connected to to memcached', function() {
                var memcachedMock = new MemcachedStore();
                var memcachedMock2 = new MemcachedStore();

                this.configGetStub.returns({});
                this.app.useSession(memcachedMock);
                this.app.useSession(memcachedMock2).should.be.equal(memcachedMock);
            });
        });

        describe('useCouchbase', function() {
            before(function() {
                this.couchbaseCluster = new CouchbaseCluster({
                    buckets: {
                        main: {
                            bucket: 'main'
                        }
                    }
                });
                this.couchbaseODM = new CouchbaseODM();
            });

            it('should assign CouchbaseCluster to the app', function() {
                this.app.useCouchbase(this.couchbaseCluster);
                this.app.storage.couchbase.should.be.equal(this.couchbaseCluster);
            });

            it('should return the CouchbaseCluster object passed to the method as an argument', function() {
                var cluster = this.app.useCouchbase(this.couchbaseCluster);
                cluster.should.be.equal(this.couchbaseCluster);
            });

            it("should create & assign new CouchbaseCluster object to the app if we hadn't provided one", function() {
                this.configGetStub.returns({
                    host: 'localhost',
                    buckets: {
                        main: {
                            bucket: 'main'
                        }
                    }
                });
                this.app.useCouchbase();
                this.app.storage.couchbase.should.be.an.instanceof(CouchbaseCluster);
            });

            it('should assign CouchbaseODM object to the app when we provide one as a argument', function() {
                this.app.useCouchbase(this.couchbaseCluster, this.couchbaseODM);
                this.app.couchbaseODM.should.be.equal(this.couchbaseODM);
            });
        });

        describe('useSequelize', function() {
            before(function() {
                this.sequelize = sequelizeBuilder({dialect: 'postgres'});
            });

            it('should assign Sequelize object which we provided to the app', function() {
                this.app.useSequelize(this.sequelize);
                this.app.sequelize.should.be.equal(this.sequelize);
            });

            it('should create & assign new Sequelize object if we hadnt provided one', function() {
                this.app.useSequelize();
                this.app.sequelize.should.be.an.instanceof(sequelizeBuilder.Sequelize);
            });
        });

        describe('use', function() {
            it('should behave like the express.use method', function() {
                var useSpy = sinon.spy(this.app.expressApp, 'use');
                var args = [
                    '/some/path',
                    function() {}
                ];

                var returnVal = this.app.use.apply(this.app, args);

                useSpy.should.have.been.calledOnce;
                useSpy.should.have.been.calledWithExactly.apply(useSpy.should.have.been, args);
                returnVal.should.be.equal(useSpy.getCall(0).returnValue);
            });
        });

        describe('$buildExpressRouter', function() {
            it('should return new express Router object', function() {
                var router = this.app.$buildExpressRouter();
                expect(this.matchers.expressRouter(router)).to.be.true;
            });
        });

        describe('buildRouter', function() {
            it('should be instance of Router', function() {
                this.app.buildRouter({url: '/'}).should.be.an.instanceof(Router);
            });

            it('should be instance of app.Router', function() {
                this.app.buildRouter({url: '/'}).should.be.an.instanceof(this.app.Router);
            });

            it("should push new Router object to it's stack", function() {
                var router = this.app.buildRouter({url: '/'});
                this.app.routers.should.include(router);
            });

            it("should emit `build-router` event with a new Router", function() {
                var router = this.app.buildRouter({url: '/'});
                this.appEmitSpy.withArgs('build-router', router).should.have.been.calledOnce;
            });
        });

        describe('build', function() {
            it('should return self (app)', function() {
                this.app.build().should.be.equal(this.app);
            });

            it('should emit pre-build event', function() {
                var self = this;
                var app = this.app;

                app.build();

                return this.nextTick(function() {
                    self.preBuildSpy.should.have.been.calledOnce;
                    self.preBuildSpy.should.have.been.calledWith(app);
                }).should.be.fulfilled;
            });

            it('should emit post-build event', function() {
                var self = this;
                var app = this.app;

                app.build();

                return this.nextTick(function() {
                    self.postBuildSpy.should.have.been.calledOnce;
                    self.postBuildSpy.should.have.been.calledWith(app);
                }).should.be.fulfilled;
            });

            it("should assign app`s routers to the express object", function() {
                var self = this;
                var buildExpressRouterSpy = sinon.spy(Router.prototype, '$buildExpressRouter');
                var expressUseSpy = sinon.spy(this.app.expressApp, 'use').withArgs(
                    sinon.match.string,
                    sinon.match(this.matchers.expressRouter)
                );

                this.app.buildRouter({url: '/'});
                this.app.buildRouter({url: '/group'});
                this.app.buildRouter({url: '/user'});

                this.app.build();

                return this.nextTick(function() {
                    buildExpressRouterSpy.should.have.been.calledThrice;
                    expressUseSpy.withArgs(
                        sinon.match.string,
                        sinon.match(self.matchers.expressRouter)
                    ).should.have.been.calledThrice;

                    expressUseSpy.should.have.been.calledWith('/');
                    expressUseSpy.should.have.been.calledWith('/group');
                    expressUseSpy.should.have.been.calledWith('/user');
                });
            });

            [
                {
                    baseUrl: '127.0.0.1:3000/root/path',
                    routerUrl: '/user',
                    expectedBinding: '/root/path/user'
                },
                {
                    baseUrl: 'api.domain.com/root/path/',
                    routerUrl: '/user',
                    expectedBinding: '/root/path/user'
                },
                {
                    baseUrl: '127.0.0.1:3000',
                    routerUrl: '/user',
                    expectedBinding: '/user'
                }
            ].forEach(function(data, index) {
                it(`should attach all routers to the root path when \`baseUrl\` config value is provided (${index})`, function() {
                    var config = new nconf.Provider({
                        store: {
                            type: 'literal',
                            store: {
                                baseUrl: data.baseUrl
                            }
                        }
                    });

                    var app = this.appManager.buildApp(config, {
                        name: Date.now() + index
                    });

                    var expressUseSpy = sinon.spy(app.expressApp, 'use').withArgs(
                        sinon.match.string,
                        sinon.match(this.matchers.expressRouter)
                    );

                    app.buildRouter({url: data.routerUrl});
                    app.build();

                    return this.nextTick(function() {
                        expressUseSpy.should.have.been.calledWith(data.expectedBinding);
                    });
                });
            });
        });

        describe('clone', function() {
            before(function() {
                this.shouldHaveSameListeners = function(app, app2, event) {
                    app.listeners(event).should.be.eql(app2.listeners(event));
                };
            });

            it('should return new instance of App', function() {
                var app = this.app.clone();
                app.should.not.be.equal(this.app);
                app.should.be.an.instanceof(App);
            });

            it('(cloned app) should have the exact same initialization options as the original app', function() {
                var app = this.app.clone();
                app.appManager.should.be.equal(this.app.appManager);
                app.config.should.be.equal(this.app.config);
                app.models.should.be.equal(this.app.models);
                app.options.should.be.eql(this.app.options);
            });

            it('should correctly copy one-time listeners (app.once())', function() {
                var appOnSpy = sinon.spy(App.prototype, 'on');
                var oneTimeListenerSpy = sinon.spy();

                this.app.once('pre-build', oneTimeListenerSpy);

                var app = this.app.clone();
                appOnSpy.should.have.been.calledWithExactly('pre-build', oneTimeListenerSpy);
            });

            it('(cloned app) should have copy of `pre-init` event listeners', function() {
                var app = this.app.clone();
                this.shouldHaveSameListeners(app, this.app, 'pre-init');
            });

            it('(cloned app) should have copy of `post-init` event listeners', function() {
                var app = this.app.clone();
                this.shouldHaveSameListeners(app, this.app, 'post-init');
            });

            it('(cloned app) should have copy of `pre-build` event listeners', function() {
                var app = this.app.clone();
                this.shouldHaveSameListeners(app, this.app, 'pre-build');
            });

            it('(cloned app) should have copy of `post-build` event listeners', function() {
                var app = this.app.clone();
                this.shouldHaveSameListeners(app, this.app, 'post-build');
            });
        });

        describe('listen', function() {
            afterEach(function() {
                this.app.server.close();
            });

            it('should call the http.Server.listen method', function() {
                var server = new Server;
                var spy = sinon.spy(server, 'listen');
                var stub = sinon.stub(http, 'createServer').returns(server);

                this.app.listen('80', '127.0.0.1', 500, {ssl: false});

                spy.should.have.been.calledOnce;
                spy.should.have.been.calledWithExactly('80', '127.0.0.1', 500);

                stub.restore();
            });

            it('should return new instance of http Server', function() {
                var server = this.app.listen('0.0.0.0');
                server.should.be.an.instanceof(http.Server);
            });

            it('should return new instance of https Server', function() {
                var server = this.app.listen('0.0.0.0', {ssl: true});
                server.should.be.an.instanceof(https.Server);
            });

            it('should throw an Error if we try to call listen more than once', function() {
                this.app.listen('0.0.0.0');
                expect(this.app.listen.bind(this.app, '0.0.0.0')).to.throw(Error);
            });

            it('should emit the `listening` event', function(done) {
                var self = this;
                this.app.on('error', function(err) {
                    return done(err);
                });

                this.app.on('listening', function(app) {
                    app.should.be.equal(self.app);
                    return done();
                });

                this.app.listen('0.0.0.0');
            });

            it('should emit the `error` event on server error', function(done) {
                var loggerStub = sinon.stub(logger, 'err');

                var server = this.app.listen('0.0.0.0');

                server.on('error', function(err) {
                    err.should.be.an.instanceof(Error);
                    server.close();
                    loggerStub.restore();
                    return done();
                });

                server.emit('error', new Error);
            });
        });
    });

});
