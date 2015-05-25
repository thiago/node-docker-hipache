/*jshint -W079 */

var _ = require('lodash'),
  url = require('url'),
  events = require('events'),
  redis = require('redis'),
  Promisse = require('bluebird'),
  Docker = require('dockerode'),
  DockerEvents = require('docker-events'),
  HipacheCtl = require('hipachectl'),

  REDIS_URL = url.parse(process.env.REDIS_PORT_6379_TCP || process.env.REDIS_URL || 'tcp://127.0.0.1:6379'),
  REDIS_PORT = REDIS_URL.port,
  REDIS_HOSTNAME = REDIS_URL.hostname;

function DockerHipache(opts) {
  var args,
    self = this,
    options = _.extend({}, DockerHipache.defaultOptions, opts || {});

  events.EventEmitter.call(self, options);
  self.options = options;
  if (!_.isEmpty(options.docker)) {
    self.docker = options.docker instanceof Docker ? options.docker : new Docker(options.docker);
  } else {
    self.docker = new Docker();
  }
  self.emitter = new DockerEvents({docker: self.docker});

  if (options.hipache instanceof HipacheCtl) {
    self.hipache = options.hipache;
  } else {
    args = [];
    if (options.hipache.socket) {
      args.push(options.hipache.socket);
    } else {
      args.push(options.hipache.port);
      args.push(options.hipache.host);
    }
    args.push(options.hipache.options);
    self.hipache = new HipacheCtl(redis.createClient.apply(redis, args));
  }

  self.emitter.on('_message', function (message) {
    if (!message.status) {
      return;
    }
    var args = [];
    args.push(message.id);
    if(message.node && message.node.Ip){
      args.push(message.node.Ip);
    }

    switch (message.status) {
      case 'start':
        self.balanceContainer.apply(self, args);
        break;

      case 'die':
        self.unbalanceContainer.apply(self, args);
        break;
    }
  });
}

DockerHipache.defaultOptions = {
  virtualhost: 'dev.docker-hipache.io',
  defaultPort: 80,
  environment: {
    total: 10,
    virtualhost: 'VHOST',
    port: 'PORT',
    prefix: 'PREFIX',
    customPrefix: 'ENV',
    divisor: '_'
  },
  docker: {},
  hipache: {
    socket: null,
    port: REDIS_PORT,
    host: REDIS_HOSTNAME,
    options: {}
  }
};

DockerHipache.prototype = Object.create(events.EventEmitter.prototype, {constructor: {value: DockerHipache}});
DockerHipache.prototype.database = {};
DockerHipache.prototype.start = function () {
  this.emitter.start();
  //this.emit('start');
};

DockerHipache.prototype.stop = function stop() {
  this.emitter.stop();
  //this.emit('stop');
};

DockerHipache.prototype.inspect = function inspect(id) {
  var self = this;
  if (typeof id !== 'string') {
    return Promisse.reject(new Error('Id must be a string'));
  }

  return new Promisse(function (resolve, reject) {
    var container = self.docker.getContainer(id);
    if (!container) {
      return reject(new Error('Container not exist'));
    } else {
      return container.inspect(function (err, data) {
        if (err) {
          return reject(err);
        }
        return resolve(data);
      });
    }

  });
};

DockerHipache.prototype.getIp = function getIp(containerInfo) {
  var self = this;
  if (typeof(containerInfo) === 'string') {
    return self.inspect(containerInfo).then(function (data) {
      return self.getIp(data);
    });
  } else if (!containerInfo || !containerInfo.NetworkSettings || !containerInfo.NetworkSettings.IPAddress) {
    return Promisse.reject(new Error('Don\'t has a IP'));
  }
  return Promisse.resolve(containerInfo.NetworkSettings.IPAddress);
};

DockerHipache.prototype.getEnv = function getEnv(containerInfo) {
  var self = this;
  if (typeof(containerInfo) === 'string') {
    return self.inspect(containerInfo).then(function (data) {
      return self.getEnv(data);
    });
  }

  var envs = {};
  (containerInfo.Config.Env || []).forEach(function (v) {
    var val = v.split("=");
    envs[val[0]] = val[1];
  });
  return Promisse.resolve(envs);
};

DockerHipache.prototype.parseContainer = function parseContainer(id, _ip) {
  var self = this,
    ports = [],
    envs = [],
    data, ip;

  return self.inspect(id)
    .then(function (_data) {
      data = _data;
      data = data || {};
      data.Config = data.Config || {};
      data.NetworkSettings = data.NetworkSettings || {};
      return self.getIp(data);
    })
    .then(function (__ip) {
      ip = !_ip ? __ip : _ip;
      return self.getEnv(data);
    })
    .then(function (_envs) {
      envs = _envs;
      var port, protocol;

      _.keys(data.Config.ExposedPorts || {}).forEach(function (v) {
        v = v.split("/");
        port = v[0];
        protocol = v[1];
        if (protocol === "tcp") {
          ports.push(parseInt(port));
        }
      });

      var i, defaultPrefix,
        parsed = {},
        defaultPort = self.options.defaultPort,
        div = self.options.environment.divisor,
        count = self.options.environment.total,
        vhost = self.options.environment.virtualhost,
        vport = [vhost, self.options.environment.port].join(div),
        vprefix = [vhost, self.options.environment.prefix].join(div),

        custom = self.options.environment.customPrefix,
        chost = [custom, vhost].join(div),
        cport = [custom, vport].join(div),
        cprefix = [custom, vprefix].join(div),

        envhost, envport, envprefix,
        hostvalue, portvalue, prefixvalue,
        currentParse;


      defaultPrefix = data.Name.replace(/\//gi, '').split('_').reverse();
      if (!_.isNaN(parseInt(defaultPrefix[0]))) {
        defaultPrefix.shift();
      }

      defaultPrefix = defaultPrefix.join('.');

      for (i = 0; i <= count; i++) {
        envhost = i === 0 ? chost : chost + div + i;
        envport = i === 0 ? cport : cport + div + i;
        envprefix = i === 0 ? cprefix : cprefix + div + i;

        if (!envs[envhost]) {
          envhost = i === 0 ? vhost : vhost + div + i;
        } else {
          envhost = envs[envhost];
        }

        if (!envs[envport]) {
          envport = i === 0 ? vport : vport + div + i;
        } else {
          envport = envs[envport];
        }

        if (!envs[envprefix]) {
          envprefix = i === 0 ? vprefix : vprefix + div + i;
        } else {
          envprefix = envs[envprefix];
        }

        hostvalue = envs[envhost];
        portvalue = envs[envport];
        prefixvalue = envs[envprefix];

        if ((hostvalue || prefixvalue) && (portvalue || (i === 0 && ports.indexOf(defaultPort) >= 0))) {
          currentParse = {
            host: hostvalue || (prefixvalue || defaultPrefix) + '.' + self.options.virtualhost,
            port: (portvalue || defaultPort) + ''
          };
          parsed[currentParse.host] = parsed[currentParse.host] || [];
          parsed[currentParse.host].push(ip + ':' + currentParse.port);
        }
      }
      return parsed;
    }).catch(function () {
      return null;
    });
};

DockerHipache.prototype.balanceContainer = function balanceContainer(id, ip) {
  var self = this,
    data;
  return self.parseContainer(id, ip)
    .then(function (_data) {
      data = _data;
      self.database[id] = data;
      return Promisse.all(_.map(data, function (ips, vhost) {
        var args = Array.prototype.slice.call(ips);
        args.unshift(vhost);
        return self.hipache.add.apply(self.hipache, args);
      }));
    })
    .delay(100)

    .then(function(){
      self.emit('balance', id, data);
    });
};

DockerHipache.prototype.unbalanceContainer = function unbalanceContainer(id, ip) {
  var database,
    self = this;
  return (new Promisse(function (resolve, reject) {
    if (!id) {
      reject(new Error('Id not exist'));
    }
    if (self.database[id]) {
      database = self.database[id];
      delete self.database[id];
      return resolve(database);
    }
    return resolve(self.parseContainer(id, ip));
  }))
    .then(function (data) {
      return Promisse.all(_.map(data, function (ips, vhost) {
        var rt;
        ips.unshift(vhost);
        return self.hipache.remove.apply(self.hipache, ips)
          .then(function(data){
            rt = data;
            return self.hipache.find(vhost);
          })
          .then(function(backends){
            if(backends && backends.length === 1){
              return self.hipache.remove(vhost)
                .then(function(){
                  return rt;
                });
            }
            return rt;
          });
      }));
    })
    .delay(100)
    .then(function(data){
      self.emit('unbalance', data);
    });
};

DockerHipache.prototype.sync = function sync(){
  var self = this;
  self.docker.listContainers(function (err, containers) {
    containers.forEach(function (containerInfo) {
      self.balanceContainer(containerInfo.Id);
    });
  });
};
module.exports = DockerHipache;
