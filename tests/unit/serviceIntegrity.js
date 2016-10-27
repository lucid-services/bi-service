var sinon          = require('sinon');
var chai           = require('chai');
var chaiAsPromised = require('chai-as-promised');
var sinonChai      = require("sinon-chai");
var couchbase      = require('couchbase');
var BucketMock     = require('couchbase/lib/mock/bucket');

var serviceIntegrity = require('../../lib/serviceIntegrity.js');
var CouchbaseCluster = require('../../lib/database/couchbase.js');
var sequelizeBuilder = require('../../lib/database/sequelize.js');
var AppManager       = require('../../lib/express/appManager.js');
var App              = require('../../lib/express/app.js');
var AppStatus        = require('../../lib/express/appStatus.js');
var Config           = require('./mocks/config.js');

//this makes sinon-as-promised available in sinon:
require('sinon-as-promised');

var expect = chai.expect;

chai.use(sinonChai);
chai.use(chaiAsPromised);
chai.should();

describe.only('serviceIntegrity', function() {
    before(function() {
        this.models = {};
        this.config = new Config();

        this.configGetStub = sinon.stub(this.config, 'get');

        this.appManager = new AppManager(this.config, this.models);
        var app = this.app = this.appManager.buildApp();
    });

    beforeEach(function() {
        this.configGetStub.reset();
    });

    describe('inspect', function() {
        before(function() {
            this.inspectNodeSpy = sinon.spy(serviceIntegrity, 'inspectNode');
            this.inspectPostgresSpy = sinon.spy(serviceIntegrity, 'inspectPostgres');
            this.inspectCouchbaseSpy = sinon.spy(serviceIntegrity, 'inspectCouchbase');
        });

        beforeEach(function() {
            this.inspectNodeSpy.reset();
            this.inspectPostgresSpy.reset();
            this.inspectCouchbaseSpy.reset();
        });

        after(function() {
            this.inspectNodeSpy.restore();
            this.inspectPostgresSpy.restore();
            this.inspectCouchbaseSpy.restore();
        });

        it('should return resolved promise', function() {
            return serviceIntegrity.inspect(this.app).should.be.fulfilled;
        });

        it('should call inspectNode method', function() {

            return serviceIntegrity.inspect(this.app).bind(this).then(function() {
                this.inspectNodeSpy.should.have.been.calledOnce;
            });

        });

        it('should call inspectPostgres method', function() {

            return serviceIntegrity.inspect(this.app).bind(this).then(function() {
                this.inspectPostgresSpy.should.have.been.calledOnce;
                this.inspectPostgresSpy.should.have.been.calledWithExactly(this.app);
            });

        });

        it('should call inspectCouchbase method', function() {

            return serviceIntegrity.inspect(this.app).bind(this).then(function() {
                this.inspectCouchbaseSpy.should.have.been.calledOnce;
                this.inspectCouchbaseSpy.should.have.been.calledWithExactly(this.app);
            });

        });
    });

    describe('inspectPostgres', function() {
        describe('postgres driver NOT set', function() {
            it('should return resolved Promise with false', function() {
                return serviceIntegrity.inspectPostgres(this.app).should.be.fulfilled.then(function(result) {
                    result.should.be.equal(false);
                });
            });
        });

        describe('postgres driver IS set', function() {
            before(function() {

                this.sequelize = sequelizeBuilder({
                    dialect  : 'postgres',
                    host     : 'localhost',
                    username : 'root',
                    db       : 'test'
                });

                this.queryStub = sinon.stub(this.sequelize, 'query');
                this.app.useSequelize(this.sequelize);
            });

            beforeEach(function() {
                this.queryStub.reset();
            });

            it('should make a select query requesting postgres version', function() {
                var self = this;
                this.queryStub.returns(Promise.resolve([
                    {server_version: '1.0.0'}
                ]));

                return serviceIntegrity.inspectPostgres(this.app).then(function() {
                    self.queryStub.should.have.been.calledOnce;
                    self.queryStub.should.have.been.calledWith(
                        'SHOW server_version;',
                        {
                            type: self.app.sequelize.QueryTypes.SELECT
                        }
                    );
                });
            });

            it('should return rejected Promise', function() {
                var error = new Error;
                this.queryStub.returns(Promise.reject(error));

                return serviceIntegrity.inspectPostgres(this.app).should.be.rejectedWith(error);
            });

            it('should return rejected promise when the actual postgres version does not satisfy required version', function() {
                var version = '1.0.0';
                var expected = '1.5.0';

                this.queryStub.returns(Promise.resolve([
                    {server_version: version}
                ]));

                this.configGetStub.returns(expected);

                return serviceIntegrity.inspectPostgres(this.app).should.be.rejected;
            });

            it('should return fulfilled promise with true', function() {
                this.queryStub.returns(Promise.resolve([
                    {server_version: '1.1.0'}
                ]));

                this.configGetStub.returns('1.0.0');

                return serviceIntegrity.inspectPostgres(this.app).should.be.fulfilled.then(function(result) {
                    result.should.be.equal(true);
                });
            });
        });
    });

    describe('inspectCouchbase', function() {
        describe('couchbase driver is NOT set', function() {
            it('should return resolved Promise with false', function() {
                return serviceIntegrity.inspectCouchbase(this.app).should.be.fulfilled.then(function(result) {
                    result.should.be.equal(false);
                });
            });
        });

        describe('couchbase driver IS set', function() {
            before(function() {

                this.clusterStub = sinon.stub(couchbase, 'Cluster', function(host) {
                    return new couchbase.Mock.Cluster('localhost');
                });

                this.buckets = {
                    main: {
                        bucket: 'default'
                    },
                    cache: {
                        bucket: 'cache'
                    }
                };

                this.couchbaseCluster = new CouchbaseCluster({
                    buckets: this.buckets
                });

                this.app.useCouchbase(this.couchbaseCluster);

                //open 2 buckets
                this.couchbaseCluster.openBucketSync('main');
                this.couchbaseCluster.openBucketSync('cache');

                // we must get it this way because couchbase-sdk does not export
                // the Storage object from the module
                var MockStoragePrototype = Object.getPrototypeOf(
                    this.couchbaseCluster.buckets.main.storage
                );

                this.couchbaseGetStub = sinon.stub(MockStoragePrototype, 'get', function() {
                    return MockStoragePrototype.get.apply(MockStoragePrototype, arguments);
                });
            });

            beforeEach(function() {
                this.couchbaseGetStub.reset();
            });

            after(function() {
                this.clusterStub.restore();
                this.couchbaseGetStub.restore();
            });

            it('should make a select query for each of the two opened buckets', function() {
                var self = this;

                return serviceIntegrity.inspectCouchbase(this.app).then(function(result) {
                    self.couchbaseGetSpy.should.have.been.calledTwice;
                });
            });

            it('should return resolved promise when we get the `keyNotFound` error', function() {

            });

            it('should return resolved promise when a document we search for is found', function() {

            });

            it('should return rejected promise when there occurs any other error than the `keyNotFound` error', function() {

            });
        });
    });

    describe('inspectNode', function() {

    });

});
