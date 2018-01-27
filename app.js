/*-----------------------------------------------------------------------------
A simple echo bot for the Microsoft Bot Framework. 
-----------------------------------------------------------------------------*/

const restify = require('restify');
const builder = require('botbuilder');
const botbuilder_azure = require("botbuilder-azure");
const EventSource = require("eventsource");
const axios = require('axios');
const unirest = require('unirest');

// Setup Restify Server
//
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url);
   console.log('MicrosoftAppId: %s', process.env.MicrosoftAppId);
});

const botName = "jenkins-bot";

// Create chat connector for communicating with the Bot Framework Service
//
const connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    openIdMetadata: process.env.BotOpenIdMetadata
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

const bot = new builder.UniversalBot(connector);

// Register in-memory storage
//
const inMemoryStorage = new builder.MemoryBotStorage();
bot.set('storage', inMemoryStorage); 

// Register table storage
//
// const tableName = 'botdata';
// const azureTableClient = new botbuilder_azure.AzureTableClient(tableName, process.env['AzureWebJobsStorage']);
// const tableStorage = new botbuilder_azure.AzureBotStorage({ gzipData: false }, azureTableClient);
// bot.set('storage', tableStorage);

bot.dialog('/', [
	function (session) {
		const msg = `You said: "${session.message.text}". Sorry, but i didn't understand ... Please type help for instructions.`;
		session.endConversation(msg);
	}
])

// Connect to the SSE Gateway, providing an optional client Id.
const __JENKINS__  ='http://127.0.0.1:8080';
const __CLIENTID__ = Math.random().toString(36).substring(7);

const QUEUED='QUEUED';
const RUNNING='RUNNING';
const SUCCESS='SUCCESS';
const FAULT='FAULT';

var connectionInfo = {
  jenkinsUrl: __JENKINS__,
  clientId: encodeURIComponent(__CLIENTID__),
  username: 'root',
  password: '123',
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