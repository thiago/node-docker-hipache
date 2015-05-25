/*jshint -W079 */
var _ = require('lodash'),
  DH = require('../lib/index'),
  demand = require('must'),
  Promisse = require("bluebird"),
  rest = require('restling');


describe('docker-hipache', function () {
  describe('instance methods', function () {
    var instance, docker, container;

    function start(data) {
      data = _.extend({
        Image: 'busybox',
        Cmd: ['top'],
        Name: 'dockerhipache_busybox_test',
        Env: [],
        ExposedPorts: {}
      }, data || {});

      return docker.createContainerAsync(data)
        .then(function (cont) {
          Promisse.promisifyAll(cont);
          container = cont;
          return container;
        });
    }

    before(function () {
      instance = new DH();
      docker = instance.docker;
      Promisse.promisifyAll(docker);
    });

    afterEach(function (done) {
      instance.hipache.client.flushall(function () {
        done();
      });
    });

    after(function () {
      instance.hipache.client.quit();
    });

    afterEach(function (done) {
      if (container) {
        container.stopAsync()
          .then(function () {
            return container.removeAsync();
          })
          .catch(function () {
            return container.removeAsync();
          })
          .finally(function () {
            done();
          });
      } else {
        done();
      }
    });

    it('instance.getIp', function (done) {
      start()
        .then(function () {
          demand(container.id).to.be.string();
          return instance.getIp(container.id);
        })
        .catch(function (err) {
          demand(err).instanceof(Error);
          return container.startAsync();
        })
        .then(function () {
          return instance.getIp(container.id);
        })
        .then(function (ip) {
          demand(ip).to.be.string();
          demand(ip.length).to.be.gte(10);
          demand(ip.indexOf('.') !== -1).to.be.true();
          done();
        });
    });

    it('instance.getEnv', function (done) {
      start({Env: ['env=test1', 'param=test2']})
        .then(function (cont) {
          container = cont;
          demand(container.id).to.be.string();
          return instance.getEnv(container.id);
        })
        .then(function (data) {
          demand(data).have.ownProperty('env', 'test1');
          demand(data).have.ownProperty('param', 'test2');
          done();
        });
    });

    it('instance.parseContainer', function (done) {
      start({
        ExposedPorts: {
          '80/tcp': {}
        },
        Env: [
          'ENV_VHOST=CUSTOM_HOST',
          'CUSTOM_HOST=app.myhost.com',
          'VHOST_PORT_1=8080',
          'VHOST_PREFIX_1=custom.prefix'
        ]
      })
        .then(function () {
          return container.startAsync();
        })
        .then(function () {
          return instance.parseContainer(container.id);
        })
        .then(function (data) {
          demand(data).to.be.a.object();
          demand(data).have.keys(['app.myhost.com', 'custom.prefix.dev.docker-hipache.io']);
          demand(data['app.myhost.com']).to.be.a.array();
          demand(data['app.myhost.com']).length(1);
          demand(data['app.myhost.com'][0]).include('80');
          demand(data['app.myhost.com'][0].length).to.be.gte(10);
          done();
        });
    });
  });
  describe('events', function () {
    it('envent.start', function (done) {
      var container,
        instance = new DH(),
        docker = instance.docker;

      this.timeout(10000);

      Promisse.promisifyAll(docker);
      instance.start();
      docker.createContainerAsync({
        Image: 'python:2.7',
        Cmd: ['python', '-m', 'SimpleHTTPServer', '80'],
        Name: 'dockerhipache_busybox_test',
        ExposedPorts: {
          '80/tcp': {}
        },

        "HostConfig": {
           "PublishAllPorts": true
        },

        Env: [
          'VHOST=fulano.com',
          'VHOST_1=app2.myhost.com',
          'VHOST_PORT_1=8080',
          'VHOST_2=app2.myhost.com',
          'VHOST_PORT_2=8081'
        ]
      })
        .then(function (cont) {
          Promisse.promisifyAll(cont);
          container = cont;
          return container;
        })
        .then(function (container) {
          return container.startAsync();
        })
        .then(function () {
          return new Promisse(function (resolve) {
            instance.on('balance', function (data) {
              resolve(data);
            });
          });
        })

        .then(function (_a) {
          rest = _a;
          /*
          return instance.hipache.find('fulano.com');
        })
        .then(function () {
          return rest
            .get('http://fulano.com')
            .catch(function (result) {
              return result;
            });
        })
        .then(function (result) {
          demand(result && result.response && result.response.statusCode === 200).to.be(true);
          */
          return container.stopAsync();
        })
        .then(function () {
          return container.removeAsync();
        })
        .then(function () {
          instance.stop();
          instance.hipache.client.quit();
          done();
        });
    });
  });
});
