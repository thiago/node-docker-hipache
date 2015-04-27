/*jshint -W079 */

var _ = require('lodash'),
  url = require('url'),
  //events = require('events'),
  Docker = require('dockerode'),
  DockerEvents = require('docker-events'),
  HipacheCtl = require('hipachectl'),
  redis = require('redis'),

  REDIS_URL = url.parse(process.env.REDIS_PORT_6379 || process.env.REDIS_URL || 'tcp://redis:6379'),
  REDIS_PORT = REDIS_URL.port,
  REDIS_HOSTNAME = REDIS_URL.hostname,

  defaultOptions = {
    defaultVHost: 'dev.docker-hipache.io',
    environment:{
      hostname: 'VHOST',
      port: 'VHOST_PORT',
      prefix: 'VHOST_PREFIX',
      customHostname: 'ENV_VHOST',
      customPrefix: 'ENV_VHOST_PREFIX',
      customPort: 'ENV_VHOST_PORT'
    },
    docker: {socketPath: '/var/run/docker.sock'},
    hipache: {
      socket: null,
      port: REDIS_PORT,
      host: REDIS_HOSTNAME,
      options: {}
    }
  };

function DockerHipache(opts){
  var args,
    options = _.extend({}, defaultOptions, opts || {});

  console.log(options);
  this.options = options;
  this.docker = options.docker instanceof Docker ? options.docker : new Docker(options.docker);
  this.emitter = new DockerEvents({docker: this.docker});
  if(options.hipache instanceof HipacheCtl){
    this.hipache = options.hipache;
  }else{
    args = [];
    if(options.hipache.socket){
      args.push(options.hipache.socket);
    }else{
      args.push(options.hipache.port);
      args.push(options.hipache.host);
    }
    args.push(options.hipache.options);
    this.hipache = new HipacheCtl(redis.createClient.apply(redis, args));
  }

  this.emitter.on('_message', function(message){
    console.log(message);

  });
  //console.log(events, Promisse);
}
DockerHipache.defaultOptions = defaultOptions;

DockerHipache.prototype.start = function(){
  this.emitter.start();
};

DockerHipache.prototype.stop = function(){
  this.emitter.stop();
};

module.exports = DockerHipache;