var m              = require('module');
var path           = require('path');
var sinon          = require('sinon');
var chai           = require('chai');
var chaiAsPromised = require('chai-as-promised');
var sinonChai      = require("sinon-chai");
var logger         = require('serviser-logger');
var EventEmitter   = require('events-bluebird');
var Promise        = require('bluebird');
var BIServiceSDK   = require('serviser-sdk');

var RemoteServiceManager = require('../../../lib/remoteServiceManager.js');
var SDKMock              = require('../..//mocks/sdk.js');

//this makes sinon-as-promised available in sinon:
require('sinon-as-promised');

var expect = chai.expect;

chai.use(sinonChai);
chai.use(chaiAsPromised);
chai.should();

describe('RemoteServiceManager', function() {
    describe('add', function() {
        beforeEach(function() {
            this.manager = new RemoteServiceManager();
        });

        it('should register a SDK object under provided key', function() {
            var sdk = new SDKMock({baseURL: '127.0.0.1'});
            this.manager.add('depot:public', sdk);

            this.manager.services.should.have.deep.property('depot.public');
            this.manager.services.depot.public.should.have.property(sdk.version, sdk);
        });

        it('should return self (RemoteServiceManager)', function() {
            var sdk = new SDKMock({baseURL: '127.0.0.1'});
            this.manager.add('depot:public', sdk).should.be.equal(this.manager);
        });

        it('should throw an Error when received SDK object is not instanceof BIServiceSDK', function() {
            var manager = this.manager;

            expect(function() {
                manager.add('depot:public', {});
            }).to.throw(Error);
        });

        it('should throw an Error when we provide key in invalid format', function() {
            var sdk = new SDKMock({baseURL: '127.0.0.1'});
            var manager = this.manager;

            expect(function() {
                manager.add('some-invalid-key');
            }).to.throw(Error);
        });
    });

    describe('get', function() {
        beforeEach(function() {
            this.manager = new RemoteServiceManager();
        });

        it('should return a SDK object registered under provided key', function() {
            var sdk = new SDKMock({baseURL: '127.0.0.1'});
            this.manager.add('depot:public', sdk);

            this.manager.get('depot:public:v1.0').should.be.equal(sdk);
        });

        it('should throw an Error when there is no SDK object registered under provided key', function() {
            var manager = this.manager;

            expect(function() {
                manager.get('depot:public:v2.0');
            }).to.throw(Error);
        });

        it('should throw an Error when object is not instanceof BIServiceSDK', function() {
            var manager = this.manager;
            var sdk = new SDKMock({baseURL: '127.0.0.1'});

            this.manager.add('depot:public:scope', sdk);
            expect(function() {
                manager.get('depot:public');
            }).to.throw(Error);
        });
    });

    describe('has', function() {
        beforeEach(function() {
            this.manager = new RemoteServiceManager();

            var sdk = new SDKMock({baseURL: '127.0.0.1'});
            this.manager.add('depot:public', sdk);
        });

        it("should return true when the manager's registry includes a SDK instance which matches provided key", function() {

            this.manager.has('depot:public:v1.0').should.be.equal(true);
            this.manager.has('depot:public').should.be.equal(true);
            this.manager.has('depot').should.be.equal(true);
        });

        it("should return false when the manager's registry does not include a SDK instance which matches provided key", function() {

            this.manager.has('depot:public:v2.0').should.be.equal(false);
            this.manager.has('depot:s2s').should.be.equal(false);
            this.manager.has('facebook').should.be.equal(false);
        });

        it("should throw an Error when an invalid key format is provided", function() {
            var manager = this.manager;

            expect(function() {
                manager.has('depot:public:v1.0:someprop');
            }).to.throw(Error);
        });
    });

    describe('buildRemoteService', function() {
        before(function() {
            this.managerPath = path.resolve(__dirname + '/../../../lib/remoteServiceManager.js');
            this.managerModule = m._cache[this.managerPath];

            this.requireStub = sinon.stub(this.managerModule, 'require');
            this.requireStub.withArgs('serviser-sdk').returns(BIServiceSDK);
        });

        after(function() {
            this.requireStub.restore();
        });

        beforeEach(function() {
            var services = {
                depot: {
                    public: {
                        npm: 'bi-depot-public-sdk',
                        host: '127.0.0.1:3000',
                        ssl: false,
                        params: {
                            prop1: 'value'
                        }
                    },
                    cli: {
                        npm: 'bi-cli-sdk',
                        host: '127.0.0.1:3001',
                        ssl: false
                    }
                }
            };
            this.manager = new RemoteServiceManager(services);

            this.requireStub.reset();
        });

        it('should throw an Error when we provide invalid key', function() {
            var manager = this.manager;

            expect(function() {
                manager.buildRemoteService('some-invalid-key');
            }).to.throw(Error);
        });

        it('should throw an Error when there is no config definition for provided SDK key', function() {
            var manager = this.manager;

            expect(function() {
                manager.buildRemoteService('user:public:v1.0');
            }).to.throw(Error);
        });

        it('should throw an Error when we try to build a version of SDK which does not exist', function() {
            var manager = this.manager;

            this.requireStub.withArgs('bi-depot-public-sdk').returns({
                'v1.0': SDKMock
            });

            expect(function() {
                manager.buildRemoteService('depot:public:v2.0');
            }).to.throw(Error);
        });

        it('should return constructed SDK object', function() {
            this.requireStub.withArgs('bi-depot-public-sdk').returns({
                'v1.0': SDKMock
            });

            this.manager.buildRemoteService('depot:public:v1.0').should.be.instanceof(BIServiceSDK);
        });

        it('should provide the sdk constructor with additional options when as configured in the `services` config section', function() {
            this.requireStub.withArgs('bi-depot-public-sdk').returns({
                'v1.0': SDKMock
            });

            let sdk = this.manager.buildRemoteService('depot:public:v1.0');
            sdk.axios.defaults.params.should.be.eql({
                prop1: 'value'
            });
        });

        it('should register newly created object in internal cache object', function() {
            this.requireStub.withArgs('bi-cli-sdk').returns({
                'v1.0': SDKMock
            });
            this.manager.buildRemoteService('depot:cli:v1.0').should.be.instanceof(BIServiceSDK);

            this.manager.services.should.have.deep.property('depot.cli');
            this.manager.services.depot.cli.should.have.property('v1.0');
        });
    });
});
