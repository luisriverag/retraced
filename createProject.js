'use strict';

const validateSession = require('./lib/security/validateSession');
const checkAccess = require('./lib/security/checkAccess');
const createProject = require('./lib/models/project/create');

const iopipe = require('iopipe')({
  clientId: require('./lib/config/getConfig')().IOPipe.ClientID,
});

module.exports.default = iopipe(
  (event, context, cb) => {
    validateSession({
      jwt_source: 'admin',
      event: event,
    })
    .then((claims) => {
      return createProject({
        user_id: claims.user_id,
        name: event.body.name,
      });
    })
    .then((project) => {
      cb(null, { project: project });
    })
    .catch((err) => {
      console.log(err);
      cb(err);
    });
  }
);
