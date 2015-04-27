var DH = require('../lib');
var demand = require('must');

describe('node-docker-hipache', function () {
  var instance;
  before(function(){
    instance = instance || new DH();
    instance.start();
  });

  after(function(){
    instance.stop();
  });

  it('should exist', function () {
    demand(DH).to.exist();
    instance.start();
  });
});
