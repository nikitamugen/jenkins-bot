/*-----------------------------------------------------------------------------
A simple echo bot for the Microsoft Bot Framework. 
-----------------------------------------------------------------------------*/

const restify = require('restify');
const builder = require('botbuilder');
const botbuilder_azure = require("botbuilder-azure");
const EventSource = require("eventsource");
const axios = require('axios');

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
const Request = require('rest-request');

console.log(`Connect to Jenkins`);
const connectAPI = new Request(__JENKINS__);
connectAPI.get('sse-gateway/connect/:clientId', {clientId:__CLIENTID__})
.then((data) => {
    console.log(data);

    const listenMethod = `${__JENKINS__}/sse-gateway/listen/${__CLIENTID__}`;
    console.log(`Register event listener at ${listenMethod}`);

    let eventSource = new EventSource(listenMethod, {withCredentials: true});
    eventSource.addEventListener('open', function (e) {
      console.log('SSE channel "open" event.', e);
      if (e.data) {
        jenkinsSessionInfo = JSON.parse(e.data);
      }
    }, false);
    eventSource.addEventListener('configure', function (e) {
      console.log('SSE channel "configure" ACK event (see batchId on event).', e);
    }, false);
    eventSource.addEventListener('reload', function (e) {
      console.log('SSE channel "reload" event received. Reloading page now.', e);
    }, false);

    var configurationBatchId = 0;
    eventSource.addEventListener('job', function (e) {
      console.log('SSE channel "' + channel + '" event received.', e);
    }, false);

    eventSource.addEventListener('message', function (e) {
      console.log('SSE channel "' + channel + '" event received.', e);
    }, false);

    eventSource.addEventListener('onmessage', function (e) {
      console.log('SSE channel "' + channel + '" event received.', e);
    }, false);

    eventSource.addEventListener('build', function (e) {
      console.log('SSE channel "' + channel + '" event received.', e);
    }, false);
})
.catch(function(error) {
    console.log(error);  
});