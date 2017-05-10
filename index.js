const SMTPServer = require('smtp-server').SMTPServer;
const SMTPConnection = require('nodemailer/lib/smtp-connection');
const dns = require('dns');
const concat = require('concat-stream');
const lookup = require('dnsbl-lookup');

const server = new SMTPServer({
  authOptional: true,
  logger: true,
  onConnect: function (session, callback) {

    var dnsbl = new lookup.dnsbl(session.remoteAddress);

    // ignore errors when querying blacklist
    dnsbl.on('error', function(error, blocklist) { });
    
    dnsbl.on('data', function(result, blocklist) {

      if (result.status.toString() === 'listed') {
        callback(new Error('blacklisted in ' + blocklist));
      }
    });

    dnsbl.on('done', function() {
      callback();
    });
  },
  onMailFrom: function (address, session, callback) {

    // currently accept any from address
    callback();
  },
  onRcptTo: function (address, session, callback) {

    var domain = address.address.substr(address.address.indexOf('@') + 1);

    dns.resolveSrv('_lwass._tcp.' + domain, function(err, addresses) {

      if (err) {

        console.log(err);
        callback(new Error('internal server error'));

      } else {

        if (!addresses) {

          callback(new Error('target address doesnt support lwass'));

        } else {

          // target smtp
          session.targetSmtpHostname = addresses[0].name;
          session.targetSmtpPort = addresses[0].port;

          callback();
        }
      }
    });
  },
  onData: function (stream, session, callback) {

    var concatStream = concat(function(data) {

      var connection = new SMTPConnection({
        host: session.targetSmtpHostname,
        port: session.targetSmtpPort,
        logger: true
      });

      connection.on('error', function(err) {

        var returnError = new Error(err.response);
        returnError.responseCode = err.responseCode;

        callback(returnError);
      });

      connection.connect(function() {

        var envelope = {
          from: session.envelope.mailFrom.address,
          to: session.envelope.rcptTo[0].address
        };

        connection.send(envelope, data, function(err, info) {

          if (err) {

            var returnError = new Error(err.response);
            returnError.responseCode = err.responseCode;

            connection.close();

            callback(returnError);
          } else {

            connection.quit();
            callback();
          }

        });
      });
    });

    stream.pipe(concatStream);
  }
});

server.listen(25);