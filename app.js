/*-----------------------------------------------------------------------------
A simple echo bot for the Microsoft Bot Framework. 
-----------------------------------------------------------------------------*/

const restify = require('restify');
const builder = require('botbuilder');
const botbuilder_azure = require("botbuilder-azure");
const EventSource = require("eventsource");
const axios = require('axios');
const unirest = require('unirest');
const nconf = require('nconf');

nconf.argv()
   .env()
   .file({ file: 'config.json' });

function _saveAdressFilter(adress, regExpString) {

}

// Setup Restify Server
//
const server = restify.createServer();
const port = nconf.any('port', 'PORT');
server.listen(port || 3978, function () {
   console.log('%s listening to %s', server.name, server.url);
   console.log('MicrosoftAppId: %s', process.env.MicrosoftAppId);
});

const botName = "jenkins-bot";
const spacesExpr = "[ ]*";
const botNameExpr = `([@]?${botName})?${spacesExpr}`;
const serviceInfExpr = `${spacesExpr}(<[^>]*>)*`;

// Create chat connector for communicating with the Bot Framework Service
//
const appId = onst port = nconf.any('MicrosoftAppId', 'AppId', 'appId');
const appPassword = onst port = nconf.any('MicrosoftAppPassword', 'AppPassword', 'appPassword');
const botOpenIdMetadata = onst port = nconf.any('BotOpenIdMetadata', 'botOpenIdMetadata');
const connector = new builder.ChatConnector({
    appId: appId,
    appPassword: appPassword,
    openIdMetadata: botOpenIdMetadata
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

const bot = new builder.UniversalBot(connector);

// Register in-memory storage
//
const inMemoryStorage = new builder.MemoryBotStorage();
bot.set('storage', inMemoryStorage); 

// ------------------------------------------------
// Dialogs

bot.dialog('/', [
	function (session) {
		const msg = `You said: "${session.message.text}". Sorry, but i didn't understand ... Please type help for instructions.`;
		session.endConversation(msg);
	}
])

bot.dialog('setup', [
  function (session) {
    session.send("Setup begin !");
    builder.Prompts.text(session, 'Please enter an expression for filtering the required tasks');
  },
  function (session, results) {
    try {
      const regExpString = results.response.entity;

      // Just to check ...
      //
      new RegExp(regExpString);

      const address = session.message.address;
      
    } catch (error) {
      const address = session.message.address;
      say(address, error);
    } finally {
      session.endConversation();
    }
  }
])
.endConversationAction(
    "endSetup", "Setup canceled !",
    {
      matches: new RegExp(`^${botNameExpr}(cancel|goodbye)${serviceInfExpr}$`, 'i'),
        confirmPrompt: "This will cancel your order. Are you sure?"
    }
)
.triggerAction({
    matches: new RegExp(`^${botNameExpr}setup${serviceInfExpr}$`, 'i'),
    onSelectAction: (session, args, next) => {
        // Add the help dialog to the dialog stack 
        // (override the default behavior of replacing the stack)
        //
        session.beginDialog(args.action, args);
    }
});

// ------------------------------------------------
// Jenkins client

// Connect to the SSE Gateway, providing an optional client Id.
function _getJenkinsRootUrl() {
  const jenkinsRootUrl = nconf.any('jenkinsUrl', 'jenkinsRoot', 'jenkinsRootUrl');
  const defaultUrl = 'http://127.0.0.1:8080';
  return (jenkinsRootUrl || defaultUrl);
}
function _getClientId() {
  const clientName = nconf.any('clientName');
  const clientId = `${clientName}_id:${_getRandomId()}`;
  return encodeURIComponent(clientId);
}
function _getRandomId() {
  return Math.random().toString(36).substring(7);
}
function _getUsername() {
  const username = nconf.any('username', 'userName');
  return username;
}
function _getPassword() {
  const username = nconf.get('password');
  return username;
}

const QUEUED='QUEUED';
const RUNNING='RUNNING';
const SUCCESS='SUCCESS';
const FAULT='FAULT';

var connectionInfo = {
  jenkinsUrl: _getJenkinsRootUrl(),
  clientId: _getClientId(),
  username: _getUsername(),
  password: _getPassword(),
  sessionInfo: undefined,
  eventSource: undefined,
  cookies: undefined
};

console.log(`Connect to Jenkins`);
const connectUrl = `${connectionInfo.jenkinsUrl}/sse-gateway/connect?clientId=${connectionInfo.clientId}`;
unirest.get(connectUrl)
.auth({
  user: connectionInfo.username,
  pass: connectionInfo.password,
  sendImmediately: true
})
.end(response => {
  connectionInfo.jsessionid = response.body.data.jsessionid;
  connectionInfo.cookies = response.cookies;
  const cookieString = _cookieObjectToString(response.cookies);

  console.log(`Add listeners`);
  const listenMethod = `${connectionInfo.jenkinsUrl}/sse-gateway/listen/${connectionInfo.clientId};jsessionid=${connectionInfo.jsessionid}`;
  connectionInfo.eventSource = new EventSource(listenMethod);
  connectionInfo.eventSource.addEventListener('open', (e) => {
      console.log('SSE channel "open" event.', e);
      if (e.data) {
        console.log(JSON.parse(e.data));
        connectionInfo.sessionInfo = JSON.parse(e.data);
        _doConfigure(connectionInfo);
      }
    }, false);
    connectionInfo.eventSource.addEventListener('job', function (e) {
      const payload = JSON.parse(e.data);
      const name = payload.job_name;
      const number = payload.jenkins_object_id;
      const status = payload.job_run_status;
      const url = payload.jenkins_object_url;
      if (status==QUEUED) {
        console.log(`Задача ${name} была поставлена в очередь.`);
      } else if (status==RUNNING) {
        console.log(`Задача ${name} #${number} выполняется.`);
      } else if (status==SUCCESS) {
        console.log(`Задача ${name} #${number} завершена успешно.`);
      } else if (status==FAULT) {
        console.log(`Задача ${name} #${number} завершена с ошибками.`);
      } else {
        //console.log('job event received.', e);
      }
    }, false);
});

function _cookieObjectToString(cookie) {
  const exp = /jsessionid./i;
  for (let prop in cookie) {
    if (prop.match(exp)) {
      return `${prop}=${cookie[prop]}`;
    }
  }
  return '';
}

var configurationBatchId = 0;
function _doConfigure(connectionInfo) {
  console.log(`Configure channels`);
  let job = {
    jenkins_channel: 'job'
  };
  let configuration = {
    subscribe: [job],
    dispatcherId: connectionInfo.sessionInfo.dispatcherId
  };

  const configureUrl = `${connectionInfo.jenkinsUrl}/sse-gateway/configure?batchId=${configurationBatchId++}`;
  unirest.post(configureUrl)
  .auth({
    user: connectionInfo.username,
    pass: connectionInfo.password,
    sendImmediately: true
  })
  .headers({'Cookie': _cookieObjectToString(connectionInfo.cookies)})
  .type('json')
  .send(configuration)
  .end(function (response) {
    console.log('ok');
  });
}